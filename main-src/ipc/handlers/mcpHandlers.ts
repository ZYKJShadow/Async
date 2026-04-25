import { ipcMain } from 'electron';
import {
	getMcpServerConfigs,
	addMcpServerConfig,
	removeMcpServerConfig,
} from '../../settingsStore.js';
import { getMcpManager, destroyMcpManager } from '../../mcp';
import type { McpServerConfig } from '../../mcp';
import { getEffectiveMcpServerConfigs } from '../../plugins/pluginRuntimeService.js';
import { senderWorkspaceRoot } from '../agentRuntime.js';

/**
 * `mcp:*` IPC：MCP 服务器配置 CRUD、启停、工具调用。
 * 行为与原 register.ts 一致；每次调用都会用当前工作区的有效 MCP 配置
 * （settings + plugin runtime 合并）刷新 manager。
 */
export function registerMcpHandlers(): void {
	ipcMain.handle('mcp:getServers', () => {
		return { ok: true as const, servers: getMcpServerConfigs() };
	});

	ipcMain.handle('mcp:listServers', () => {
		return { ok: true as const, servers: getMcpServerConfigs() };
	});

	ipcMain.handle('mcp:getStatuses', (event) => {
		const manager = getMcpManager();
		manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
		return { ok: true as const, statuses: manager.getServerStatuses() };
	});

	ipcMain.handle('mcp:saveServer', (event, config: McpServerConfig) => {
		try {
			addMcpServerConfig(config);
			const manager = getMcpManager();
			manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
			return { ok: true as const, server: config };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('mcp:deleteServer', (event, id: string) => {
		try {
			removeMcpServerConfig(id);
			const manager = getMcpManager();
			manager.removeServer(id);
			manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('mcp:startServer', async (event, id: string) => {
		try {
			const manager = getMcpManager();
			manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
			await manager.startServer(id);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('mcp:stopServer', async (_e, id: string) => {
		try {
			const manager = getMcpManager();
			await manager.stopServer(id);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('mcp:restartServer', async (event, id: string) => {
		try {
			const manager = getMcpManager();
			manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
			await manager.restartServer(id);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('mcp:startAll', async (event) => {
		try {
			const manager = getMcpManager();
			manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
			await manager.startAll();
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('mcp:getTools', (event) => {
		const manager = getMcpManager();
		manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
		return { ok: true as const, tools: manager.getAgentTools() };
	});

	ipcMain.handle('mcp:callTool', async (_e, name: string, args: Record<string, unknown>) => {
		try {
			const manager = getMcpManager();
			const result = await manager.callTool(name, args);
			return { ok: true as const, result };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('mcp:destroy', () => {
		destroyMcpManager();
		return { ok: true as const };
	});
}
