/**
 * MCP (Model Context Protocol) 前端类型定义
 * 与 main-src/mcp/mcpTypes.ts 保持一致
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
	/** SSE/HTTP 配置 */
	url?: string;
	headers?: Record<string, string>;
	/** 自动启动（默认 true） */
	autoStart?: boolean;
	/** 超时（毫秒，默认 30000） */
	timeout?: number;
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

/** Agent 工具定义（用于 MCP 工具转换） */
export type AgentToolDef = {
	name: string;
	description: string;
	parameters: {
		type: 'object';
		properties: Record<string, Record<string, unknown>>;
		required: string[];
	};
};

/** 带来源信息的 MCP 工具 */
export type McpToolWithSource = McpToolDef & {
	serverId: string;
	serverName: string;
};

/** 预设 MCP 服务器模板 */
export type McpServerTemplate = {
	id: string;
	name: string;
	description: string;
	transport: 'stdio' | 'sse';
	command?: string;
	args?: string[];
	url?: string;
	env?: Record<string, string>;
};

/** MCP 预设模板列表 */
export const MCP_SERVER_TEMPLATES: McpServerTemplate[] = [
	{
		id: 'filesystem',
		name: 'Filesystem',
		description: 'Local filesystem access with configurable paths',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'],
	},
	{
		id: 'github',
		name: 'GitHub',
		description: 'GitHub API integration for repos, issues, PRs',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-github'],
		env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
	},
	{
		id: 'postgres',
		name: 'PostgreSQL',
		description: 'PostgreSQL database query and schema inspection',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-postgres'],
		env: { POSTGRES_CONNECTION_STRING: '' },
	},
	{
		id: 'sqlite',
		name: 'SQLite',
		description: 'SQLite database query and inspection',
		transport: 'stdio',
		command: 'uvx',
		args: ['mcp-server-sqlite', '--db-path', '/path/to/database.db'],
	},
	{
		id: 'fetch',
		name: 'Fetch',
		description: 'Web content fetching and search',
		transport: 'stdio',
		command: 'uvx',
		args: ['mcp-server-fetch'],
	},
	{
		id: 'brave-search',
		name: 'Brave Search',
		description: 'Brave search engine integration',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-brave-search'],
		env: { BRAVE_API_KEY: '' },
	},
	{
		id: 'puppeteer',
		name: 'Puppeteer',
		description: 'Browser automation and web scraping',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-puppeteer'],
	},
	{
		id: 'slack',
		name: 'Slack',
		description: 'Slack API integration for channels and messages',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-slack'],
		env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
	},
];