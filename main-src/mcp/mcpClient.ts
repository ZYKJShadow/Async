/**
 * MCP 客户端，基于 @modelcontextprotocol/sdk。
 * 支持 stdio、SSE（兼容旧远端）、Streamable HTTP（推荐，对应配置 transport: 'http'）。
 */

import { EventEmitter } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Prompt, Resource, Tool as SdkTool } from '@modelcontextprotocol/sdk/types.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
	McpServerConfig,
	McpToolDef,
	McpResourceDef,
	McpPromptDef,
	McpServerStatus,
	McpToolResult,
} from './mcpTypes.js';
import type { McpClientLike } from './mcpToolResolve.js';

const DEFAULT_TIMEOUT = 30_000;
const ASYNC_SHELL_MCP_VERSION = '0.0.3';

function mergeStdioEnv(extra?: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = { ...getDefaultEnvironment() };
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined) out[k] = v;
	}
	if (extra) Object.assign(out, extra);
	if (process.platform === 'win32' && !out.PYTHONUTF8) {
		out.PYTHONUTF8 = '1';
	}
	return out;
}

function mapSdkToolToMcp(t: SdkTool): McpToolDef {
	const schema = t.inputSchema;
	const props =
		schema && typeof schema === 'object' && schema.type === 'object'
			? (schema.properties as Record<string, unknown> | undefined)
			: undefined;
	const required =
		schema && typeof schema === 'object' && schema.type === 'object' ? schema.required : undefined;
	return {
		name: t.name,
		description: t.description,
		inputSchema: {
			type: 'object',
			properties: props ?? {},
			required: required ?? [],
		},
	};
}

function mapSdkResourceToMcp(r: Resource): McpResourceDef {
	return {
		uri: r.uri,
		name: r.name,
		description: r.description,
		mimeType: r.mimeType,
	};
}

function mapSdkPromptToMcp(p: Prompt): McpPromptDef {
	return {
		name: p.name,
		description: p.description,
		arguments: p.arguments?.map((a) => ({
			name: a.name,
			description: a.description,
			required: a.required,
		})),
	};
}

export type McpClientEvents = {
	status: [serverId: string, status: McpServerStatus['status'], error?: string];
	tools_changed: [serverId: string, tools: McpToolDef[]];
	resources_changed: [serverId: string, resources: McpResourceDef[]];
	prompts_changed: [serverId: string, prompts: McpPromptDef[]];
	error: [serverId: string, error: string];
	destroyed: [serverId: string];
};

export class McpClient extends EventEmitter<McpClientEvents> implements McpClientLike {
	readonly config: McpServerConfig;
	private sdkClient: Client | null = null;
	private status: McpServerStatus['status'] = 'disconnected';
	private error: string | undefined;
	private tools: McpToolDef[] = [];
	private resources: McpResourceDef[] = [];
	private prompts: McpPromptDef[] = [];
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

	private reqOpts(signal?: AbortSignal): RequestOptions {
		return {
			timeout: this.config.timeout ?? DEFAULT_TIMEOUT,
			...(signal ? { signal } : {}),
		};
	}

	private async closeSdk(): Promise<void> {
		if (this.sdkClient) {
			try {
				await this.sdkClient.close();
			} catch {
				// ignore
			}
			this.sdkClient = null;
		}
	}

