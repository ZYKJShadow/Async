import { BrowserWindow, session, webContents, type WebContents } from 'electron';
import { getWorkspaceRootForWebContents } from '../workspace.js';
import {
	normalizeBrowserFingerprintSpoof,
	type BrowserFingerprintSpoofSettings,
} from './browserFingerprintNormalize.js';

export type BrowserSidebarConfig = {
	userAgent: string;
	acceptLanguage: string;
	extraHeadersText: string;
	extraHeaders: Array<[string, string]>;
	blockTrackers: boolean;
	proxyMode: 'system' | 'direct' | 'custom';
	proxyRules: string;
	proxyBypassRules: string;
	fingerprint: BrowserFingerprintSpoofSettings;
};

export type BrowserSidebarConfigPayload = {
	userAgent: string;
	acceptLanguage: string;
	extraHeadersText: string;
	blockTrackers: boolean;
	proxyMode: 'system' | 'direct' | 'custom';
	proxyRules: string;
	proxyBypassRules: string;
	fingerprint: BrowserFingerprintSpoofSettings;
};

export type BrowserRuntimeTabState = {
	id: string;
	requestedUrl: string;
	currentUrl: string;
	pageTitle: string;
	isLoading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	loadError: { message: string; url: string } | null;
};

export type BrowserRuntimeState = {
	activeTabId: string | null;
	tabs: BrowserRuntimeTabState[];
	updatedAt: number;
};

export type BrowserControlCommand =
	| {
			commandId: string;
			type: 'navigate';
			target: string;
			newTab?: boolean;
	  }
	| {
			commandId: string;
			type: 'closeSidebar';
	  }
	| {
			commandId: string;
			type: 'reload' | 'stop' | 'goBack' | 'goForward' | 'closeTab';
			tabId?: string;
	  }
	| {
			commandId: string;
			type: 'readPage';
			tabId?: string;
			selector?: string;
			includeHtml?: boolean;
			maxChars?: number;
			waitForLoad?: boolean;
	  }
	| {
			commandId: string;
			type: 'screenshotPage';
			tabId?: string;
			waitForLoad?: boolean;
	  }
	| {
			commandId: string;
			type: 'clickElement';
			tabId?: string;
			selector: string;
			waitForLoad?: boolean;
	  }
	| {
			commandId: string;
			type: 'inputText';
			tabId?: string;
			selector: string;
			text: string;
			pressEnter?: boolean;
			waitForLoad?: boolean;
	  }
	| {
			commandId: string;
			type: 'waitForSelector';
			tabId?: string;
			selector: string;
			visible?: boolean;
			waitForLoad?: boolean;
			timeoutMs?: number;
	  }
	| {
			commandId: string;
			type: 'applyConfig';
			config: BrowserSidebarConfigPayload;
			defaultUserAgent?: string;
	  };

export type BrowserCommandResult =
	| {
			commandId: string;
			ok: true;
			result: unknown;
	  }
	| {
			commandId: string;
			ok: false;
			error: string;
	  };

const DEFAULT_BROWSER_SIDEBAR_CONFIG: BrowserSidebarConfig = {
	userAgent: '',
	acceptLanguage: '',
	extraHeadersText: '',
	extraHeaders: [],
	blockTrackers: true,
	proxyMode: 'system',
	proxyRules: '',
	proxyBypassRules: '',
	fingerprint: {},
};

const TRACKER_BLOCKED_DOMAIN_SUFFIXES = [
	'2mdn.net',
	'addthis.com',
	'adnxs.com',
	'adsafeprotected.com',
	'adsrvr.org',
	'amazon-adsystem.com',
	'bidr.io',
	'bluekai.com',
	'bounceexchange.com',
	'casalemedia.com',
	'connatix.com',
	'criteo.com',
	'criteo.net',
	'demdex.net',
	'doubleclick.net',
	'everesttech.net',
	'google-analytics.com',
	'googleadservices.com',
	'googlesyndication.com',
	'googletagmanager.com',
	'googletagservices.com',
	'lijit.com',
	'mathtag.com',
	'moatads.com',
	'omtrdc.net',
	'openx.net',
	'ottadvisors.com',
	'outbrain.com',
	'pubmatic.com',
	'quantserve.com',
	'rubiconproject.com',
	'scorecardresearch.com',
	'serving-sys.com',
	'sharethrough.com',
	'smartadserver.com',
	'taboola.com',
	'teads.tv',
	'zemanta.com',
] as const;

