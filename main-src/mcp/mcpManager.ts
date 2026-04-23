/**
 * MCP 管理器 — 管理多个 MCP Server 连接
 */

import { EventEmitter } from 'node:events';
import { McpClient, type McpClientEvents } from './mcpClient.js';
import type {
	McpServerConfig,
	McpToolDef,
	McpServerStatus,
	McpToolResult,
} from './mcpTypes.js';
import type { AgentToolDef } from '../agent/agentTools.js';
import { buildMcpToolName } from './mcpStringUtils.js';
import { resolveMcpToolInvocation } from './mcpToolResolve.js';

export type McpManagerEvents = {
	servers_changed: [];
	status_changed: [serverId: string];
	tools_updated: [];
};

export type McpToolWithSource = McpToolDef & {
	serverId: string;
	serverName: string;
};

function normalizeMcpServerStatus(status: McpServerStatus['status']): McpServerStatus['status'] {
	return status === 'disconnected' ? 'stopped' : status;
}

function mcpConfigsEquivalent(a: McpServerConfig, b: McpServerConfig): boolean {
	const normRecord = (value?: Record<string, string>): string =>
		value
			? Object.entries(value)
					.sort(([ak], [bk]) => ak.localeCompare(bk))
					.map(([k, v]) => `${k}=${v}`)
					.join('\n')
			: '';
	const normArgs = (value?: string[]): string => (value ?? []).join('\u0000');
	return (
		a.id === b.id &&
		a.name === b.name &&
		a.enabled === b.enabled &&
		a.transport === b.transport &&
		(a.command ?? '') === (b.command ?? '') &&
		(a.url ?? '') === (b.url ?? '') &&
		(a.autoStart ?? true) === (b.autoStart ?? true) &&
		(a.timeout ?? 30_000) === (b.timeout ?? 30_000) &&
		normArgs(a.args) === normArgs(b.args) &&
		normRecord(a.env) === normRecord(b.env) &&
		normRecord(a.headers) === normRecord(b.headers)
	);
}

