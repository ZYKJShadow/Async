import { ipcMain, BrowserWindow, dialog } from 'electron';
import * as path from 'node:path';
import {
	addMarketplaceFromInput,
	getPluginPanelState,
	installMarketplacePlugin,
	removeMarketplaceByName,
	refreshMarketplaceByName,
	setConfiguredUserPluginsRoot,
	setInstalledPluginEnabled,
	uninstallInstalledPlugin,
} from '../../plugins/pluginMarketplaceService.js';
import { getPluginRuntimeState } from '../../plugins/pluginRuntimeService.js';
import { broadcastPluginsChanged, senderWorkspaceRoot } from '../agentRuntime.js';

/**
 * `plugins:*` IPC：插件市场 + 已装插件管理。
 * 任何会变更已安装插件状态的调用都会广播 `async-shell:pluginsChanged`，
 * 行为与原 register.ts 完全一致。
 */
export function registerPluginsHandlers(): void {
	ipcMain.handle('plugins:getState', async (event) => {
		return await getPluginPanelState(senderWorkspaceRoot(event));
	});

	ipcMain.handle('plugins:getRuntimeState', async (event) => {
		return getPluginRuntimeState(senderWorkspaceRoot(event));
	});

	ipcMain.handle('plugins:pickUserDirectory', async (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const options = {
			properties: ['openDirectory', 'createDirectory'],
		} satisfies Electron.OpenDialogOptions;
		const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
		if (result.canceled || !result.filePaths[0]) {
			return { ok: false as const };
		}
		return { ok: true as const, path: path.resolve(result.filePaths[0]) };
	});

	ipcMain.handle('plugins:setUserDirectory', async (_event, payload: unknown) => {
		const nextPath =
			payload && typeof payload === 'object' && typeof (payload as { path?: unknown }).path === 'string'
				? String((payload as { path: string }).path)
				: null;
		const reset =
			payload && typeof payload === 'object' && (payload as { reset?: unknown }).reset === true;
		try {
			const result = {
				ok: true as const,
				...setConfiguredUserPluginsRoot(reset ? null : nextPath),
			};
			broadcastPluginsChanged();
			return result;
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('plugins:addMarketplace', async (_event, payload: unknown) => {
		const input =
			payload && typeof payload === 'object' && typeof (payload as { input?: unknown }).input === 'string'
				? String((payload as { input: string }).input)
				: '';
		try {
			return {
				ok: true as const,
				...(await addMarketplaceFromInput(input)),
			};
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('plugins:refreshMarketplace', async (_event, payload: unknown) => {
		const name =
			payload && typeof payload === 'object' && typeof (payload as { name?: unknown }).name === 'string'
				? String((payload as { name: string }).name).trim()
				: '';
		if (!name) {
			return { ok: false as const, error: 'Marketplace name is required.' };
		}
		try {
			await refreshMarketplaceByName(name);
			return { ok: true as const };
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('plugins:removeMarketplace', async (_event, payload: unknown) => {
		const name =
			payload && typeof payload === 'object' && typeof (payload as { name?: unknown }).name === 'string'
				? String((payload as { name: string }).name).trim()
				: '';
		if (!name) {
			return { ok: false as const, error: 'Marketplace name is required.' };
		}
		try {
			await removeMarketplaceByName(name);
			return { ok: true as const };
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('plugins:install', async (event, payload: unknown) => {
		const marketplaceName =
			payload && typeof payload === 'object' && typeof (payload as { marketplaceName?: unknown }).marketplaceName === 'string'
				? String((payload as { marketplaceName: string }).marketplaceName).trim()
				: '';
		const pluginName =
			payload && typeof payload === 'object' && typeof (payload as { pluginName?: unknown }).pluginName === 'string'
				? String((payload as { pluginName: string }).pluginName).trim()
				: '';
		const scope =
			payload && typeof payload === 'object' && (payload as { scope?: unknown }).scope === 'project'
				? 'project'
				: 'user';
		if (!marketplaceName || !pluginName) {
			return { ok: false as const, error: 'Marketplace name and plugin name are required.' };
		}
		try {
			const result = {
				ok: true as const,
				...(await installMarketplacePlugin(marketplaceName, pluginName, scope, senderWorkspaceRoot(event))),
			};
			broadcastPluginsChanged();
			return result;
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('plugins:uninstall', async (event, payload: unknown) => {
		const installDir =
			payload && typeof payload === 'object' && typeof (payload as { installDir?: unknown }).installDir === 'string'
				? String((payload as { installDir: string }).installDir).trim()
				: '';
		if (!installDir) {
			return { ok: false as const, error: 'Plugin install directory is required.' };
		}
		try {
			await uninstallInstalledPlugin(installDir, senderWorkspaceRoot(event));
			broadcastPluginsChanged();
			return { ok: true as const };
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('plugins:setEnabled', async (event, payload: unknown) => {
		const installDir =
			payload && typeof payload === 'object' && typeof (payload as { installDir?: unknown }).installDir === 'string'
				? String((payload as { installDir: string }).installDir).trim()
				: '';
		const enabled =
			payload && typeof payload === 'object' && typeof (payload as { enabled?: unknown }).enabled === 'boolean'
				? Boolean((payload as { enabled: boolean }).enabled)
				: true;
		if (!installDir) {
			return { ok: false as const, error: 'Plugin install directory is required.' };
		}
		try {
			await setInstalledPluginEnabled(installDir, enabled, senderWorkspaceRoot(event));
			broadcastPluginsChanged();
			return { ok: true as const };
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});
}