const BROWSER_TRACKER_BLOCKED_RESOURCE_TYPES = new Set([
	'image',
	'imageset',
	'media',
	'object',
	'other',
	'ping',
	'script',
	'stylesheet',
	'subFrame',
	'webSocket',
	'webTransport',
	'xmlhttprequest',
]);

const browserSidebarConfigsByHost = new Map<number, BrowserSidebarConfig>();
const browserSidebarConfigsByPartition = new Map<string, BrowserSidebarConfig>();
const browserSidebarHookedPartitions = new Set<string>();
const browserDefaultUserAgentByPartition = new Map<string, string>();
const browserRuntimeStateByHost = new Map<number, BrowserRuntimeState>();
const browserPendingCommandResults = new Map<
	string,
	{
		resolve: (result: BrowserCommandResult) => void;
		timer: ReturnType<typeof setTimeout>;
		hostId: number;
	}
>();
const browserWindowRendererByHost = new Map<number, number>();
const browserWindowHostByRenderer = new Map<number, number>();
const browserWindowOpenByHost = new Map<number, Promise<number>>();
const browserWindowReadyRenderers = new Set<number>();
const browserWindowReadyWaiters = new Map<
	number,
	{
		resolve: () => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}
>();

function cleanupBrowserWindowRegistration(rendererId: number): void {
	const hostId = browserWindowHostByRenderer.get(rendererId);
	if (hostId != null && browserWindowRendererByHost.get(hostId) === rendererId) {
		browserWindowRendererByHost.delete(hostId);
	}
	browserWindowHostByRenderer.delete(rendererId);
	browserWindowReadyRenderers.delete(rendererId);
	const waiter = browserWindowReadyWaiters.get(rendererId);
	if (waiter) {
		clearTimeout(waiter.timer);
		waiter.reject(new Error('Browser window was closed before it became ready.'));
		browserWindowReadyWaiters.delete(rendererId);
	}
}

function resolveBrowserCommandTargetId(hostId: number): number {
	const mappedRendererId = browserWindowRendererByHost.get(hostId);
	if (mappedRendererId != null) {
		try {
			const mapped = webContents.fromId(mappedRendererId);
			if (mapped && !mapped.isDestroyed()) {
				return mappedRendererId;
			}
		} catch {
			/* ignore */
		}
		cleanupBrowserWindowRegistration(mappedRendererId);
	}
	return hostId;
}

function waitForBrowserWindowReady(rendererId: number, timeoutMs: number = 15_000): Promise<void> {
	if (browserWindowReadyRenderers.has(rendererId)) {
		return Promise.resolve();
	}
	const existing = browserWindowReadyWaiters.get(rendererId);
	if (existing) {
		return new Promise<void>((resolve, reject) => {
			const prevResolve = existing.resolve;
			const prevReject = existing.reject;
			existing.resolve = () => {
				prevResolve();
				resolve();
			};
			existing.reject = (error) => {
				prevReject(error);
				reject(error);
			};
		});
	}
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			browserWindowReadyWaiters.delete(rendererId);
			reject(new Error('Timed out waiting for browser window to become ready.'));
		}, Math.max(1_000, timeoutMs));
		browserWindowReadyWaiters.set(rendererId, { resolve, reject, timer });
	});
}

export function markBrowserWindowReadyForSenderId(senderId: number): void {
	browserWindowReadyRenderers.add(senderId);
	const waiter = browserWindowReadyWaiters.get(senderId);
	if (!waiter) {
		return;
	}
	clearTimeout(waiter.timer);
	browserWindowReadyWaiters.delete(senderId);
	waiter.resolve();
}

export function resolveBrowserHostIdForSenderId(senderId: number): number {
	return browserWindowHostByRenderer.get(senderId) ?? senderId;
}

