/**
 * MCP 客户端 — 单个 MCP Server 连接管理
 * 支持 stdio 和 SSE 两种传输方式
 */

import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import type {
	McpServerConfig,
	McpToolDef,
	McpResourceDef,
	McpPromptDef,
	McpServerStatus,
	McpToolResult,
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcNotification,
	McpInitializeResult,
} from './mcpTypes.js';

const DEFAULT_TIMEOUT = 30_000;
const HEADER_LINE_MAX = 8192;

export type McpClientEvents = {
	status: [serverId: string, status: McpServerStatus['status'], error?: string];
	tools_changed: [serverId: string, tools: McpToolDef[]];
	resources_changed: [serverId: string, resources: McpResourceDef[]];
	prompts_changed: [serverId: string, prompts: McpPromptDef[]];
	error: [serverId: string, error: string];
	destroyed: [serverId: string];
};

export class McpClient extends EventEmitter<McpClientEvents> {
	readonly config: McpServerConfig;
	private proc: childProcess.ChildProcess | null = null;
	private status: McpServerStatus['status'] = 'disconnected';
	private error: string | undefined;
	private tools: McpToolDef[] = [];
	private resources: McpResourceDef[] = [];
	private prompts: McpPromptDef[] = [];
	private requestId = 0;
	private pendingRequests = new Map<
		number | string,
		{
			resolve: (result: unknown) => void;
			reject: (error: Error) => void;
			timeout: NodeJS.Timeout;
		}
	>();
	private buffer = '';
	private sseController: AbortController | null = null;
	private sseEndpoint: string | null = null;
	private destroyed = false;

	constructor(config: McpServerConfig) {
		super();
		this.config = config;
	}

	getServerStatus(): McpServerStatus {
		return {
			id: this.config.id,
			status: this.status,
			error: this.error,
			tools: this.tools,
			resources: this.resources,
			prompts: this.prompts,
			lastConnected: this.status === 'connected' ? Date.now() : undefined,
		};
	}

	/** 连接到 MCP Server */
	async connect(): Promise<void> {
		if (this.destroyed) {
			throw new Error('Client has been destroyed');
		}
		if (this.status === 'connected' || this.status === 'connecting') {
			return;
		}

		this.setStatus('connecting');
		this.error = undefined;

		try {
			if (this.config.transport === 'stdio') {
				await this.connectStdio();
			} else if (this.config.transport === 'sse') {
				await this.connectSse();
			} else {
				throw new Error(`Unsupported transport: ${this.config.transport}`);
			}

			await this.initialize();
			await this.loadCapabilities();
			this.setStatus('connected');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.error = msg;
			this.setStatus('error', msg);
			throw err;
		}
	}

	/** 断开连接 */
	disconnect(): void {
		this.cleanup();
		this.setStatus('disconnected');
	}