	async connect(): Promise<void> {
		if (this.destroyed) {
			throw new Error('Client has been destroyed');
		}
		if (this.status === 'connected' || this.status === 'connecting') {
			return;
		}

		await this.closeSdk();
		this.setStatus('connecting');
		this.error = undefined;

		const self = this;

		try {
			const client = new Client(
				{ name: 'async-shell', version: ASYNC_SHELL_MCP_VERSION },
				{
					capabilities: { roots: { listChanged: true } },
					listChanged: {
						tools: {
							onChanged: (err, items) => {
								if (err || !items) return;
								self.tools = items.map(mapSdkToolToMcp);
								self.emit('tools_changed', self.config.id, self.tools);
							},
						},
						resources: {
							onChanged: (err, items) => {
								if (err || !items) return;
								self.resources = items.map(mapSdkResourceToMcp);
								self.emit('resources_changed', self.config.id, self.resources);
							},
						},
						prompts: {
							onChanged: (err, items) => {
								if (err || !items) return;
								self.prompts = items.map(mapSdkPromptToMcp);
								self.emit('prompts_changed', self.config.id, self.prompts);
							},
						},
					},
				}
			);

			this.sdkClient = client;

			const headers = this.config.headers ?? {};
			const headerInit = Object.keys(headers).length > 0 ? { headers } : undefined;

			if (this.config.transport === 'stdio') {
				const { command, args = [], env } = this.config;
				if (!command) {
					throw new Error('stdio transport requires command');
				}
				const transport = new StdioClientTransport({
					command,
					args,
					env: mergeStdioEnv(env),
					stderr: 'pipe',
				});
				await client.connect(transport);
				const stderrStream = transport.stderr;
				if (stderrStream && 'on' in stderrStream) {
					(stderrStream as unknown as NodeJS.ReadableStream).on('data', (data: Buffer) => {
						console.warn(`[MCP ${this.config.name} stderr]`, data.toString('utf8'));
					});
				}
			} else if (this.config.transport === 'sse') {
				const { url } = this.config;
				if (!url) {
					throw new Error('SSE transport requires URL');
				}
				const transport = new SSEClientTransport(new URL(url), {
					requestInit: headerInit,
				});
				await client.connect(transport);
			} else if (this.config.transport === 'http') {
				const { url } = this.config;
				if (!url) {
					throw new Error('HTTP transport requires URL');
				}
				const transport = new StreamableHTTPClientTransport(new URL(url), {
					requestInit: headerInit,
				});
				await client.connect(transport);
			} else {
				throw new Error(`Unsupported transport: ${this.config.transport}`);
			}

			await this.loadCapabilities();
			this.setStatus('connected');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.error = msg;
			this.setStatus('error', msg);
			await this.closeSdk();
			throw err;
		}
	}

	async disconnect(): Promise<void> {
		await this.closeSdk();
		this.setStatus('disconnected');
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		void this.closeSdk();
		this.emit('destroyed', this.config.id);
		this.removeAllListeners();
	}

	async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
		if (this.status !== 'connected' || !this.sdkClient) {
			throw new Error(`Server ${this.config.name} is not connected`);
		}
		const result = await this.sdkClient.callTool({ name, arguments: args }, undefined, this.reqOpts(signal));
		return result as McpToolResult;
	}

	async readResource(uri: string, signal?: AbortSignal): Promise<unknown> {
		if (this.status !== 'connected' || !this.sdkClient) {
			throw new Error(`Server ${this.config.name} is not connected`);
		}
		return this.sdkClient.readResource({ uri }, this.reqOpts(signal));
	}

	async getPrompt(name: string, args?: Record<string, string>): Promise<unknown> {
		if (this.status !== 'connected' || !this.sdkClient) {
			throw new Error(`Server ${this.config.name} is not connected`);
		}
		return this.sdkClient.getPrompt({ name, arguments: args }, this.reqOpts());
	}

	private setStatus(status: McpServerStatus['status'], error?: string): void {
		this.status = status;
		this.error = error;
		this.emit('status', this.config.id, status, error);
	}

	private async loadCapabilities(): Promise<void> {
		const client = this.sdkClient;
		if (!client) return;

		const opts = this.reqOpts();

		try {
			const acc: McpToolDef[] = [];
			let cursor: string | undefined;
			do {
				const r = await client.listTools(cursor ? { cursor } : {}, opts);
				for (const t of r.tools) acc.push(mapSdkToolToMcp(t));
				cursor = r.nextCursor;
			} while (cursor);
			this.tools = acc;
			this.emit('tools_changed', this.config.id, this.tools);
		} catch {
			this.tools = [];
		}

		try {
			const acc: McpResourceDef[] = [];
			let cursor: string | undefined;
			do {
				const r = await client.listResources(cursor ? { cursor } : {}, opts);
				for (const res of r.resources) acc.push(mapSdkResourceToMcp(res));
				cursor = r.nextCursor;
			} while (cursor);
			this.resources = acc;
			this.emit('resources_changed', this.config.id, this.resources);
		} catch {
			this.resources = [];
		}

		try {
			const acc: McpPromptDef[] = [];
			let cursor: string | undefined;
			do {
				const r = await client.listPrompts(cursor ? { cursor } : {}, opts);
				for (const p of r.prompts) acc.push(mapSdkPromptToMcp(p));
				cursor = r.nextCursor;
			} while (cursor);
			this.prompts = acc;
			this.emit('prompts_changed', this.config.id, this.prompts);
		} catch {
			this.prompts = [];
		}
	}
}
