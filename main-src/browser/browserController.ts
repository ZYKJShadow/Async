import { session, webContents, type WebContents } from 'electron';

export type BrowserSidebarConfig = {
	userAgent: string;
	acceptLanguage: string;
	extraHeadersText: string;
	extraHeaders: Array<[string, string]>;
	proxyMode: 'system' | 'direct' | 'custom';
	proxyRules: string;
	proxyBypassRules: string;
};

export type BrowserSidebarConfigPayload = {
	userAgent: string;
	acceptLanguage: string;
	extraHeadersText: string;
	proxyMode: 'system' | 'direct' | 'custom';
	proxyRules: string;
	proxyBypassRules: string;
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
	proxyMode: 'system',
	proxyRules: '',
	proxyBypassRules: '',
};

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
		proxyMode: config.proxyMode,
		proxyRules: config.proxyRules,
		proxyBypassRules: config.proxyBypassRules,
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
		proxyMode:
			src.proxyMode === 'direct' || src.proxyMode === 'custom' || src.proxyMode === 'system'
				? src.proxyMode
				: 'system',
		proxyRules: String(src.proxyRules ?? '').trim(),
		proxyBypassRules: String(src.proxyBypassRules ?? '').trim(),
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
			proxyMode:
				obj.proxyMode === 'direct' || obj.proxyMode === 'custom' || obj.proxyMode === 'system'
					? obj.proxyMode
					: 'system',
			proxyRules: String(obj.proxyRules ?? '').trim(),
			proxyBypassRules: String(obj.proxyBypassRules ?? '').trim(),
		},
	};
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

export function dispatchBrowserControlToHostId(hostId: number, command: BrowserControlCommand): boolean {
	try {
		const host = webContents.fromId(hostId);
		if (!host || host.isDestroyed()) {
			return false;
		}
		host.send('async-shell:browserControl', command);
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
		if (!dispatchBrowserControlToHostId(hostId, command)) {
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
