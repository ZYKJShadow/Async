/**
 * MCP (Model Context Protocol) 模块
 * 提供与 MCP 服务器的连接管理和工具集成
 */

export * from './mcpTypes.js';
export { McpClient, type McpClientEvents } from './mcpClient.js';
export { McpManager, getMcpManager, destroyMcpManager, type McpManagerEvents, type McpToolWithSource } from './mcpManager.js';