async function ensureBrowserWindowForHostId(hostId: number): Promise<number | null> {
	const resolvedTargetId = resolveBrowserCommandTargetId(hostId);
	if (resolvedTargetId !== hostId) {
		return resolvedTargetId;
	}
	const pending = browserWindowOpenByHost.get(hostId);
	if (pending) {
		return await pending;
	}
	const openPromise = (async () => {
		try {
			const sourceContents = webContents.fromId(hostId);
			if (!sourceContents || sourceContents.isDestroyed()) {
				return null;
			}
			const initialWorkspace = getWorkspaceRootForWebContents(sourceContents);
			const { createAppWindow } = await import('../appWindow.js');
			const browserWin = createAppWindow({
				blank: true,
				surface: 'agent',
				initialWorkspace,
				queryParams: {
					browserWindow: '1',
				},
			});
			const rendererId = browserWin.webContents.id;
			browserWindowRendererByHost.set(hostId, rendererId);
			browserWindowHostByRenderer.set(rendererId, hostId);
			browserWin.webContents.once('destroyed', () => cleanupBrowserWindowRegistration(rendererId));
			browserWin.once('closed', () => cleanupBrowserWindowRegistration(rendererId));
			try {
				await waitForBrowserWindowReady(rendererId);
				return rendererId;
			} catch {
				cleanupBrowserWindowRegistration(rendererId);
				if (!browserWin.isDestroyed()) {
					browserWin.close();
				}
				return null;
			}
		} catch {
			return null;
		} finally {
			browserWindowOpenByHost.delete(hostId);
		}
	})();
	browserWindowOpenByHost.set(hostId, openPromise);
	return await openPromise;
}

export async function openBrowserWindowForHostId(hostId: number): Promise<boolean> {
	const targetId = await ensureBrowserWindowForHostId(hostId);
	if (targetId == null) {
		return false;
	}
	try {
		const contents = webContents.fromId(targetId);
		if (!contents || contents.isDestroyed()) {
			return false;
		}
		const win = BrowserWindow.fromWebContents(contents);
		if (!win || win.isDestroyed()) {
			return false;
		}
		if (win.isMinimized()) {
			win.restore();
		}
		win.show();
		win.focus();
		return true;
	} catch {
		return false;
	}
}

export function closeBrowserWindowForHostId(hostId: number): boolean {
	const rendererId = browserWindowRendererByHost.get(hostId);
	if (rendererId == null) {
		return false;
	}
	try {
		const contents = webContents.fromId(rendererId);
		if (!contents || contents.isDestroyed()) {
			cleanupBrowserWindowRegistration(rendererId);
			return false;
		}
		const win = BrowserWindow.fromWebContents(contents);
		if (!win || win.isDestroyed()) {
			cleanupBrowserWindowRegistration(rendererId);
			return false;
		}
		win.close();
		return true;
	} catch {
		cleanupBrowserWindowRegistration(rendererId);
		return false;
	}
}

export function browserPartitionForHost(sender: WebContents): string {
	return browserPartitionForHostId(sender.id);
}

export function browserPartitionForHostId(hostId: number): string {
	return `async-agent-browser-host-${hostId}`;
}

export function browserSidebarConfigToPayload(config: BrowserSidebarConfig): BrowserSidebarConfigPayload {
	return {
		userAgent: config.userAgent,
		acceptLanguage: config.acceptLanguage,
		extraHeadersText: config.extraHeadersText,
		blockTrackers: config.blockTrackers,
		proxyMode: config.proxyMode,
		proxyRules: config.proxyRules,
		proxyBypassRules: config.proxyBypassRules,
		fingerprint: { ...config.fingerprint },
	};
}

export function cloneBrowserSidebarConfig(config?: BrowserSidebarConfig | null): BrowserSidebarConfig {
	const src = config ?? DEFAULT_BROWSER_SIDEBAR_CONFIG;
	return {
		userAgent: String(src.userAgent ?? '').trim(),
		acceptLanguage: String(src.acceptLanguage ?? '').trim(),
		extraHeadersText: String(src.extraHeadersText ?? '').replace(/\r/g, ''),
		extraHeaders: Array.isArray(src.extraHeaders)
			? src.extraHeaders.map(([key, value]) => [String(key), String(value)])
			: [],
		blockTrackers: src.blockTrackers !== false,
		proxyMode:
			src.proxyMode === 'direct' || src.proxyMode === 'custom' || src.proxyMode === 'system'
				? src.proxyMode
				: 'system',
		proxyRules: String(src.proxyRules ?? '').trim(),
		proxyBypassRules: String(src.proxyBypassRules ?? '').trim(),
		fingerprint: normalizeBrowserFingerprintSpoof(src.fingerprint),
	};
}

