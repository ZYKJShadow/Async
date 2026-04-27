import { ipcMain, BrowserWindow, webContents, clipboard, shell as electronShell } from 'electron';
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
	appendBrowserCaptureHookEventsForHostId,
	listBrowserCaptureHookEventsForHostId,
	ingestBrowserCaptureStorageSnapshot,
	listBrowserCaptureStorageSnapshotsForHostId,
	snapshotBrowserCaptureSessionForHostId,
	restoreBrowserCaptureSessionForHostId,
} from '../../browser/browserCapture.js';
import {
	deleteCaptureSession,
	getCaptureSession,
	listCaptureSessions,
	renameCaptureSession,
	saveCaptureSession,
} from '../../captureSessionStore.js';
import {
	buildCaptureAnalysis,
	type CaptureAnalysisMode,
} from '../../captureAnalysis.js';
import {
	exportBrowserCaptureProxyCaForHostId,
	getBrowserCaptureProxyStatusForHostId,
	setBrowserCaptureProxyCaInstalled,
	setBrowserCaptureProxySystemProxyEnabled,
	startBrowserCaptureProxyForHostId,
	stopBrowserCaptureProxyForHostId,
} from '../../browser/browserMitmProxy.js';
import { CaInstaller } from '../../browser/browserCaInstaller.js';
import { SystemProxy } from '../../browser/browserSystemProxy.js';

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

	ipcMain.handle('browserCapture:hookIngest', async (event, payload: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
		const tabId = typeof obj.tabId === 'string' ? obj.tabId : null;
		const events = Array.isArray(obj.events) ? obj.events : [];
		const appended = appendBrowserCaptureHookEventsForHostId(hostId, tabId, events);
		return { ok: true as const, appended };
	});

	ipcMain.handle('browserCapture:hookList', async (event, options: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const obj = options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
		return {
			ok: true as const,
			result: listBrowserCaptureHookEventsForHostId(hostId, {
				offset: typeof obj.offset === 'number' ? obj.offset : undefined,
				limit: typeof obj.limit === 'number' ? obj.limit : undefined,
				category: typeof obj.category === 'string' ? obj.category : undefined,
				tabId: typeof obj.tabId === 'string' ? obj.tabId : undefined,
				query: typeof obj.query === 'string' ? obj.query : undefined,
			}),
		};
	});

	ipcMain.handle('browserCapture:storageIngest', async (event, payload: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
		const tabId = typeof obj.tabId === 'string' ? obj.tabId : null;
		const snapshot = obj.snapshot && typeof obj.snapshot === 'object' ? (obj.snapshot as Record<string, unknown>) : {};
		ingestBrowserCaptureStorageSnapshot(hostId, tabId, snapshot);
		return { ok: true as const };
	});

	ipcMain.handle('browserCapture:storageList', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return { ok: true as const, snapshots: listBrowserCaptureStorageSnapshotsForHostId(hostId) };
	});

	ipcMain.handle('browserCapture:sessionsList', async () => {
		return { ok: true as const, sessions: listCaptureSessions() };
	});

	ipcMain.handle('browserCapture:sessionsSave', async (event, payload: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
		const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : `Capture ${new Date().toLocaleString()}`;
		const note = typeof obj.note === 'string' ? obj.note : null;
		const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : undefined;
		const snapshot = snapshotBrowserCaptureSessionForHostId(hostId);
		if (!snapshot) {
			return { ok: false as const, error: 'no-active-session' as const };
		}
		const summary = saveCaptureSession({ id, name, note, ...snapshot });
		return { ok: true as const, session: summary };
	});

	ipcMain.handle('browserCapture:sessionsLoad', async (event, payload: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
		const id = typeof obj.id === 'string' ? obj.id : '';
		if (!id) {
			return { ok: false as const, error: 'missing-id' as const };
		}
		const detail = getCaptureSession(id);
		if (!detail) {
			return { ok: false as const, error: 'not-found' as const };
		}
		const state = restoreBrowserCaptureSessionForHostId(hostId, {
			requests: detail.requests,
			hookEvents: detail.hookEvents,
			storageSnapshots: detail.storageSnapshots,
		});
		return { ok: true as const, state, session: { id: detail.id, name: detail.name } };
	});

	ipcMain.handle('browserCapture:sessionsRename', async (_event, payload: unknown) => {
		const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
		const id = typeof obj.id === 'string' ? obj.id : '';
		const name = typeof obj.name === 'string' ? obj.name : '';
		if (!id || !name) {
			return { ok: false as const, error: 'invalid-args' as const };
		}
		const note = typeof obj.note === 'string' ? obj.note : null;
		const changed = renameCaptureSession(id, name, note);
		return { ok: changed };
	});

	ipcMain.handle('browserCapture:sessionsDelete', async (_event, payload: unknown) => {
		const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
		const id = typeof obj.id === 'string' ? obj.id : '';
		if (!id) {
			return { ok: false as const, error: 'missing-id' as const };
		}
		return { ok: deleteCaptureSession(id) };
	});

	ipcMain.handle('browserCapture:analyze', async (event, payload: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
		const modeRaw = typeof obj.mode === 'string' ? obj.mode : 'auto';
		const allowed: CaptureAnalysisMode[] = ['auto', 'api-reverse', 'security-audit', 'performance', 'crypto-reverse'];
		const mode: CaptureAnalysisMode = (allowed as string[]).includes(modeRaw) ? (modeRaw as CaptureAnalysisMode) : 'auto';
		const requestIds = Array.isArray(obj.requestIds)
			? obj.requestIds.filter((id): id is string => typeof id === 'string')
			: undefined;
		const customNote = typeof obj.note === 'string' ? obj.note : undefined;
		const maxRequests = typeof obj.maxRequests === 'number' ? obj.maxRequests : undefined;
		const deliver = obj.deliver !== false;
		const snapshot = snapshotBrowserCaptureSessionForHostId(hostId);
		if (!snapshot) {
			return { ok: false as const, error: 'no-active-session' as const };
		}
		const result = buildCaptureAnalysis(
			{
				requests: snapshot.requests,
				hookEvents: snapshot.hookEvents,
				storageSnapshots: snapshot.storageSnapshots,
			},
			{ mode, requestIds, customNote, maxRequests }
		);
		if (deliver) {
			const mainContents = webContents.fromId(hostId);
			if (mainContents && !mainContents.isDestroyed()) {
				mainContents.send('async-shell:composerAppendDraft', { text: result.prompt.slice(0, 120_000) });
				const win = BrowserWindow.fromWebContents(mainContents);
				if (win && !win.isDestroyed()) {
					if (win.isMinimized()) {
						win.restore();
					}
					win.show();
					win.focus();
				}
			}
		}
		return {
			ok: true as const,
			result: {
				mode: result.mode,
				scenes: result.scenes,
				prompt: result.prompt,
				cryptoSnippets: result.cryptoSnippets,
				usedRequestCount: result.usedRequestCount,
				totalRequestCount: result.totalRequestCount,
				hookEventCount: result.hookEventCount,
				storageHostCount: result.storageHostCount,
			},
		};
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
		const enableSystemProxy = obj.systemProxy === true;
		try {
			const status = await startBrowserCaptureProxyForHostId(hostId, { port });
			let systemProxyError: string | null = null;
			if (enableSystemProxy && status.running) {
				const result = await SystemProxy.enable('127.0.0.1', status.port);
				if (result.ok) {
					setBrowserCaptureProxySystemProxyEnabled(true);
				} else {
					systemProxyError = result.error;
				}
			}
			// Refresh CA installed flag in the background.
			void CaInstaller.isInstalled().then((installed) => {
				setBrowserCaptureProxyCaInstalled(installed);
			});
			const refreshed = getBrowserCaptureProxyStatusForHostId(hostId);
			return systemProxyError
				? { ok: true as const, status: refreshed, systemProxyError }
				: { ok: true as const, status: refreshed };
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
		await stopBrowserCaptureProxyForHostId(hostId);
		// Always restore system proxy if we toggled it.
		if (SystemProxy.hasSavedState()) {
			const result = await SystemProxy.disable();
			if (result.ok) {
				setBrowserCaptureProxySystemProxyEnabled(false);
			}
		} else {
			setBrowserCaptureProxySystemProxyEnabled(false);
		}
		return {
			ok: true as const,
			status: getBrowserCaptureProxyStatusForHostId(hostId),
		};
	});

	ipcMain.handle('browserCapture:proxySystemProxyToggle', async (event, options: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const status = getBrowserCaptureProxyStatusForHostId(hostId);
		const obj = options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
		const desired = obj.enable !== false;
		if (desired) {
			if (!status.running) {
				return { ok: false as const, error: 'proxy-not-running' as const };
			}
			const result = await SystemProxy.enable('127.0.0.1', status.port);
			if (!result.ok) {
				return { ok: false as const, error: result.error };
			}
			setBrowserCaptureProxySystemProxyEnabled(true);
		} else {
			const result = await SystemProxy.disable();
			if (!result.ok) {
				return { ok: false as const, error: result.error };
			}
			setBrowserCaptureProxySystemProxyEnabled(false);
		}
		return { ok: true as const, status: getBrowserCaptureProxyStatusForHostId(hostId) };
	});

	ipcMain.handle('browserCapture:proxyCaInstall', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const ca = exportBrowserCaptureProxyCaForHostId(hostId);
		const result = await CaInstaller.install(ca.path);
		if (!result.ok) {
			return { ok: false as const, error: result.error };
		}
		const installed = await CaInstaller.isInstalled();
		setBrowserCaptureProxyCaInstalled(installed);
		return { ok: true as const, installed };
	});

	ipcMain.handle('browserCapture:proxyCaUninstall', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const ca = exportBrowserCaptureProxyCaForHostId(hostId);
		const result = await CaInstaller.uninstall(ca.path);
		if (!result.ok) {
			return { ok: false as const, error: result.error };
		}
		const installed = await CaInstaller.isInstalled();
		setBrowserCaptureProxyCaInstalled(installed);
		return { ok: true as const, installed };
	});

	ipcMain.handle('browserCapture:proxyCaRefresh', async () => {
		const installed = await CaInstaller.isInstalled();
		setBrowserCaptureProxyCaInstalled(installed);
		const systemProxyEnabled = await SystemProxy.isEnabled('127.0.0.1', 8888);
		setBrowserCaptureProxySystemProxyEnabled(systemProxyEnabled);
		return { ok: true as const, installed, systemProxyEnabled };
	});

	ipcMain.handle('browserCapture:proxyOpenCaPath', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const ca = exportBrowserCaptureProxyCaForHostId(hostId);
		electronShell.showItemInFolder(ca.path);
		return { ok: true as const, path: ca.path };
	});

	ipcMain.handle('browserCapture:proxyCopySnippet', async (event, options: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const status = getBrowserCaptureProxyStatusForHostId(hostId);
		const obj = options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
		const kind = typeof obj.kind === 'string' ? (obj.kind as string) : 'curl';
		const host = status.primaryAddress;
		const port = status.port;
		const proxy = `${host}:${port}`;
		let snippet = '';
		if (kind === 'curl') {
			snippet = `curl -x http://${proxy} --cacert "${status.caCertPath}" https://example.com`;
		} else if (kind === 'wget') {
			snippet = `https_proxy=http://${proxy} http_proxy=http://${proxy} wget --ca-certificate="${status.caCertPath}" https://example.com`;
		} else if (kind === 'python') {
			snippet =
				`# pip install requests certifi\n` +
				`import requests\n` +
				`PROXIES = { 'http': 'http://${proxy}', 'https': 'http://${proxy}' }\n` +
				`# Trust the Async capture CA so HTTPS interception verifies cleanly:\n` +
				`# export REQUESTS_CA_BUNDLE="${status.caCertPath}"\n` +
				`r = requests.get('https://example.com', proxies=PROXIES, verify='${status.caCertPath}')\n` +
				`print(r.status_code, len(r.content))`;
		} else if (kind === 'node') {
			snippet =
				`// npm i undici\n` +
				`import { ProxyAgent, fetch } from 'undici';\n` +
				`process.env.NODE_EXTRA_CA_CERTS = '${status.caCertPath}';\n` +
				`const dispatcher = new ProxyAgent('http://${proxy}');\n` +
				`const res = await fetch('https://example.com', { dispatcher });\n` +
				`console.log(res.status);`;
		} else if (kind === 'env') {
			snippet =
				process.platform === 'win32'
					? `setx HTTP_PROXY "http://${proxy}"\nsetx HTTPS_PROXY "http://${proxy}"\n` +
						`set NODE_EXTRA_CA_CERTS=${status.caCertPath}`
					: `export HTTP_PROXY="http://${proxy}"\n` +
						`export HTTPS_PROXY="http://${proxy}"\n` +
						`export NODE_EXTRA_CA_CERTS="${status.caCertPath}"`;
		} else {
			snippet = `http://${proxy}`;
		}
		clipboard.writeText(snippet);
		return { ok: true as const, snippet };
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
