import { ipcMain, BrowserWindow, webContents } from 'electron';
import {
	browserPartitionForHostId,
	getBrowserSidebarConfigPayloadForHostId,
	setBrowserSidebarConfigForHostId,
	sendApplyConfigToDetachedBrowserWindowIfOpen,
	updateBrowserRuntimeStateForHostId,
	getBrowserRuntimeStateForHostId,
	resolveBrowserCommandResultForHostId,
	resolveBrowserHostIdForSenderId,
	markBrowserWindowReadyForSenderId,
	openBrowserWindowForHostId,
} from '../../browser/browserController.js';
import { syncBrowserCaptureBindingsForHostId } from '../../browser/browserCapture.js';

/** Settings 顶部导航的合法 nav id；与原 register.ts 保持一致。 */
const SETTINGS_OPEN_NAV_IDS = new Set([
	'general',
	'appearance',
	'editor',
	'plan',
	'team',
	'bots',
	'agents',
	'models',
	'plugins',
	'rules',
	'tools',
	'indexing',
	'autoUpdate',
	'browser',
]);

/**
 * `browser:*` IPC + `app:requestOpenSettings`（共享 browser host 解析逻辑，故同档）。
 * 行为与原 register.ts 一致。
 */
export function registerBrowserHandlers(): void {
	ipcMain.handle('browser:getConfig', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const partition = browserPartitionForHostId(hostId);
		const payload = await getBrowserSidebarConfigPayloadForHostId(hostId);
		return {
			ok: true as const,
			partition,
			config: payload.config,
			defaultUserAgent: payload.defaultUserAgent,
		};
	});

	ipcMain.handle('browser:setConfig', async (event, rawConfig: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const result = await setBrowserSidebarConfigForHostId(hostId, rawConfig);
		if (result.ok) {
			sendApplyConfigToDetachedBrowserWindowIfOpen(hostId, result.config, result.defaultUserAgent);
		}
		return result;
	});

	ipcMain.handle('app:requestOpenSettings', async (event, payload: unknown) => {
		const navRaw =
			payload && typeof payload === 'object' && typeof (payload as { nav?: unknown }).nav === 'string'
				? String((payload as { nav: string }).nav).trim()
				: '';
		const nav = navRaw || 'general';
		if (!SETTINGS_OPEN_NAV_IDS.has(nav)) {
			return { ok: false as const, error: 'invalid-nav' as const };
		}
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const mainContents = webContents.fromId(hostId);
		if (!mainContents || mainContents.isDestroyed()) {
			return { ok: false as const, error: 'no-host' as const };
		}
		mainContents.send('async-shell:openSettingsNav', nav);
		const win = BrowserWindow.fromWebContents(mainContents);
		if (win && !win.isDestroyed()) {
			if (win.isMinimized()) {
				win.restore();
			}
			win.show();
			win.focus();
		}
		return { ok: true as const };
	});

	ipcMain.handle('browser:syncState', async (event, rawState: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		syncBrowserCaptureBindingsForHostId(hostId, rawState);
		const state = updateBrowserRuntimeStateForHostId(hostId, rawState);
		return {
			ok: true as const,
			state,
		};
	});

	ipcMain.handle('browser:getState', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return {
			ok: true as const,
			state: getBrowserRuntimeStateForHostId(hostId),
		};
	});

	ipcMain.handle('browser:commandResult', async (event, payload: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return {
			ok: resolveBrowserCommandResultForHostId(hostId, payload),
		};
	});

	ipcMain.handle('browser:windowReady', async (event) => {
		markBrowserWindowReadyForSenderId(event.sender.id);
		return { ok: true as const };
	});

	ipcMain.handle('browser:openWindow', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return { ok: await openBrowserWindowForHostId(hostId) };
	});
}
