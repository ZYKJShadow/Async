/**
 * MCP (Model Context Protocol) 类型定义
 * 参考：https://spec.modelcontextprotocol.io/
 */

/** MCP Server 配置 */
export type McpServerConfig = {
	/** 唯一标识 */
	id: string;
	/** 显示名称 */
	name: string;
	/** 启用状态 */
	enabled: boolean;
	/** Transport 类型 */
	transport: 'stdio' | 'sse' | 'http';
	/** stdio 配置 */
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	/** 远程 MCP 端点（SSE 或 Streamable HTTP） */
	url?: string;
	headers?: Record<string, string>;
	/** 自动启动（默认 true） */
	autoStart?: boolean;
	/** 超时（毫秒，默认 30000） */
	timeout?: number;
	pluginSourceName?: string;
	pluginSourceRelPath?: string;
	pluginManaged?: boolean;
};

/** MCP 工具定义（来自 server） */
export type McpToolDef = {
	name: string;
	description?: string;
	inputSchema: {
		type: 'object';
		properties?: Record<string, unknown>;
		required?: string[];
	};
};

/** MCP 资源定义 */
export type McpResourceDef = {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
};

/** MCP 提示定义 */
export type McpPromptDef = {
	name: string;
	description?: string;
 arguments?: Array<{ name: string; description?: string; required?: boolean }>;
};

/** MCP Server 状态 */
export type McpServerStatus = {
	id: string;
	status: 'disconnected' | 'connecting' | 'connected' | 'error';
	error?: string;
	tools: McpToolDef[];
	resources: McpResourceDef[];
	prompts: McpPromptDef[];
	/** 最后连接时间 */
	lastConnected?: number;
};

/** MCP 工具调用结果 */
export type McpToolResult = {
	content: Array<{
		type: 'text' | 'image' | 'resource';
		text?: string;
		data?: string;
		mimeType?: string;
	}>;
	isError?: boolean;
};

/** JSON-RPC 请求 */
export type JsonRpcRequest = {
	jsonrpc: '2.0';
	id: number | string;
	method: string;
	params?: unknown;
};

/** JSON-RPC 响应 */
export type JsonRpcResponse = {
	jsonrpc: '2.0';
	id: number | string;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
};

/** JSON-RPC 通知 */
export type JsonRpcNotification = {
	jsonrpc: '2.0';
	method: string;
	params?: unknown;
};

/** MCP 初始化结果 */
export type McpInitializeResult = {
	protocolVersion: string;
	capabilities: {
		tools?: { listChanged?: boolean };
		resources?: { subscribe?: boolean; listChanged?: boolean };
		prompts?: { listChanged?: boolean };
		logging?: {};
	};
	serverInfo: {
		name: string;
		version: string;
	};
};

/** MCP 客户端事件 */
export type McpClientEvent = {
	type: 'status' | 'tools_changed' | 'resources_changed' | 'prompts_changed' | 'error';
	serverId: string;
	data?: unknown;
};