	/** 销毁客户端 */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.cleanup();
		this.emit('destroyed', this.config.id);
		this.removeAllListeners();
	}

	/** 调用工具 */
	async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
		if (this.status !== 'connected') {
			throw new Error(`Server ${this.config.name} is not connected`);
		}

		const result = await this.request('tools/call', {
			name,
			arguments: args,
		});

		return result as McpToolResult;
	}

	/** 读取资源 */
	async readResource(uri: string): Promise<unknown> {
		if (this.status !== 'connected') {
			throw new Error(`Server ${this.config.name} is not connected`);
		}

		return this.request('resources/read', { uri });
	}

	/** 获取提示 */
	async getPrompt(name: string, args?: Record<string, string>): Promise<unknown> {
		if (this.status !== 'connected') {
			throw new Error(`Server ${this.config.name} is not connected`);
		}

		return this.request('prompts/get', { name, arguments: args });
	}

	private setStatus(status: McpServerStatus['status'], error?: string): void {
		this.status = status;
		this.error = error;
		this.emit('status', this.config.id, status, error);
	}

	private async connectStdio(): Promise<void> {
		const { command, args = [], env = {} } = this.config;
		if (!command) {
			throw new Error('stdio transport requires command');
		}

		this.proc = childProcess.spawn(command, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: { ...process.env, ...env },
		});

		if (!this.proc.stdin || !this.proc.stdout || !this.proc.stderr) {
			throw new Error('Failed to create stdio streams');
		}

		this.proc.on('error', (err) => {
			this.error = err.message;
			this.setStatus('error', err.message);
			this.emit('error', this.config.id, err.message);
		});

		this.proc.on('exit', (code, signal) => {
			if (!this.destroyed && this.status === 'connected') {
				const msg = `Process exited with code ${code}, signal ${signal}`;
				this.error = msg;
				this.setStatus('error', msg);
			}
		});

		this.proc.stderr.on('data', (data) => {
			// Log stderr for debugging but don't treat as error
			console.warn(`[MCP ${this.config.name} stderr]`, data.toString());
		});

		// Parse JSON-RPC messages from stdout
		this.proc.stdout.on('data', (data: Buffer) => {
			this.handleData(data.toString());
		});
	}

	private async connectSse(): Promise<void> {
		const { url } = this.config;
		if (!url) {
			throw new Error('SSE transport requires URL');
		}

		this.sseController = new AbortController();
		const timeout = this.config.timeout ?? DEFAULT_TIMEOUT;

		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					Accept: 'text/event-stream',
					...this.config.headers,
				},
				signal: AbortSignal.timeout(timeout),
			});

			if (!response.ok) {
				throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('No response body');
			}

			const decoder = new TextDecoder();

			// Process SSE stream
			(async () => {
				try {
					while (!this.destroyed) {
						const { done, value } = await reader.read();
						if (done) break;
						this.handleSseData(decoder.decode(value, { stream: true }));
					}
				} catch (err) {
					if (!this.destroyed) {
						const msg = err instanceof Error ? err.message : String(err);
						this.error = msg;
						this.setStatus('error', msg);
					}
				}
			})();
		} catch (err) {
			throw err;
		}
	}

	private handleSseData(data: string): void {
		// Parse SSE events
		const lines = data.split('\n');
		let eventType = '';
		let eventData = '';

		for (const line of lines) {
			if (line.startsWith('event:')) {
				eventType = line.slice(6).trim();
			} else if (line.startsWith('data:')) {
				eventData += line.slice(5).trim();
			} else if (line === '' && eventData) {
				// End of event
				if (eventType === 'endpoint') {
					this.sseEndpoint = eventData;
				} else {
					try {
						const msg = JSON.parse(eventData);
						this.handleMessage(msg);
					} catch {
						// Ignore parse errors
					}
				}
				eventType = '';
				eventData = '';
			}
		}
	}

	private handleData(data: string): void {
		this.buffer += data;
		const lines = this.buffer.split('\n');
		this.buffer = lines.pop() ?? '';

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const msg = JSON.parse(line);
				this.handleMessage(msg);
			} catch {
				// Ignore parse errors for incomplete lines
			}
		}
	}

	private handleMessage(msg: JsonRpcResponse | JsonRpcNotification): void {
		if ('id' in msg && (msg.result !== undefined || msg.error !== undefined)) {
			// Response
			const pending = this.pendingRequests.get(msg.id);
			if (pending) {
				clearTimeout(pending.timeout);
				this.pendingRequests.delete(msg.id);
				if (msg.error) {
					pending.reject(new Error(msg.error.message));
				} else {
					pending.resolve(msg.result);
				}
			}
		} else if ('method' in msg && !('id' in msg)) {
			// Notification
			this.handleNotification(msg as JsonRpcNotification);
		}
	}

	private handleNotification(msg: JsonRpcNotification): void {
		switch (msg.method) {
			case 'notifications/tools/list_changed':
				this.loadCapabilities().catch(() => {});
				break;
			case 'notifications/resources/list_changed':
				this.loadCapabilities().catch(() => {});
				break;
			case 'notifications/prompts/list_changed':
				this.loadCapabilities().catch(() => {});
				break;
		}
	}

	private async initialize(): Promise<McpInitializeResult> {
		const result = await this.request('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {
				roots: { listChanged: true },
			},
			clientInfo: {
				name: 'async-shell',
				version: '0.1.0',
			},
		});

		// Send initialized notification
		await this.notify('notifications/initialized', {});

		return result as McpInitializeResult;
	}

	private async loadCapabilities(): Promise<void> {
		try {
			const toolsResult = await this.request('tools/list', {});
			this.tools = (toolsResult as { tools: McpToolDef[] }).tools ?? [];
			this.emit('tools_changed', this.config.id, this.tools);
		} catch {
			this.tools = [];
		}

		try {
			const resourcesResult = await this.request('resources/list', {});
			this.resources = (resourcesResult as { resources: McpResourceDef[] }).resources ?? [];
			this.emit('resources_changed', this.config.id, this.resources);
		} catch {
			this.resources = [];
		}

		try {
			const promptsResult = await this.request('prompts/list', {});
			this.prompts = (promptsResult as { prompts: McpPromptDef[] }).prompts ?? [];
			this.emit('prompts_changed', this.config.id, this.prompts);
		} catch {
			this.prompts = [];
		}
	}

	private request(method: string, params: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const id = ++this.requestId;
			const req: JsonRpcRequest = {
				jsonrpc: '2.0',
				id,
				method,
				params,
			};

			const timeoutMs = this.config.timeout ?? DEFAULT_TIMEOUT;
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			this.pendingRequests.set(id, { resolve, reject, timeout });
			this.send(JSON.stringify(req));
		});
	}

	private notify(method: string, params: unknown): void {
		const req: JsonRpcNotification = {
			jsonrpc: '2.0',
			method,
			params,
		};
		this.send(JSON.stringify(req));
	}

	private send(data: string): void {
		if (this.config.transport === 'stdio' && this.proc?.stdin) {
			this.proc.stdin.write(data + '\n');
		} else if (this.config.transport === 'sse' && this.sseEndpoint) {
			// For SSE, we need to POST to the endpoint
			const baseUrl = this.config.url ?? '';
			const endpoint = this.sseEndpoint.startsWith('http')
				? this.sseEndpoint
				: new URL(this.sseEndpoint, baseUrl).toString();

			fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...this.config.headers,
				},
				body: data,
			}).catch((err) => {
				this.emit('error', this.config.id, err.message);
			});
		}
	}

	private cleanup(): void {
		// Clear pending requests
		for (const [id, pending] of this.pendingRequests) {
			clearTimeout(pending.timeout);
			pending.reject(new Error('Connection closed'));
		}
		this.pendingRequests.clear();

		// Kill process
		if (this.proc) {
			this.proc.kill();
			this.proc = null;
		}

		// Abort SSE
		if (this.sseController) {
			this.sseController.abort();
			this.sseController = null;
		}

		this.sseEndpoint = null;
		this.buffer = '';
	}
}