/** 将 MCP 工具转换为 Agent 工具格式 */
function mcpToolToAgentTool(tool: McpToolWithSource): AgentToolDef {
	return {
		name: buildMcpToolName(tool.serverId, tool.name),
		description: tool.description ?? `MCP tool: ${tool.name} (from ${tool.serverName})`,
		shouldDefer: true,
		isMcp: true,
		schemaCacheKey: `${tool.serverId}:${tool.name}`,
		parameters: {
			type: 'object',
			properties: (tool.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>,
			required: tool.inputSchema.required ?? [],
		},
	};
}

export class McpManager extends EventEmitter<McpManagerEvents> {
	private clients = new Map<string, McpClient>();
	private configs: McpServerConfig[] = [];
	private toolsWithSource: McpToolWithSource[] = [];

	/** 获取所有服务器状态 */
	getServerStatuses(): McpServerStatus[] {
		return this.configs.map((config) => {
			if (!config.enabled) {
				return {
					id: config.id,
					status: 'disabled',
					tools: [],
					resources: [],
					prompts: [],
				};
			}
			const client = this.clients.get(config.id);
			if (!client) {
				return {
					id: config.id,
					status: 'not_started',
					tools: [],
					resources: [],
					prompts: [],
				};
			}
			const status = client.getServerStatus();
			return {
				...status,
				status: normalizeMcpServerStatus(status.status),
			};
		});
	}

	/** 获取所有可用工具（含来源信息） */
	getToolsWithSource(): McpToolWithSource[] {
		return this.toolsWithSource;
	}

	/** 获取 Agent 工具定义列表 */
	getAgentTools(): AgentToolDef[] {
		return this.toolsWithSource.map(mcpToolToAgentTool);
	}

	/** 加载配置 */
	loadConfigs(configs: McpServerConfig[]): void {
		const nextById = new Map(configs.map((config) => [config.id, config] as const));
		for (const [id, client] of this.clients.entries()) {
			const next = nextById.get(id);
			if (!next) {
				client.destroy();
				this.clients.delete(id);
				continue;
			}
			const clientStatus = client.getServerStatus().status;
			// 保护正在连接中的 client，避免并发操作导致状态混乱
			if (clientStatus === 'connecting') {
				continue;
			}
			if (!next.enabled || !mcpConfigsEquivalent(client.config, next)) {
				client.destroy();
				this.clients.delete(id);
			}
		}
		this.configs = configs;
		this.updateTools();
		this.emit('servers_changed');
	}

	/** 获取当前配置 */
	getConfigs(): McpServerConfig[] {
		return this.configs;
	}

/** 已连接客户端（用于资源列举等） */
	getConnectedClients(): McpClient[] {
		return Array.from(this.clients.values()).filter((c) => c.getServerStatus().status === 'connected');
	}

	/** 按配置 id 或显示名解析客户端（与 ListMcpResources / ReadMcpResource 的 server 参数一致） */
	getClientByServerRef(ref: string): McpClient | undefined {
		for (const c of this.clients.values()) {
			if (c.config.id === ref || c.config.name === ref) return c;
		}
		return undefined;
	}

	/** 启动所有已启用且 autoStart 的服务器 */
	async startAll(): Promise<void> {
		const toStart = this.configs.filter((c) => c.enabled && c.autoStart !== false);
		await Promise.allSettled(toStart.map((c) => this.startServer(c.id)));
	}

	/** 启动单个服务器 */
	async startServer(id: string): Promise<void> {
		const config = this.configs.find((c) => c.id === id);
		if (!config) {
			throw new Error(`Server config not found: ${id}`);
		}

		let client = this.clients.get(id);
		if (!client) {
			client = new McpClient(config);
			this.setupClientListeners(client);
			this.clients.set(id, client);
		}

		await client.connect();
	}

	/** 停止单个服务器 */
	async stopServer(id: string): Promise<void> {
		const client = this.clients.get(id);
		if (client) {
			await client.disconnect();
		}
	}

	/** 重启服务器 */
	async restartServer(id: string): Promise<void> {
		await this.stopServer(id);
		await this.startServer(id);
	}

	/** 移除服务器 */
	removeServer(id: string): void {
		const client = this.clients.get(id);
		if (client) {
			client.destroy();
			this.clients.delete(id);
		}
		this.configs = this.configs.filter((c) => c.id !== id);
		this.updateTools();
		this.emit('servers_changed');
	}

	/** 调用工具（按规范化名匹配 server，按远端真实 tool name 调用） */
	async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
		const resolved = resolveMcpToolInvocation(Array.from(this.clients.values()), name);
		if (!resolved.ok) {
			throw new Error(resolved.message);
		}
		const client = resolved.client as McpClient;
		return client.callTool(resolved.toolName, args, signal);
	}

	/** 判断工具名是否为 MCP 工具 */
	isMcpTool(name: string): boolean {
		return name.startsWith('mcp__');
	}

	/** 销毁所有连接 */
	destroy(): void {
		for (const client of this.clients.values()) {
			client.destroy();
		}
		this.clients.clear();
		this.removeAllListeners();
	}

	private setupClientListeners(client: McpClient): void {
		client.on('status', (serverId, status, error) => {
			this.emit('status_changed', serverId);
			if (status === 'connected') {
				this.updateTools();
			}
		});

		client.on('tools_changed', () => {
			this.updateTools();
		});

		client.on('error', (serverId, error) => {
			console.error(`[MCP ${serverId}] Error:`, error);
		});

		client.on('destroyed', (serverId) => {
			this.clients.delete(serverId);
			this.updateTools();
		});
	}

	private updateTools(): void {
		const tools: McpToolWithSource[] = [];

		for (const client of this.clients.values()) {
			const status = client.getServerStatus();
			if (status.status === 'connected') {
				for (const tool of status.tools) {
					tools.push({
						...tool,
						serverId: client.config.id,
						serverName: client.config.name,
					});
				}
			}
		}

		this.toolsWithSource = tools;
		this.emit('tools_updated');
	}
}

/** 全局单例 */
let mcpManager: McpManager | null = null;

export function getMcpManager(): McpManager {
	if (!mcpManager) {
		mcpManager = new McpManager();
	}
	return mcpManager;
}

export function destroyMcpManager(): void {
	if (mcpManager) {
		mcpManager.destroy();
		mcpManager = null;
	}
}
