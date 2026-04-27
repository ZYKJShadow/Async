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
	clearBrowserSessionDataForHostId,
} from '../../browser/browserController.js';
import {
	clearBrowserCaptureDataForHostId,
	getBrowserCaptureRequestForHostId,
	getBrowserCaptureStateForHostId,
	listBrowserCaptureRequestDetailsForHostId,
	listBrowserCaptureRequestsForHostId,
	startBrowserCaptureForHostId,
	stopBrowserCaptureForHostId,
	syncBrowserCaptureBindingsForHostId,
} from '../../browser/browserCapture.js';
import {
	exportBrowserCaptureProxyCaForHostId,
	getBrowserCaptureProxyStatusForHostId,
	startBrowserCaptureProxyForHostId,
	stopBrowserCaptureProxyForHostId,
} from '../../browser/browserMitmProxy.js';

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

	ipcMain.handle('browser:clearData', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return await clearBrowserSessionDataForHostId(hostId);
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

	ipcMain.handle('composer:appendDraft', async (event, payload: unknown) => {
		const textRaw =
			typeof payload === 'string'
				? payload
				: payload && typeof payload === 'object' && typeof (payload as { text?: unknown }).text === 'string'
					? (payload as { text: string }).text
					: '';
		const text = textRaw.replace(/\r/g, '').trim();
		if (!text) {
			return { ok: false as const, error: 'empty-draft' as const };
		}
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const mainContents = webContents.fromId(hostId);
		if (!mainContents || mainContents.isDestroyed()) {
			return { ok: false as const, error: 'no-host' as const };
		}
		mainContents.send('async-shell:composerAppendDraft', { text: text.slice(0, 120_000) });
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

	ipcMain.handle('browserCapture:getState', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return {
			ok: true as const,
			state: getBrowserCaptureStateForHostId(hostId),
		};
	});

	ipcMain.handle('browserCapture:start', async (event, options: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const clear = !(options && typeof options === 'object' && (options as { clear?: unknown }).clear === false);
		return {
			ok: true as const,
			state: await startBrowserCaptureForHostId(hostId, { clear }),
		};
	});

	ipcMain.handle('browserCapture:stop', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return {
			ok: true as const,
			state: await stopBrowserCaptureForHostId(hostId),
		};
	});

	ipcMain.handle('browserCapture:clear', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return {
			ok: true as const,
			state: clearBrowserCaptureDataForHostId(hostId),
		};
	});

	ipcMain.handle('browserCapture:listRequests', async (event, options: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const obj = options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
		return {
			ok: true as const,
			result: listBrowserCaptureRequestsForHostId(hostId, {
				query: typeof obj.query === 'string' ? obj.query : undefined,
				tabId: typeof obj.tabId === 'string' ? obj.tabId : undefined,
				source: obj.source === 'browser' || obj.source === 'proxy' || obj.source === 'all' ? obj.source : undefined,
				method: typeof obj.method === 'string' ? obj.method : undefined,
				resourceType: typeof obj.resourceType === 'string' ? obj.resourceType : undefined,
				status: typeof obj.status === 'number' ? obj.status : null,
				statusGroup: typeof obj.statusGroup === 'string' ? obj.statusGroup : undefined,
				offset: typeof obj.offset === 'number' ? obj.offset : undefined,
				limit: typeof obj.limit === 'number' ? obj.limit : undefined,
			}),
		};
	});

	ipcMain.handle('browserCapture:exportRequests', async (event, options: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const obj = options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
		return {
			ok: true as const,
			requests: listBrowserCaptureRequestDetailsForHostId(hostId, {
				query: typeof obj.query === 'string' ? obj.query : undefined,
				tabId: typeof obj.tabId === 'string' ? obj.tabId : undefined,
				source: obj.source === 'browser' || obj.source === 'proxy' || obj.source === 'all' ? obj.source : undefined,
				method: typeof obj.method === 'string' ? obj.method : undefined,
				resourceType: typeof obj.resourceType === 'string' ? obj.resourceType : undefined,
				status: typeof obj.status === 'number' ? obj.status : null,
				statusGroup: typeof obj.statusGroup === 'string' ? obj.statusGroup : undefined,
				requestIds: Array.isArray(obj.requestIds)
					? obj.requestIds.filter((id): id is string => typeof id === 'string')
					: undefined,
				offset: typeof obj.offset === 'number' ? obj.offset : undefined,
				limit: typeof obj.limit === 'number' ? obj.limit : undefined,
			}),
		};
	});

	ipcMain.handle('browserCapture:getRequest', async (event, options: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const obj = options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
		const requestId = typeof obj.requestId === 'string' ? obj.requestId : undefined;
		const seq = typeof obj.seq === 'number' ? obj.seq : undefined;
		const request = getBrowserCaptureRequestForHostId(hostId, { requestId, seq });
		return request
			? { ok: true as const, request }
			: { ok: false as const, error: 'request-not-found' as const };
	});

	ipcMain.handle('browserCapture:proxyStatus', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return {
			ok: true as const,
			status: getBrowserCaptureProxyStatusForHostId(hostId),
		};
	});

	ipcMain.handle('browserCapture:proxyStart', async (event, options: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const obj = options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
		const port = typeof obj.port === 'number' ? obj.port : undefined;
		try {
			return {
				ok: true as const,
				status: await startBrowserCaptureProxyForHostId(hostId, { port }),
			};
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
				status: getBrowserCaptureProxyStatusForHostId(hostId),
			};
		}
	});

	ipcMain.handle('browserCapture:proxyStop', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return {
			ok: true as const,
			status: await stopBrowserCaptureProxyForHostId(hostId),
		};
	});

	ipcMain.handle('browserCapture:proxyExportCa', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		try {
			return {
				ok: true as const,
				ca: exportBrowserCaptureProxyCaForHostId(hostId),
			};
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});
}
