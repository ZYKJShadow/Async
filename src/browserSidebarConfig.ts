/** 主窗口侧栏/独立窗口内置浏览器与 `browser:setConfig` 共用的配置形态（不含主进程解析后的 `extraHeaders` 数组）。 */
export type BrowserSidebarSettingsConfig = {
	userAgent: string;
	acceptLanguage: string;
	extraHeadersText: string;
	blockTrackers: boolean;
	proxyMode: 'system' | 'direct' | 'custom';
	proxyRules: string;
	proxyBypassRules: string;
};

export const BROWSER_SIDEBAR_CONFIG_SYNC_EVENT = 'async-shell:browser-sidebar-config-sync';

export type BrowserSidebarConfigSyncDetail = {
	config: Partial<BrowserSidebarSettingsConfig>;
	defaultUserAgent?: string;
};

export function browserSidebarConfigSyncDetail(
	event: Event
): BrowserSidebarConfigSyncDetail | null {
	if (!(event instanceof CustomEvent)) {
		return null;
	}
	const d = event.detail;
	if (!d || typeof d !== 'object') {
		return null;
	}
	const o = d as Record<string, unknown>;
	const config = o.config;
	if (!config || typeof config !== 'object') {
		return null;
	}
	return {
		config: config as Partial<BrowserSidebarSettingsConfig>,
		defaultUserAgent: typeof o.defaultUserAgent === 'string' ? o.defaultUserAgent : undefined,
	};
}

export const DEFAULT_BROWSER_SIDEBAR_CONFIG: BrowserSidebarSettingsConfig = {
	userAgent: '',
	acceptLanguage: '',
	extraHeadersText: '',
	blockTrackers: true,
	proxyMode: 'system',
	proxyRules: '',
	proxyBypassRules: '',
};

export function normalizeBrowserSidebarConfig(
	raw?: Partial<BrowserSidebarSettingsConfig> | null
): BrowserSidebarSettingsConfig {
	return {
		userAgent: String(raw?.userAgent ?? '').trim(),
		acceptLanguage: String(raw?.acceptLanguage ?? '').trim(),
		extraHeadersText: String(raw?.extraHeadersText ?? '').replace(/\r/g, ''),
		blockTrackers: raw?.blockTrackers !== false,
		proxyMode:
			raw?.proxyMode === 'direct' || raw?.proxyMode === 'custom' || raw?.proxyMode === 'system'
				? raw.proxyMode
				: 'system',
		proxyRules: String(raw?.proxyRules ?? '').trim(),
		proxyBypassRules: String(raw?.proxyBypassRules ?? '').trim(),
	};
}

export function parseBrowserExtraHeadersText(
	raw: string
): { ok: true; headers: Array<[string, string]> } | { ok: false; line: number } {
	const text = String(raw ?? '').replace(/\r/g, '');
	const lines = text.split('\n');
	const headers: Array<[string, string]> = [];
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
		headers.push([name, value]);
	}
	return { ok: true, headers };
}