export function getDefaultBrowserSidebarConfig(): BrowserSidebarConfig {
	return cloneBrowserSidebarConfig(DEFAULT_BROWSER_SIDEBAR_CONFIG);
}

export function parseBrowserExtraHeadersText(raw: unknown):
	| { ok: true; extraHeadersText: string; extraHeaders: Array<[string, string]> }
	| { ok: false; line: number } {
	const text = String(raw ?? '').replace(/\r/g, '');
	const lines = text.split('\n');
	const extraHeaders: Array<[string, string]> = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i].trim();
		if (!line) {
			continue;
		}
		const sep = line.indexOf(':');
		if (sep <= 0) {
			return { ok: false, line: i + 1 };
		}
		const name = line.slice(0, sep).trim();
		const value = line.slice(sep + 1).trim();
		if (!name) {
			return { ok: false, line: i + 1 };
		}
		extraHeaders.push([name, value]);
	}
	return { ok: true, extraHeadersText: text, extraHeaders };
}

export function normalizeBrowserSidebarConfig(raw: unknown):
	| { ok: true; config: BrowserSidebarConfig }
	| { ok: false; line: number } {
	const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const parsedHeaders = parseBrowserExtraHeadersText(obj.extraHeadersText);
	if (!parsedHeaders.ok) {
		return { ok: false, line: parsedHeaders.line };
	}
	return {
		ok: true,
		config: {
			userAgent: String(obj.userAgent ?? '').trim(),
			acceptLanguage: String(obj.acceptLanguage ?? '').trim(),
			extraHeadersText: parsedHeaders.extraHeadersText,
			extraHeaders: parsedHeaders.extraHeaders,
			blockTrackers: obj.blockTrackers !== false,
			proxyMode:
				obj.proxyMode === 'direct' || obj.proxyMode === 'custom' || obj.proxyMode === 'system'
					? obj.proxyMode
					: 'system',
			proxyRules: String(obj.proxyRules ?? '').trim(),
			proxyBypassRules: String(obj.proxyBypassRules ?? '').trim(),
			fingerprint: normalizeBrowserFingerprintSpoof(obj.fingerprint),
		},
	};
}

export function shouldBlockBrowserRequest(
	urlRaw: string,
	resourceTypeRaw: string | undefined,
	config: Pick<BrowserSidebarConfig, 'blockTrackers'>
): boolean {
	if (config.blockTrackers === false) {
		return false;
	}
	const resourceType = String(resourceTypeRaw ?? '').trim();
	if (!BROWSER_TRACKER_BLOCKED_RESOURCE_TYPES.has(resourceType)) {
		return false;
	}
	let hostname = '';
	try {
		hostname = new URL(urlRaw).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (!hostname) {
		return false;
	}
	return TRACKER_BLOCKED_DOMAIN_SUFFIXES.some(
		(suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
	);
}

function upsertRequestHeader(headers: Record<string, string>, name: string, value: string): void {
	const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
	if (existing && existing !== name) {
		delete headers[existing];
	}
	headers[existing ?? name] = value;
}

function ensureBrowserSidebarSessionHook(partition: string) {
	const ses = session.fromPartition(partition);
	if (!browserDefaultUserAgentByPartition.has(partition)) {
		browserDefaultUserAgentByPartition.set(partition, ses.getUserAgent());
	}
	if (browserSidebarHookedPartitions.has(partition)) {
		return ses;
	}
	ses.webRequest.onBeforeRequest((details, callback) => {
		const config = browserSidebarConfigsByPartition.get(partition);
		if (config && shouldBlockBrowserRequest(details.url, details.resourceType, config)) {
			callback({ cancel: true });
			return;
		}
		callback({});
	});
	ses.webRequest.onBeforeSendHeaders((details, callback) => {
		const config = browserSidebarConfigsByPartition.get(partition);
		if (!config) {
			callback({ requestHeaders: details.requestHeaders });
			return;
		}
		const requestHeaders = { ...(details.requestHeaders as Record<string, string>) };
		for (const [name, value] of config.extraHeaders) {
			upsertRequestHeader(requestHeaders, name, value);
		}
		if (config.acceptLanguage) {
			upsertRequestHeader(requestHeaders, 'Accept-Language', config.acceptLanguage);
		}
		if (config.userAgent) {
			upsertRequestHeader(requestHeaders, 'User-Agent', config.userAgent);
		}
		callback({ requestHeaders });
	});
	browserSidebarHookedPartitions.add(partition);
	return ses;
}

export async function applyBrowserSidebarConfigToPartition(partition: string, config: BrowserSidebarConfig): Promise<string> {
	const ses = ensureBrowserSidebarSessionHook(partition);
	browserSidebarConfigsByPartition.set(partition, cloneBrowserSidebarConfig(config));
	const defaultUserAgent = browserDefaultUserAgentByPartition.get(partition) ?? ses.getUserAgent();
	ses.setUserAgent(config.userAgent || defaultUserAgent);
	if (config.proxyMode === 'direct') {
		await ses.setProxy({ mode: 'direct' });
	} else if (config.proxyMode === 'custom') {
		await ses.setProxy({
			mode: 'fixed_servers',
			proxyRules: config.proxyRules,
			proxyBypassRules: config.proxyBypassRules || undefined,
		});
	} else {
		await ses.setProxy({ mode: 'system' });
	}
	try {
		await ses.closeAllConnections();
	} catch {
		/* ignore */
	}
	return defaultUserAgent;
}

export function getOrCreateBrowserSidebarConfigForHost(sender: WebContents): BrowserSidebarConfig {
	return getOrCreateBrowserSidebarConfigForHostId(sender.id);
}

export function getOrCreateBrowserSidebarConfigForHostId(hostId: number): BrowserSidebarConfig {
	const existing = browserSidebarConfigsByHost.get(hostId);
	if (existing) {
		return cloneBrowserSidebarConfig(existing);
	}
	const next = cloneBrowserSidebarConfig(DEFAULT_BROWSER_SIDEBAR_CONFIG);
	browserSidebarConfigsByHost.set(hostId, next);
	return cloneBrowserSidebarConfig(next);
}

export async function getBrowserSidebarConfigPayloadForHostId(hostId: number): Promise<{
	partition: string;
	config: BrowserSidebarConfigPayload;
	defaultUserAgent: string;
}> {
	const partition = browserPartitionForHostId(hostId);
	const config = getOrCreateBrowserSidebarConfigForHostId(hostId);
	const defaultUserAgent = await applyBrowserSidebarConfigToPartition(partition, config);
	return {
		partition,
		config: browserSidebarConfigToPayload(config),
		defaultUserAgent,
	};
}

export async function setBrowserSidebarConfigForHostId(hostId: number, rawConfig: unknown):
	Promise<
		| { ok: true; partition: string; config: BrowserSidebarConfigPayload; defaultUserAgent: string }
		| { ok: false; error: 'invalid-header-line'; line: number }
		| { ok: false; error: 'proxy-rules-required' }
	> {
	const normalized = normalizeBrowserSidebarConfig(rawConfig);
	if (!normalized.ok) {
		return { ok: false, error: 'invalid-header-line', line: normalized.line };
	}
	const partition = browserPartitionForHostId(hostId);
	const config = cloneBrowserSidebarConfig(normalized.config);
	if (config.proxyMode === 'custom' && !config.proxyRules) {
		return { ok: false, error: 'proxy-rules-required' };
	}
	browserSidebarConfigsByHost.set(hostId, config);
	const defaultUserAgent = await applyBrowserSidebarConfigToPartition(partition, config);
	return {
		ok: true,
		partition,
		config: browserSidebarConfigToPayload(config),
		defaultUserAgent,
	};
}

function cloneBrowserRuntimeTabState(raw: unknown): BrowserRuntimeTabState | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const tab = raw as Record<string, unknown>;
	const id = String(tab.id ?? '').trim();
	if (!id) {
		return null;
	}
	const loadErrorRaw = tab.loadError;
	let loadError: BrowserRuntimeTabState['loadError'] = null;
	if (loadErrorRaw && typeof loadErrorRaw === 'object') {
		const err = loadErrorRaw as Record<string, unknown>;
		const message = String(err.message ?? '').trim();
		const url = String(err.url ?? '').trim();
		if (message || url) {
			loadError = { message, url };
		}
	}
	return {
		id,
		requestedUrl: String(tab.requestedUrl ?? '').trim(),
		currentUrl: String(tab.currentUrl ?? '').trim(),
		pageTitle: String(tab.pageTitle ?? '').trim(),
		isLoading: Boolean(tab.isLoading),
		canGoBack: Boolean(tab.canGoBack),
		canGoForward: Boolean(tab.canGoForward),
		loadError,
	};
}

function cloneBrowserRuntimeState(raw: unknown): BrowserRuntimeState {
	const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const tabs = Array.isArray(obj.tabs) ? obj.tabs.map(cloneBrowserRuntimeTabState).filter((tab): tab is BrowserRuntimeTabState => Boolean(tab)) : [];
	const activeTabIdRaw = String(obj.activeTabId ?? '').trim();
	const activeTabId = activeTabIdRaw && tabs.some((tab) => tab.id === activeTabIdRaw) ? activeTabIdRaw : tabs[0]?.id ?? null;
	const updatedAtRaw = Number(obj.updatedAt);
	return {
		activeTabId,
		tabs,
		updatedAt: Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : Date.now(),
	};
}

export function updateBrowserRuntimeStateForHostId(hostId: number, rawState: unknown): BrowserRuntimeState {
	const next = cloneBrowserRuntimeState(rawState);
	browserRuntimeStateByHost.set(hostId, next);
	return cloneBrowserRuntimeState(next);
}

export function getBrowserRuntimeStateForHostId(hostId: number): BrowserRuntimeState | null {
	const current = browserRuntimeStateByHost.get(hostId);
	return current ? cloneBrowserRuntimeState(current) : null;
}

export async function dispatchBrowserControlToHostId(hostId: number, command: BrowserControlCommand): Promise<boolean> {
	try {
		const targetId = await ensureBrowserWindowForHostId(hostId);
		if (targetId == null) {
			return false;
		}
		const host = webContents.fromId(targetId);
		if (!host || host.isDestroyed()) {
			return false;
		}
		host.send('async-shell:browserControl', command);
		return true;
	} catch {
		return false;
	}
}

/** 若已存在独立浏览器窗口，则向其推送 `applyConfig`（不会新建窗口）。 */
export function sendApplyConfigToDetachedBrowserWindowIfOpen(
	hostId: number,
	config: BrowserSidebarConfigPayload,
	defaultUserAgent: string
): boolean {
	const mappedRendererId = browserWindowRendererByHost.get(hostId);
	if (mappedRendererId == null) {
		return false;
	}
	try {
		const contents = webContents.fromId(mappedRendererId);
		if (!contents || contents.isDestroyed()) {
			return false;
		}
		const commandId = `cfg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		const command: BrowserControlCommand = {
			commandId,
			type: 'applyConfig',
			config,
			defaultUserAgent,
		};
		contents.send('async-shell:browserControl', command);
		return true;
	} catch {
		return false;
	}
}

export function awaitBrowserCommandResult(
	hostId: number,
	command: BrowserControlCommand,
	timeoutMs: number = 20_000
): Promise<BrowserCommandResult> {
	return new Promise((resolve) => {
		void dispatchBrowserControlToHostId(hostId, command).then((sent) => {
			if (!sent) {
				resolve({
					commandId: command.commandId,
					ok: false,
					error: 'Browser UI is not available in the current window.',
				});
				return;
			}
			const timer = setTimeout(() => {
				browserPendingCommandResults.delete(command.commandId);
				resolve({
					commandId: command.commandId,
					ok: false,
					error: 'Timed out waiting for browser command result.',
				});
			}, Math.max(1_000, timeoutMs));
			browserPendingCommandResults.set(command.commandId, {
				resolve,
				timer,
				hostId,
			});
		}).catch(() => {
			resolve({
				commandId: command.commandId,
				ok: false,
				error: 'Browser UI is not available in the current window.',
			});
		});
	});
}

export function resolveBrowserCommandResultForHostId(hostId: number, payload: unknown): boolean {
	if (!payload || typeof payload !== 'object') {
		return false;
	}
	const obj = payload as Record<string, unknown>;
	const commandId = String(obj.commandId ?? '').trim();
	if (!commandId) {
		return false;
	}
	const pending = browserPendingCommandResults.get(commandId);
	if (!pending || pending.hostId !== hostId) {
		return false;
	}
	browserPendingCommandResults.delete(commandId);
	clearTimeout(pending.timer);
	if (obj.ok === true) {
		pending.resolve({
			commandId,
			ok: true,
			result: obj.result,
		});
		return true;
	}
	pending.resolve({
		commandId,
		ok: false,
		error: String(obj.error ?? 'Browser command failed.'),
	});
	return true;
}
