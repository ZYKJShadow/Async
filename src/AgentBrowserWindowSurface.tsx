import { buildBrowserFingerprintStealthScript } from './browserFingerprintStealth.js';
import { fingerprintSettingsToInjectPatch } from '../main-src/browser/browserFingerprintNormalize.js';
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from 'react';
import {
	IconArrowLeft,
	IconArrowRight,
	IconChevron,
	IconCloseSmall,
	IconCopy,
	IconDownload,
	IconDoc,
	IconGlobe,
	IconListFilter,
	IconPlus,
	IconRefresh,
	IconSearch,
	IconSettings,
	IconStop,
	IconTrash,
	IconArrowUp,
	IconArrowUpRight,
} from './icons';
import type { TFunction } from './i18n';
import { useAppShellChromeCore } from './app/appShellContexts';
import { hideBootSplash } from './bootSplash';
import {
	BROWSER_SIDEBAR_CONFIG_SYNC_EVENT,
	browserSidebarConfigSyncDetail,
	DEFAULT_BROWSER_SIDEBAR_CONFIG,
	normalizeBrowserSidebarConfig,
	type BrowserSidebarSettingsConfig,
} from './browserSidebarConfig';

type AgentRightSidebarView = 'git' | 'plan' | 'file' | 'team' | 'browser' | 'agents';

const BROWSER_HOME_URL = 'https://www.bing.com/';
const BROWSER_CAPTURE_DOCK_EXPANDED_KEY = 'async.browser.captureDock.expanded.v1';
const BROWSER_CAPTURE_DOCK_HEIGHT_KEY = 'async.browser.captureDock.height.v1';
const BROWSER_CAPTURE_DOCK_TAB_KEY = 'async.browser.captureDock.tab.v1';
const BROWSER_CAPTURE_DOCK_DEFAULT_HEIGHT = 320;
const BROWSER_CAPTURE_DOCK_MIN_HEIGHT = 190;
const BROWSER_CAPTURE_DOCK_MAX_HEIGHT = 560;
const BROWSER_CAPTURE_REQUEST_PAGE_SIZE = 80;

type BrowserCapturePanelTab = 'requests' | 'devices';
type BrowserCaptureDetailTab = 'headers' | 'request' | 'response';
type BrowserCaptureStatusFilter = 'all' | 'pending' | '2xx' | '3xx' | '4xx' | '5xx' | 'error';
type BrowserCaptureSourceFilter = 'all' | 'browser' | 'proxy';
type BrowserCaptureMethodFilter = 'all' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'OTHER';
type BrowserCaptureResourceFilter = 'all' | 'document' | 'xhr' | 'fetch' | 'script' | 'stylesheet' | 'image' | 'other';
type BrowserCaptureExportAction = 'curl' | 'json' | 'har' | 'agent';
type BrowserCaptureProxyBusy = 'start' | 'stop' | 'ca' | 'refresh';

function RightSidebarTabs({
	t,
	hasPlan,
	openView,
	closeSidebar,
	extraActions,
}: {
	t: TFunction;
	hasPlan: boolean;
	openView: (view: AgentRightSidebarView) => void;
	closeSidebar: () => void;
	extraActions?: ReactNode;
}) {
	return (
		<div className="ref-right-icon-tabs" aria-label={t('app.rightSidebarViews')}>
			{hasPlan ? (
				<button
					type="button"
					aria-label={t('app.tabPlan')}
					title={t('app.tabPlan')}
					className="ref-right-icon-tab"
					onClick={() => openView('plan')}
				>
					<IconDoc />
				</button>
			) : null}
			{extraActions}
			<button
				type="button"
				aria-label={t('common.close')}
				title={t('common.close')}
				className="ref-right-icon-tab"
				onClick={closeSidebar}
			>
				<IconCloseSmall />
			</button>
		</div>
	);
}

type BrowserNavEvent = Event & { url?: string; isMainFrame?: boolean };
type BrowserTitleEvent = Event & { title?: string };
type BrowserFailEvent = Event & {
	errorCode?: number;
	errorDescription?: string;
	validatedURL?: string;
	isMainFrame?: boolean;
};
type BrowserControlPayload =
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
			config: Partial<BrowserSidebarSettingsConfig>;
			defaultUserAgent?: string;
	  };

type BrowserCommandResultPayload =
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

type BrowserCaptureUiState = {
	capturing: boolean;
	requestCount: number;
	pendingRequestCount: number;
	tabs: Array<{ attached: boolean; lastError: string | null }>;
	note?: string;
};

type BrowserCaptureRequestSummaryUi = {
	id: string;
	seq: number;
	tabId: string;
	source: 'browser' | 'proxy';
	method: string;
	url: string;
	status: number | null;
	contentType: string | null;
	resourceType: string | null;
	startedAt: number;
	durationMs: number | null;
	hasRequestBody: boolean;
	requestBodyTruncated: boolean;
	hasResponseBody: boolean;
	responseBodyTruncated: boolean;
	responseBodyOmittedReason: string | null;
	errorText: string | null;
};

type BrowserCaptureRequestDetailUi = BrowserCaptureRequestSummaryUi & {
	requestHeaders: Record<string, string>;
	requestBody: string | null;
	responseHeaders: Record<string, string>;
	responseBody: string | null;
};

type BrowserCaptureListUi = {
	total: number;
	offset: number;
	limit: number;
	items: BrowserCaptureRequestSummaryUi[];
};

type BrowserCaptureProxyStatusUi = {
	running: boolean;
	port: number;
	ownerHostId: number | null;
	localAddresses: string[];
	primaryAddress: string;
	proxyUrl: string;
	caDownloadUrl: string;
	caCertPath: string;
	caReady: boolean;
	httpsMitm: boolean;
	startedAt: number | null;
	requestCount: number;
	lastError: string | null;
};

function isBrowserControlPayload(raw: unknown): raw is BrowserControlPayload {
	if (!raw || typeof raw !== 'object') {
		return false;
	}
	const obj = raw as Record<string, unknown>;
	if (typeof obj.commandId !== 'string' || typeof obj.type !== 'string') {
		return false;
	}
	switch (obj.type) {
		case 'navigate':
			return typeof obj.target === 'string';
		case 'closeSidebar':
			return true;
		case 'reload':
		case 'stop':
		case 'goBack':
		case 'goForward':
		case 'closeTab':
			return obj.tabId === undefined || typeof obj.tabId === 'string';
		case 'readPage':
			return (
				(obj.tabId === undefined || typeof obj.tabId === 'string') &&
				(obj.selector === undefined || typeof obj.selector === 'string') &&
				(obj.includeHtml === undefined || typeof obj.includeHtml === 'boolean') &&
				(obj.maxChars === undefined || typeof obj.maxChars === 'number') &&
				(obj.waitForLoad === undefined || typeof obj.waitForLoad === 'boolean')
			);
		case 'screenshotPage':
			return (
				(obj.tabId === undefined || typeof obj.tabId === 'string') &&
				(obj.waitForLoad === undefined || typeof obj.waitForLoad === 'boolean')
			);
		case 'clickElement':
			return (
				(obj.tabId === undefined || typeof obj.tabId === 'string') &&
				typeof obj.selector === 'string' &&
				(obj.waitForLoad === undefined || typeof obj.waitForLoad === 'boolean')
			);
		case 'inputText':
			return (
				(obj.tabId === undefined || typeof obj.tabId === 'string') &&
				typeof obj.selector === 'string' &&
				typeof obj.text === 'string' &&
				(obj.pressEnter === undefined || typeof obj.pressEnter === 'boolean') &&
				(obj.waitForLoad === undefined || typeof obj.waitForLoad === 'boolean')
			);
		case 'waitForSelector':
			return (
				(obj.tabId === undefined || typeof obj.tabId === 'string') &&
				typeof obj.selector === 'string' &&
				(obj.visible === undefined || typeof obj.visible === 'boolean') &&
				(obj.waitForLoad === undefined || typeof obj.waitForLoad === 'boolean') &&
				(obj.timeoutMs === undefined || typeof obj.timeoutMs === 'number')
			);
		case 'applyConfig':
			return Boolean(obj.config && typeof obj.config === 'object');
		default:
			return false;
	}
}

function safeGetWebviewUrl(node: AsyncShellWebviewElement | null): string {
	if (!node) {
		return '';
	}
	try {
		return String(node.getURL?.() ?? '').trim();
	} catch {
		return '';
	}
}

function looksLikeLocalFilesystemPath(raw: string): boolean {
	if (/^[a-zA-Z]:[\\/]/.test(raw)) {
		return true;
	}
	if (/^\\\\/.test(raw)) {
		return true;
	}
	if (/^\/[^/]/.test(raw)) {
		return true;
	}
	if (/\\/.test(raw) && !/^[a-zA-Z][a-zA-Z\d+\-.]+:\/\//.test(raw)) {
		return true;
	}
	return false;
}

function looksLikeDirectUrl(raw: string): boolean {
	if (/^[a-zA-Z][a-zA-Z\d+\-.]+:/.test(raw)) {
		return true;
	}
	return /^(localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[\w-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#].*)?$/i.test(raw);
}

function normalizeBrowserTarget(raw: string): string {
	const text = raw.trim();
	if (!text) {
		return BROWSER_HOME_URL;
	}
	if (looksLikeLocalFilesystemPath(text)) {
		return `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
	}
	if (looksLikeDirectUrl(text)) {
		return /^[a-zA-Z][a-zA-Z\d+\-.]+:/.test(text) ? text : `https://${text}`;
	}
	return `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
}

function normalizeBrowserExtractedText(raw: string, maxChars: number): string {
	const compact = String(raw ?? '')
		.replace(/\r/g, '')
		.replace(/\u00a0/g, ' ')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
	return compact.length > maxChars ? `${compact.slice(0, maxChars)}\n\n... (truncated)` : compact;
}

function normalizeBrowserCaptureUiState(raw: unknown): BrowserCaptureUiState {
	const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const tabs = Array.isArray(obj.tabs)
		? obj.tabs
				.map((tab) => {
					if (!tab || typeof tab !== 'object') {
						return null;
					}
					const t = tab as Record<string, unknown>;
					return {
						attached: t.attached === true,
						lastError: typeof t.lastError === 'string' && t.lastError ? t.lastError : null,
					};
				})
				.filter((tab): tab is { attached: boolean; lastError: string | null } => Boolean(tab))
		: [];
	return {
		capturing: obj.capturing === true,
		requestCount: Math.max(0, Math.floor(Number(obj.requestCount) || 0)),
		pendingRequestCount: Math.max(0, Math.floor(Number(obj.pendingRequestCount) || 0)),
		tabs,
		note: typeof obj.note === 'string' ? obj.note : undefined,
	};
}

function normalizeHeaderRecord(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== 'object') {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		out[key] = typeof value === 'string' ? value : String(value ?? '');
	}
	return out;
}

function normalizeBrowserCaptureRequestSummary(raw: unknown): BrowserCaptureRequestSummaryUi | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const obj = raw as Record<string, unknown>;
	const id = typeof obj.id === 'string' ? obj.id : '';
	if (!id) {
		return null;
	}
	const statusRaw = Number(obj.status);
	const durationRaw = Number(obj.durationMs);
	return {
		id,
		seq: Math.max(0, Math.floor(Number(obj.seq) || 0)),
		tabId: typeof obj.tabId === 'string' ? obj.tabId : '',
		source: obj.source === 'proxy' ? 'proxy' : 'browser',
		method: (typeof obj.method === 'string' && obj.method.trim() ? obj.method : 'GET').toUpperCase(),
		url: typeof obj.url === 'string' ? obj.url : '',
		status: Number.isFinite(statusRaw) ? statusRaw : null,
		contentType: typeof obj.contentType === 'string' && obj.contentType ? obj.contentType : null,
		resourceType: typeof obj.resourceType === 'string' && obj.resourceType ? obj.resourceType : null,
		startedAt: Math.max(0, Math.floor(Number(obj.startedAt) || 0)),
		durationMs: Number.isFinite(durationRaw) ? durationRaw : null,
		hasRequestBody: obj.hasRequestBody === true,
		requestBodyTruncated: obj.requestBodyTruncated === true,
		hasResponseBody: obj.hasResponseBody === true,
		responseBodyTruncated: obj.responseBodyTruncated === true,
		responseBodyOmittedReason:
			typeof obj.responseBodyOmittedReason === 'string' && obj.responseBodyOmittedReason
				? obj.responseBodyOmittedReason
				: null,
		errorText: typeof obj.errorText === 'string' && obj.errorText ? obj.errorText : null,
	};
}

function normalizeBrowserCaptureProxyStatus(raw: unknown): BrowserCaptureProxyStatusUi {
	const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const localAddresses = Array.isArray(obj.localAddresses)
		? obj.localAddresses.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
		: [];
	const portRaw = Number(obj.port);
	const startedAtRaw = Number(obj.startedAt);
	const requestCountRaw = Number(obj.requestCount);
	return {
		running: obj.running === true,
		port: Number.isFinite(portRaw) && portRaw > 0 ? Math.floor(portRaw) : 8888,
		ownerHostId: typeof obj.ownerHostId === 'number' && Number.isFinite(obj.ownerHostId) ? Math.floor(obj.ownerHostId) : null,
		localAddresses,
		primaryAddress:
			typeof obj.primaryAddress === 'string' && obj.primaryAddress.trim()
				? obj.primaryAddress.trim()
				: localAddresses[0] ?? '127.0.0.1',
		proxyUrl: typeof obj.proxyUrl === 'string' ? obj.proxyUrl : '',
		caDownloadUrl: typeof obj.caDownloadUrl === 'string' ? obj.caDownloadUrl : '',
		caCertPath: typeof obj.caCertPath === 'string' ? obj.caCertPath : '',
		caReady: obj.caReady === true,
		httpsMitm: obj.httpsMitm !== false,
		startedAt: Number.isFinite(startedAtRaw) && startedAtRaw > 0 ? Math.floor(startedAtRaw) : null,
		requestCount: Number.isFinite(requestCountRaw) && requestCountRaw > 0 ? Math.floor(requestCountRaw) : 0,
		lastError: typeof obj.lastError === 'string' && obj.lastError ? obj.lastError : null,
	};
}

function normalizeBrowserCaptureList(raw: unknown): BrowserCaptureListUi {
	const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const items = Array.isArray(obj.items)
		? obj.items
				.map(normalizeBrowserCaptureRequestSummary)
				.filter((item): item is BrowserCaptureRequestSummaryUi => Boolean(item))
		: [];
	return {
		total: Math.max(0, Math.floor(Number(obj.total) || items.length)),
		offset: Math.max(0, Math.floor(Number(obj.offset) || 0)),
		limit: Math.max(0, Math.floor(Number(obj.limit) || items.length)),
		items,
	};
}

function normalizeBrowserCaptureRequestDetail(raw: unknown): BrowserCaptureRequestDetailUi | null {
	const summary = normalizeBrowserCaptureRequestSummary(raw);
	if (!summary || !raw || typeof raw !== 'object') {
		return null;
	}
	const obj = raw as Record<string, unknown>;
	return {
		...summary,
		requestHeaders: normalizeHeaderRecord(obj.requestHeaders),
		requestBody: typeof obj.requestBody === 'string' ? obj.requestBody : null,
		responseHeaders: normalizeHeaderRecord(obj.responseHeaders),
		responseBody: typeof obj.responseBody === 'string' ? obj.responseBody : null,
	};
}

function normalizeBrowserCaptureRequestDetails(raw: unknown): BrowserCaptureRequestDetailUi[] {
	return Array.isArray(raw)
		? raw
				.map(normalizeBrowserCaptureRequestDetail)
				.filter((item): item is BrowserCaptureRequestDetailUi => Boolean(item))
		: [];
}

function mergeBrowserCaptureRequestSummaries(
	current: BrowserCaptureRequestSummaryUi[],
	next: BrowserCaptureRequestSummaryUi[]
): BrowserCaptureRequestSummaryUi[] {
	const byId = new Map<string, BrowserCaptureRequestSummaryUi>();
	for (const request of current) {
		byId.set(request.id, request);
	}
	for (const request of next) {
		byId.set(request.id, request);
	}
	return Array.from(byId.values()).sort((a, b) => a.seq - b.seq);
}

function browserCaptureUrlHost(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return '';
	}
}

function browserCaptureUrlPath(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return url;
	}
}

function browserCaptureFormatDuration(ms: number | null): string {
	if (ms == null) {
		return '--';
	}
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function browserCaptureFormatBody(raw: string | null): string {
	if (!raw) {
		return '';
	}
	const text = raw.trim();
	if (!text) {
		return '';
	}
	if (text.startsWith('{') || text.startsWith('[')) {
		try {
			return JSON.stringify(JSON.parse(text), null, 2);
		} catch {
			return raw;
		}
	}
	return raw;
}

function browserCaptureFormatHeaders(headers: Record<string, string>): string {
	return Object.entries(headers)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}: ${value}`)
		.join('\n');
}

function browserCaptureHeaderValue(headers: Record<string, string>, name: string): string {
	const lowerName = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lowerName) {
			return value;
		}
	}
	return '';
}

function browserCaptureHarHeaders(headers: Record<string, string>): Array<{ name: string; value: string }> {
	return Object.entries(headers)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, value]) => ({ name, value }));
}

function browserCaptureHarQueryString(rawUrl: string): Array<{ name: string; value: string }> {
	try {
		const parsed = new URL(rawUrl);
		return Array.from(parsed.searchParams.entries()).map(([name, value]) => ({ name, value }));
	} catch {
		return [];
	}
}

function browserCaptureQuoteCurlArg(value: string): string {
	return `'${String(value ?? '').replace(/'/g, "'\\''")}'`;
}

function browserCaptureBuildCurl(request: BrowserCaptureRequestDetailUi): string {
	const method = request.method.toUpperCase();
	const lines = [`curl ${browserCaptureQuoteCurlArg(request.url)}`];
	if (method && method !== 'GET') {
		lines.push(`  -X ${method}`);
	}
	for (const [key, value] of Object.entries(request.requestHeaders).sort(([left], [right]) => left.localeCompare(right))) {
		if (key.toLowerCase() === 'content-length') {
			continue;
		}
		lines.push(`  -H ${browserCaptureQuoteCurlArg(`${key}: ${value}`)}`);
	}
	if (request.requestBody) {
		lines.push(`  --data-raw ${browserCaptureQuoteCurlArg(request.requestBody)}`);
	}
	return lines.join(' \\\n');
}

const BROWSER_CAPTURE_AGENT_REQUEST_LIMIT = 16;
const BROWSER_CAPTURE_AGENT_BODY_LIMIT = 1200;

function browserCaptureTrimForAgent(text: string, maxChars: number = BROWSER_CAPTURE_AGENT_BODY_LIMIT): string {
	const value = String(text ?? '').trim();
	if (!value) {
		return '';
	}
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, maxChars).trimEnd()}\n[truncated ${value.length - maxChars} chars]`;
}

function browserCaptureBuildAgentDraft(
	requests: BrowserCaptureRequestDetailUi[],
	scopeLabel: string,
	t: TFunction
): string {
	const visibleRequests = requests.slice(0, BROWSER_CAPTURE_AGENT_REQUEST_LIMIT);
	const lines = [
		t('app.browserCaptureAgentDraftIntro'),
		'',
		t('app.browserCaptureAgentDraftScope', { scope: scopeLabel }),
		t('app.browserCaptureAgentDraftTotal', { count: String(requests.length) }),
		'',
	];
	visibleRequests.forEach((request, index) => {
		const status = request.status == null ? (request.errorText ? 'ERR' : 'pending') : String(request.status);
		const contentType = request.contentType ?? browserCaptureHeaderValue(request.responseHeaders, 'content-type');
		const requestBody = browserCaptureTrimForAgent(browserCaptureFormatBody(request.requestBody), 900);
		const responseBody = browserCaptureTrimForAgent(browserCaptureFormatBody(request.responseBody));
		lines.push(
			`${index + 1}. #${request.seq} ${request.method.toUpperCase()} ${status} ${browserCaptureFormatDuration(
				request.durationMs
			)}`
		);
		lines.push(`   URL: ${request.url}`);
		lines.push(
			`   Source: ${request.source === 'proxy' ? 'external-device proxy' : 'built-in browser'}; Type: ${
				request.resourceType ?? '--'
			}${contentType ? `; ${contentType}` : ''}`
		);
		if (request.errorText) {
			lines.push(`   Error: ${request.errorText}`);
		}
		if (requestBody) {
			lines.push(`   Request body:\n${requestBody}`);
		}
		if (responseBody) {
			lines.push(`   Response body:\n${responseBody}`);
		} else if (request.responseBodyOmittedReason) {
			lines.push(`   Response body: ${request.responseBodyOmittedReason}`);
		}
		lines.push('');
	});
	if (requests.length > visibleRequests.length) {
		lines.push(
			t('app.browserCaptureAgentDraftOmitted', {
				count: String(requests.length - visibleRequests.length),
			})
		);
	}
	return lines.join('\n').trim();
}

function browserCaptureBuildJsonExport(
	requests: BrowserCaptureRequestDetailUi[],
	scope: Record<string, unknown>
): string {
	return JSON.stringify(
		{
			version: 1,
			source: 'Async browser capture',
			exportedAt: new Date().toISOString(),
			requestCount: requests.length,
			scope,
			requests,
		},
		null,
		2
	);
}

function browserCaptureBuildHarExport(requests: BrowserCaptureRequestDetailUi[]): string {
	return JSON.stringify(
		{
			log: {
				version: '1.2',
				creator: {
					name: 'Async browser capture',
					version: '1.0',
				},
				pages: [],
				entries: requests.map((request) => {
					const requestBody = request.requestBody ?? '';
					const responseBody = request.responseBody ?? '';
					const contentType = request.contentType ?? browserCaptureHeaderValue(request.responseHeaders, 'content-type');
					const requestContentType = browserCaptureHeaderValue(request.requestHeaders, 'content-type');
					const durationMs = request.durationMs ?? 0;
					return {
						startedDateTime: new Date(request.startedAt || Date.now()).toISOString(),
						time: durationMs,
						request: {
							method: request.method,
							url: request.url,
							httpVersion: 'HTTP/1.1',
							cookies: [],
							headers: browserCaptureHarHeaders(request.requestHeaders),
							queryString: browserCaptureHarQueryString(request.url),
							headersSize: -1,
							bodySize: requestBody.length,
							...(requestBody
								? {
										postData: {
											mimeType: requestContentType,
											text: requestBody,
										},
									}
								: {}),
						},
						response: {
							status: request.status ?? 0,
							statusText: request.errorText ?? '',
							httpVersion: 'HTTP/1.1',
							cookies: [],
							headers: browserCaptureHarHeaders(request.responseHeaders),
							content: {
								size: responseBody.length,
								mimeType: contentType,
								...(responseBody ? { text: responseBody } : {}),
							},
							redirectURL: browserCaptureHeaderValue(request.responseHeaders, 'location'),
							headersSize: -1,
							bodySize: responseBody.length,
						},
						cache: {},
						timings: {
							blocked: -1,
							dns: -1,
							connect: -1,
							send: 0,
							wait: durationMs,
							receive: 0,
							ssl: -1,
						},
						...(request.errorText ? { comment: request.errorText } : {}),
					};
				}),
			},
		},
		null,
		2
	);
}

function browserCaptureDownloadTextFile(fileName: string, mimeType: string, text: string): void {
	const blob = new Blob([text], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = fileName;
	link.rel = 'noopener';
	document.body.appendChild(link);
	link.click();
	link.remove();
	window.setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 1000);
}

function browserCaptureExportFileName(format: 'json' | 'har'): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	return `async-browser-capture-${stamp}.${format}`;
}

function clampBrowserCaptureDockHeight(value: number, maxHeight: number = BROWSER_CAPTURE_DOCK_MAX_HEIGHT): number {
	const numeric = Number.isFinite(value) ? value : BROWSER_CAPTURE_DOCK_DEFAULT_HEIGHT;
	return Math.min(Math.max(Math.round(numeric), BROWSER_CAPTURE_DOCK_MIN_HEIGHT), maxHeight);
}

async function notifyBrowserCommandResult(
	shell: NonNullable<Window['asyncShell']> | undefined,
	payload: BrowserCommandResultPayload
): Promise<void> {
	if (!shell) {
		return;
	}
	try {
		await shell.invoke('browser:commandResult', payload);
	} catch {
		/* ignore */
	}
}

type BrowserTab = {
	id: string;
	requestedUrl: string;
	currentUrl: string;
	draftUrl: string;
	pageTitle: string;
	isLoading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	loadError: { message: string; url: string } | null;
};

let browserTabSeq = 0;
function createBrowserTab(url: string = BROWSER_HOME_URL): BrowserTab {
	browserTabSeq += 1;
	return {
		id: `browser-tab-${Date.now().toString(36)}-${browserTabSeq}`,
		requestedUrl: url,
		currentUrl: url,
		draftUrl: url,
		pageTitle: '',
		isLoading: true,
		canGoBack: false,
		canGoForward: false,
		loadError: null,
	};
}

const BrowserTabView = memo(
	function BrowserTabView({
		tab,
		partition,
		userAgent,
		fingerprintScript,
		active,
		t,
		onNavigate,
		onTitle,
		onLoading,
		onFailLoad,
		onRegisterWebview,
	}: {
		tab: BrowserTab;
		partition: string;
		userAgent?: string;
		fingerprintScript: string | null;
		active: boolean;
		t: TFunction;
		onNavigate: (id: string, patch: { currentUrl: string; canGoBack: boolean; canGoForward: boolean }) => void;
		onTitle: (id: string, title: string) => void;
		onLoading: (id: string, isLoading: boolean, currentUrl?: string) => void;
		onFailLoad: (id: string, error: { message: string; url: string }) => void;
		onRegisterWebview: (id: string, node: AsyncShellWebviewElement | null) => void;
	}) {
	const webviewRef = useRef<AsyncShellWebviewElement | null>(null);
	const fingerprintScriptRef = useRef<string | null>(null);
	fingerprintScriptRef.current = fingerprintScript;
	const tabIdRef = useRef(tab.id);
	const [webviewSize, setWebviewSize] = useState<{ width: number; height: number } | null>(null);
	tabIdRef.current = tab.id;

	const syncWebviewSize = useCallback(() => {
		const node = webviewRef.current;
		const host = node?.parentElement;
		if (!node || !(host instanceof HTMLElement)) {
			return;
		}
		const nextWidth = Math.max(1, Math.round(host.clientWidth));
		const nextHeight = Math.max(1, Math.round(host.clientHeight));
		setWebviewSize((prev) => {
			if (prev && prev.width === nextWidth && prev.height === nextHeight) {
				return prev;
			}
			return { width: nextWidth, height: nextHeight };
		});
	}, []);

	const assignWebviewRef = useCallback(
		(node: AsyncShellWebviewElement | null) => {
			webviewRef.current = node;
			try {
				onRegisterWebview(tabIdRef.current, node);
			} catch (err) {
				console.error('[BrowserTab] error in onRegisterWebview:', err);
			}
		},
		[onRegisterWebview]
	);

	useEffect(() => {
		const node = webviewRef.current;
		if (!node) {
			return;
		}

		const readNavState = () => {
			try {
				return {
					canGoBack: Boolean(node.canGoBack?.()),
					canGoForward: Boolean(node.canGoForward?.()),
				};
			} catch {
				return { canGoBack: false, canGoForward: false };
			}
		};

		const handleStartLoading = () => {
			onLoading(tabIdRef.current, true);
		};
		const handleStopLoading = () => {
			onLoading(tabIdRef.current, false, safeGetWebviewUrl(node));
		};
		const handleNavigate = (event: Event) => {
			const navEvent = event as BrowserNavEvent;
			if (navEvent.isMainFrame === false) {
				return;
			}
			const url = String(navEvent.url ?? safeGetWebviewUrl(node) ?? '').trim();
			const { canGoBack, canGoForward } = readNavState();
			onNavigate(tabIdRef.current, { currentUrl: url, canGoBack, canGoForward });
		};
		const handleTitleUpdated = (event: Event) => {
			onTitle(tabIdRef.current, String((event as BrowserTitleEvent).title ?? '').trim());
		};
		const handleDomReady = () => {
			const { canGoBack, canGoForward } = readNavState();
			onNavigate(tabIdRef.current, {
				currentUrl: safeGetWebviewUrl(node),
				canGoBack,
				canGoForward,
			});
			const fpScript = fingerprintScriptRef.current;
			if (fpScript) {
				void node.executeJavaScript(fpScript, false).catch(() => {
					/* ignore */
				});
			}
		};
		const handleFailLoad = (event: Event) => {
			const failEvent = event as BrowserFailEvent;
			if (failEvent.isMainFrame === false || failEvent.errorCode === -3) {
				return;
			}
			const failedUrl = String(failEvent.validatedURL ?? safeGetWebviewUrl(node) ?? '').trim();
			onFailLoad(tabIdRef.current, {
				message: String(failEvent.errorDescription ?? t('app.browserLoadFailed')),
				url: failedUrl,
			});
		};

		node.addEventListener('dom-ready', handleDomReady);
		node.addEventListener('did-start-loading', handleStartLoading);
		node.addEventListener('did-stop-loading', handleStopLoading);
		node.addEventListener('did-navigate', handleNavigate);
		node.addEventListener('did-navigate-in-page', handleNavigate);
		node.addEventListener('page-title-updated', handleTitleUpdated);
		node.addEventListener('did-fail-load', handleFailLoad);

		return () => {
			node.removeEventListener('dom-ready', handleDomReady);
			node.removeEventListener('did-start-loading', handleStartLoading);
			node.removeEventListener('did-stop-loading', handleStopLoading);
			node.removeEventListener('did-navigate', handleNavigate);
			node.removeEventListener('did-navigate-in-page', handleNavigate);
			node.removeEventListener('page-title-updated', handleTitleUpdated);
			node.removeEventListener('did-fail-load', handleFailLoad);
		};
	}, [partition, onLoading, onNavigate, onTitle, onFailLoad]);

	useEffect(() => {
		const node = webviewRef.current;
		const host = node?.parentElement;
		if (!node || !(host instanceof HTMLElement)) {
			return;
		}
		syncWebviewSize();
		let frameId = window.requestAnimationFrame(() => {
			syncWebviewSize();
		});
		const observer =
			typeof ResizeObserver === 'undefined'
				? null
				: new ResizeObserver(() => {
						syncWebviewSize();
					});
		observer?.observe(host);
		const onWindowResize = () => {
			syncWebviewSize();
		};
		window.addEventListener('resize', onWindowResize);
		return () => {
			window.cancelAnimationFrame(frameId);
			observer?.disconnect();
			window.removeEventListener('resize', onWindowResize);
		};
	}, [active, syncWebviewSize, tab.id]);

	const webviewProps = {
		ref: assignWebviewRef,
		className: `ref-browser-webview${active ? '' : ' is-hidden'}`,
		src: tab.requestedUrl,
		partition: partition,
		useragent: userAgent,
		style: webviewSize
			? { width: `${webviewSize.width}px`, height: `${webviewSize.height}px` }
			: { width: '100%', height: '100%' },
		onLoad: () => console.log('[BrowserTab] webview onLoad event fired'),
		allowpopups: 'true' as any,  // Electron webview expects string, not boolean
	};
	return <webview {...webviewProps} />;
},
(prevProps, nextProps) => {
	// 自定义比较：忽略 t 的变化，只比较关键属性，防止频繁卸载
	const comparisons = {
		tabIdSame: prevProps.tab.id === nextProps.tab.id,
		requestedUrlSame: prevProps.tab.requestedUrl === nextProps.tab.requestedUrl,
		currentUrlSame: prevProps.tab.currentUrl === nextProps.tab.currentUrl,
		isLoadingSame: prevProps.tab.isLoading === nextProps.tab.isLoading,
		canGoBackSame: prevProps.tab.canGoBack === nextProps.tab.canGoBack,
		canGoForwardSame: prevProps.tab.canGoForward === nextProps.tab.canGoForward,
		partitionSame: prevProps.partition === nextProps.partition,
		userAgentSame: prevProps.userAgent === nextProps.userAgent,
		fingerprintScriptSame: prevProps.fingerprintScript === nextProps.fingerprintScript,
		activeSame: prevProps.active === nextProps.active,
	};

	const same = Object.values(comparisons).every(Boolean);

	return same;
}
);

const AgentRightSidebarBrowserPanel = memo(function AgentRightSidebarBrowserPanel({
	hasAgentPlanSidebarContent,
	closeSidebar,
	openView,
	onOpenBrowserSettings,
	pendingCommand,
	onCommandHandled,
	variant = 'sidebar',
}: {
	hasAgentPlanSidebarContent: boolean;
	closeSidebar: () => void;
	openView: (view: AgentRightSidebarView) => void;
	onOpenBrowserSettings: () => void;
	pendingCommand: BrowserControlPayload | null;
	onCommandHandled: (commandId: string) => void;
	variant?: 'sidebar' | 'window';
}) {
	const { t, shell } = useAppShellChromeCore();
	const webviewsRef = useRef<Map<string, AsyncShellWebviewElement>>(new Map());
	const addressInputRef = useRef<HTMLInputElement | null>(null);
	const defaultUserAgentRef = useRef('');

	const initialTab = useMemo(() => createBrowserTab(), []);
	const [tabs, setTabs] = useState<BrowserTab[]>([initialTab]);
	const [activeTabId, setActiveTabId] = useState<string>(initialTab.id);
	const tabsRef = useRef(tabs);
	tabsRef.current = tabs;
	const activeTabIdRef = useRef(activeTabId);
	activeTabIdRef.current = activeTabId;

	const [browserPartition, setBrowserPartition] = useState('');
	const [browserConfigReady, setBrowserConfigReady] = useState(false);
	const [browserConfig, setBrowserConfig] = useState<BrowserSidebarSettingsConfig>(DEFAULT_BROWSER_SIDEBAR_CONFIG);
	const [captureState, setCaptureState] = useState<BrowserCaptureUiState | null>(null);
	const [captureBusy, setCaptureBusy] = useState<'start' | 'stop' | 'clear' | null>(null);
	const [captureError, setCaptureError] = useState<string | null>(null);
	const [capturePanelExpanded, setCapturePanelExpanded] = useState(() => {
		try {
			const stored = window.localStorage.getItem(BROWSER_CAPTURE_DOCK_EXPANDED_KEY);
			return stored == null ? false : stored !== '0';
		} catch {
			return false;
		}
	});
	const [captureDockHeight, setCaptureDockHeight] = useState(() => {
		try {
			return clampBrowserCaptureDockHeight(Number(window.localStorage.getItem(BROWSER_CAPTURE_DOCK_HEIGHT_KEY)));
		} catch {
			return BROWSER_CAPTURE_DOCK_DEFAULT_HEIGHT;
		}
	});
	const [capturePanelTab, setCapturePanelTab] = useState<BrowserCapturePanelTab>(() => {
		try {
			const stored = window.localStorage.getItem(BROWSER_CAPTURE_DOCK_TAB_KEY);
			return stored === 'devices' ? 'devices' : 'requests';
		} catch {
			return 'requests';
		}
	});
	const [captureQuery, setCaptureQuery] = useState('');
	const [captureStatusFilter, setCaptureStatusFilter] = useState<BrowserCaptureStatusFilter>('all');
	const [captureSourceFilter, setCaptureSourceFilter] = useState<BrowserCaptureSourceFilter>('all');
	const [captureMethodFilter, setCaptureMethodFilter] = useState<BrowserCaptureMethodFilter>('all');
	const [captureResourceFilter, setCaptureResourceFilter] = useState<BrowserCaptureResourceFilter>('all');
	const [captureRequests, setCaptureRequests] = useState<BrowserCaptureRequestSummaryUi[]>([]);
	const [captureRequestTotal, setCaptureRequestTotal] = useState(0);
	const [captureListBusy, setCaptureListBusy] = useState(false);
	const [captureListError, setCaptureListError] = useState<string | null>(null);
	const captureRequestsRef = useRef<BrowserCaptureRequestSummaryUi[]>([]);
	const captureListRequestSeqRef = useRef(0);
	const [selectedCaptureRequestIds, setSelectedCaptureRequestIds] = useState<Set<string>>(() => new Set());
	const [selectedCaptureRequestId, setSelectedCaptureRequestId] = useState<string | null>(null);
	const [selectedCaptureRequest, setSelectedCaptureRequest] = useState<BrowserCaptureRequestDetailUi | null>(null);
	const [selectedCaptureBusy, setSelectedCaptureBusy] = useState(false);
	const [captureDetailTab, setCaptureDetailTab] = useState<BrowserCaptureDetailTab>('headers');
	const [captureExportBusy, setCaptureExportBusy] = useState<BrowserCaptureExportAction | null>(null);
	const [captureExportError, setCaptureExportError] = useState<string | null>(null);
	const [copiedCaptureField, setCopiedCaptureField] = useState<string | null>(null);
	const copiedCaptureFieldTimerRef = useRef<number | null>(null);
	const captureSelectAllRef = useRef<HTMLInputElement | null>(null);
	const [captureProxyStatus, setCaptureProxyStatus] = useState<BrowserCaptureProxyStatusUi | null>(null);
	const [captureProxyBusy, setCaptureProxyBusy] = useState<BrowserCaptureProxyBusy | null>(null);
	const [captureProxyError, setCaptureProxyError] = useState<string | null>(null);
	const [clearDataConfirmOpen, setClearDataConfirmOpen] = useState(false);
	const [clearDataBusy, setClearDataBusy] = useState(false);
	const [clearDataError, setClearDataError] = useState<string | null>(null);
	const captureIsActive = captureState?.capturing === true;

	const applyBrowserConfigLocally = useCallback((rawConfig: Partial<BrowserSidebarSettingsConfig>, defaultUserAgent?: string) => {
		let nextConfig = DEFAULT_BROWSER_SIDEBAR_CONFIG;
		setBrowserConfig((prev) => {
			nextConfig = normalizeBrowserSidebarConfig(rawConfig, prev);
			return nextConfig;
		});
		if (typeof defaultUserAgent === 'string') {
			defaultUserAgentRef.current = defaultUserAgent.trim();
		}
		const nextUserAgent = nextConfig.userAgent.trim() || defaultUserAgentRef.current;
		webviewsRef.current.forEach((node) => {
			if (nextUserAgent) {
				try {
					node.setUserAgent(nextUserAgent);
				} catch {
					/* ignore */
				}
			}
			try {
				node.reload();
			} catch {
				/* ignore */
			}
		});
		setTabs((prev) => prev.map((tab) => ({ ...tab, loadError: null })));
	}, []);

	const refreshBrowserCaptureState = useCallback(async () => {
		if (!shell) {
			return;
		}
		try {
			const payload = (await shell.invoke('browserCapture:getState')) as { ok?: boolean; state?: unknown };
			if (payload?.ok) {
				setCaptureState(normalizeBrowserCaptureUiState(payload.state));
				setCaptureError(null);
			}
		} catch (error) {
			setCaptureError(error instanceof Error ? error.message : String(error));
		}
	}, [shell]);

	const runBrowserCaptureAction = useCallback(
		async (action: 'start' | 'stop' | 'clear') => {
			if (!shell || captureBusy) {
				return;
			}
			setCaptureBusy(action);
			setCaptureError(null);
			try {
				const channel =
					action === 'start'
						? 'browserCapture:start'
						: action === 'stop'
							? 'browserCapture:stop'
							: 'browserCapture:clear';
				const payload = (await shell.invoke(channel, action === 'start' ? { clear: true } : undefined)) as {
					ok?: boolean;
					state?: unknown;
					error?: unknown;
				};
				if (!payload?.ok) {
					throw new Error(String(payload?.error ?? t('app.browserCaptureFailed')));
				}
				setCaptureState(normalizeBrowserCaptureUiState(payload.state));
				if (action === 'start') {
					setCapturePanelExpanded(true);
				}
				if (action === 'clear' || action === 'start') {
					captureListRequestSeqRef.current += 1;
					captureRequestsRef.current = [];
					setCaptureRequests([]);
					setCaptureRequestTotal(0);
					setCaptureListBusy(false);
					setSelectedCaptureRequestIds(new Set());
					setSelectedCaptureRequestId(null);
					setSelectedCaptureRequest(null);
					setCaptureExportError(null);
				}
			} catch (error) {
				setCaptureError(error instanceof Error ? error.message : String(error));
			} finally {
				setCaptureBusy(null);
			}
		},
		[captureBusy, shell, t]
	);

	const refreshBrowserCaptureProxyStatus = useCallback(async () => {
		if (!shell) {
			return;
		}
		try {
			const payload = (await shell.invoke('browserCapture:proxyStatus')) as {
				ok?: boolean;
				status?: unknown;
				error?: unknown;
			};
			if (!payload?.ok) {
				throw new Error(String(payload?.error ?? t('app.browserCaptureProxyFailed')));
			}
			setCaptureProxyStatus(normalizeBrowserCaptureProxyStatus(payload.status));
			setCaptureProxyError(null);
		} catch (error) {
			setCaptureProxyError(error instanceof Error ? error.message : String(error));
		}
	}, [shell, t]);

	const runBrowserCaptureProxyAction = useCallback(
		async (action: 'start' | 'stop') => {
			if (!shell || captureProxyBusy || captureBusy) {
				return;
			}
			setCaptureProxyBusy(action);
			setCaptureProxyError(null);
			try {
				if (action === 'start' && !captureIsActive) {
					const capturePayload = (await shell.invoke('browserCapture:start', { clear: false })) as {
						ok?: boolean;
						state?: unknown;
						error?: unknown;
					};
					if (!capturePayload?.ok) {
						throw new Error(String(capturePayload?.error ?? t('app.browserCaptureFailed')));
					}
					setCaptureState(normalizeBrowserCaptureUiState(capturePayload.state));
				}
				const payload = (await shell.invoke(
					action === 'start' ? 'browserCapture:proxyStart' : 'browserCapture:proxyStop',
					action === 'start' ? { port: captureProxyStatus?.port ?? 8888 } : undefined
				)) as { ok?: boolean; status?: unknown; error?: unknown };
				if (!payload?.ok) {
					throw new Error(String(payload?.error ?? t('app.browserCaptureProxyFailed')));
				}
				setCaptureProxyStatus(normalizeBrowserCaptureProxyStatus(payload.status));
				setCapturePanelExpanded(true);
				setCapturePanelTab('devices');
				await refreshBrowserCaptureState();
			} catch (error) {
				setCaptureProxyError(error instanceof Error ? error.message : String(error));
			} finally {
				setCaptureProxyBusy(null);
			}
		},
		[captureBusy, captureIsActive, captureProxyBusy, captureProxyStatus?.port, refreshBrowserCaptureState, shell, t]
	);

	const exportBrowserCaptureProxyCa = useCallback(async () => {
		if (!shell || captureProxyBusy) {
			return;
		}
		setCaptureProxyBusy('ca');
		setCaptureProxyError(null);
		try {
			const payload = (await shell.invoke('browserCapture:proxyExportCa')) as {
				ok?: boolean;
				ca?: unknown;
				error?: unknown;
			};
			if (!payload?.ok || !payload.ca || typeof payload.ca !== 'object') {
				throw new Error(String(payload?.error ?? t('app.browserCaptureProxyCaFailed')));
			}
			const ca = payload.ca as Record<string, unknown>;
			const pem = typeof ca.pem === 'string' ? ca.pem : '';
			if (!pem) {
				throw new Error(t('app.browserCaptureProxyCaFailed'));
			}
			browserCaptureDownloadTextFile(
				typeof ca.fileName === 'string' && ca.fileName ? ca.fileName : 'async-capture-ca.pem',
				typeof ca.mimeType === 'string' && ca.mimeType ? ca.mimeType : 'application/x-pem-file',
				pem
			);
			setCopiedCaptureField('ca');
			if (copiedCaptureFieldTimerRef.current != null) {
				window.clearTimeout(copiedCaptureFieldTimerRef.current);
			}
			copiedCaptureFieldTimerRef.current = window.setTimeout(() => {
				setCopiedCaptureField(null);
				copiedCaptureFieldTimerRef.current = null;
			}, 1400);
			await refreshBrowserCaptureProxyStatus();
		} catch (error) {
			setCaptureProxyError(error instanceof Error ? error.message : String(error));
		} finally {
			setCaptureProxyBusy(null);
		}
	}, [captureProxyBusy, refreshBrowserCaptureProxyStatus, shell, t]);

	const refreshBrowserCaptureRequests = useCallback(async (mode: 'replace' | 'append' = 'replace') => {
		if (!shell) {
			return;
		}
		const append = mode === 'append';
		const requestSeq = ++captureListRequestSeqRef.current;
		const offset = append ? captureRequestsRef.current.length : 0;
		setCaptureListBusy(true);
		setCaptureListError(null);
		try {
			const payload = (await shell.invoke('browserCapture:listRequests', {
				query: captureQuery,
				statusGroup: captureStatusFilter === 'all' ? undefined : captureStatusFilter,
				source: captureSourceFilter === 'all' ? undefined : captureSourceFilter,
				method: captureMethodFilter === 'all' ? undefined : captureMethodFilter,
				resourceType: captureResourceFilter === 'all' ? undefined : captureResourceFilter,
				offset,
				limit: BROWSER_CAPTURE_REQUEST_PAGE_SIZE,
			})) as { ok?: boolean; result?: unknown; error?: unknown };
			if (!payload?.ok) {
				throw new Error(String(payload?.error ?? t('app.browserCaptureListFailed')));
			}
			const list = normalizeBrowserCaptureList(payload.result);
			if (requestSeq !== captureListRequestSeqRef.current) {
				return;
			}
			const nextItems = append ? mergeBrowserCaptureRequestSummaries(captureRequestsRef.current, list.items) : list.items;
			captureRequestsRef.current = nextItems;
			setCaptureRequests(nextItems);
			setCaptureRequestTotal(list.total);
			setSelectedCaptureRequestIds((prev) => {
				if (prev.size <= 0) {
					return prev;
				}
				const visibleIds = new Set(nextItems.map((item) => item.id));
				const next = new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
				return next.size === prev.size ? prev : next;
			});
			setSelectedCaptureRequestId((prev) => {
				if (prev && nextItems.some((item) => item.id === prev)) {
					return prev;
				}
				return nextItems[0]?.id ?? null;
			});
		} catch (error) {
			if (requestSeq === captureListRequestSeqRef.current) {
				setCaptureListError(error instanceof Error ? error.message : String(error));
			}
		} finally {
			if (requestSeq === captureListRequestSeqRef.current) {
				setCaptureListBusy(false);
			}
		}
	}, [captureMethodFilter, captureQuery, captureResourceFilter, captureSourceFilter, captureStatusFilter, shell, t]);

	const loadBrowserCaptureRequest = useCallback(
		async (requestId: string) => {
			if (!shell || !requestId) {
				setSelectedCaptureRequest(null);
				return;
			}
			setSelectedCaptureBusy(true);
			try {
				const payload = (await shell.invoke('browserCapture:getRequest', { requestId })) as {
					ok?: boolean;
					request?: unknown;
					error?: unknown;
				};
				if (!payload?.ok) {
					throw new Error(String(payload?.error ?? t('app.browserCaptureRequestNotFound')));
				}
				setSelectedCaptureRequest(normalizeBrowserCaptureRequestDetail(payload.request));
			} catch {
				setSelectedCaptureRequest(null);
			} finally {
				setSelectedCaptureBusy(false);
			}
		},
		[shell, t]
	);

	const clearBrowserData = useCallback(async () => {
		if (!shell || clearDataBusy) {
			return;
		}
		setClearDataBusy(true);
		setClearDataError(null);
		try {
			const payload = (await shell.invoke('browser:clearData')) as { ok?: boolean; error?: unknown };
			if (!payload?.ok) {
				throw new Error(String(payload?.error ?? t('app.browserClearDataFailed')));
			}
			setClearDataConfirmOpen(false);
			setTabs((prev) =>
				prev.map((tab) => ({
					...tab,
					isLoading: true,
					loadError: null,
				}))
			);
			webviewsRef.current.forEach((node) => {
				try {
					node.reload();
				} catch {
					/* ignore */
				}
			});
		} catch (error) {
			setClearDataError(error instanceof Error ? error.message : String(error));
		} finally {
			setClearDataBusy(false);
		}
	}, [clearDataBusy, shell, t]);

	const waitForWebviewNode = useCallback((tabId: string, timeoutMs: number = 10_000): Promise<AsyncShellWebviewElement> => {
		const startedAt = Date.now();
		return new Promise((resolve, reject) => {
			const tick = () => {
				const node = webviewsRef.current.get(tabId);
				if (node) {
					resolve(node);
					return;
				}
				if (Date.now() - startedAt >= timeoutMs) {
					reject(new Error('Timed out waiting for browser tab to become ready.'));
					return;
				}
				window.setTimeout(tick, 50);
			};
			tick();
		});
	}, []);

	const waitForWebviewSettled = useCallback(
		(node: AsyncShellWebviewElement, tabId: string, timeoutMs: number = 15_000): Promise<void> => {
			const currentTab = tabsRef.current.find((tab) => tab.id === tabId);
			if (!currentTab?.isLoading) {
				return Promise.resolve();
			}
			return new Promise((resolve, reject) => {
				const cleanup = () => {
					window.clearTimeout(timer);
					node.removeEventListener('did-stop-loading', handleStopLoading);
					node.removeEventListener('did-fail-load', handleFailLoad);
				};
				const handleStopLoading = () => {
					cleanup();
					resolve();
				};
				const handleFailLoad = (event: Event) => {
					const failEvent = event as BrowserFailEvent;
					if (failEvent.isMainFrame === false || failEvent.errorCode === -3) {
						return;
					}
					cleanup();
					reject(new Error(String(failEvent.errorDescription ?? t('app.browserLoadFailed'))));
				};
				const timer = window.setTimeout(() => {
					cleanup();
					reject(new Error('Timed out waiting for page load to finish.'));
				}, timeoutMs);
				node.addEventListener('did-stop-loading', handleStopLoading);
				node.addEventListener('did-fail-load', handleFailLoad);
			});
		},
		[t]
	);

	const readPageFromWebview = useCallback(
		async (
			node: AsyncShellWebviewElement,
			options: { selector?: string; includeHtml?: boolean; maxChars?: number }
		): Promise<Record<string, unknown>> => {
			const maxChars = Math.min(Math.max(500, Math.floor(options.maxChars ?? 12_000)), 50_000);
			const script = `
				(() => {
					const args = ${JSON.stringify({
						selector: options.selector ?? '',
						includeHtml: options.includeHtml === true,
						maxChars,
					})};
					const root = args.selector ? document.querySelector(args.selector) : (document.body || document.documentElement);
					if (!root) {
						return {
							ok: false,
							error: args.selector ? 'Selector did not match any element.' : 'Page body is unavailable.',
						};
					}
					const rawText = String(root.innerText || root.textContent || '');
					const htmlText = args.includeHtml
						? String(root.outerHTML || root.innerHTML || '').slice(0, Math.min(args.maxChars, 30000))
						: '';
					const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
						.map((el) => String(el.textContent || '').trim())
						.filter(Boolean)
						.slice(0, 20);
					const links = Array.from(root.querySelectorAll('a[href]'))
						.map((el) => ({
							text: String(el.textContent || '').trim(),
							href: String(el.getAttribute('href') || '').trim(),
						}))
						.filter((item) => item.href)
						.slice(0, 20);
					const metaDescription = document.querySelector('meta[name=\"description\"]')?.getAttribute('content') || '';
					return {
						ok: true,
						url: location.href,
						title: document.title || '',
						lang: document.documentElement?.lang || '',
						selector: args.selector || null,
						metaDescription: metaDescription || '',
						text: rawText,
						totalTextLength: rawText.length,
						headings,
						links,
						html: htmlText || undefined,
					};
				})()
			`;
			const result = await node.executeJavaScript<Record<string, unknown>>(script, true);
			if (result?.ok === false) {
				throw new Error(String(result.error ?? 'Failed to read page content.'));
			}
			const text = normalizeBrowserExtractedText(String(result?.text ?? ''), maxChars);
			return {
				url: String(result?.url ?? safeGetWebviewUrl(node)),
				title: String(result?.title ?? ''),
				lang: String(result?.lang ?? ''),
				selector: result?.selector ?? null,
				metaDescription: String(result?.metaDescription ?? ''),
				totalTextLength: Number(result?.totalTextLength ?? text.length) || text.length,
				text,
				headings: Array.isArray(result?.headings) ? result.headings : [],
				links: Array.isArray(result?.links) ? result.links : [],
				...(options.includeHtml ? { html: String(result?.html ?? '') } : {}),
			};
		},
		[]
	);

	const clickElementInWebview = useCallback(
		async (
			node: AsyncShellWebviewElement,
			options: { selector: string }
		): Promise<Record<string, unknown>> => {
			const script = `
				(() => {
					const args = ${JSON.stringify({ selector: options.selector })};
					const target = document.querySelector(args.selector);
					if (!target) {
						return {
							ok: false,
							error: 'Selector did not match any element.',
						};
					}
					if (!(target instanceof HTMLElement)) {
						return {
							ok: false,
							error: 'Matched node is not an HTMLElement.',
						};
					}
					target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
					target.focus?.();
					const rect = target.getBoundingClientRect();
					const beforeUrl = location.href;
					const beforeTitle = document.title || '';
					if (typeof target.click === 'function') {
						target.click();
					} else {
						target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
					}
					return {
						ok: true,
						selector: args.selector,
						tagName: target.tagName.toLowerCase(),
						text: String(target.innerText || target.textContent || '').trim().slice(0, 500),
						href: target instanceof HTMLAnchorElement ? target.href : '',
						x: Math.round(rect.left + rect.width / 2),
						y: Math.round(rect.top + rect.height / 2),
						urlBefore: beforeUrl,
						titleBefore: beforeTitle,
						urlAfter: location.href,
						titleAfter: document.title || '',
					};
				})()
			`;
			const result = await node.executeJavaScript<Record<string, unknown>>(script, true);
			if (result?.ok === false) {
				throw new Error(String(result.error ?? 'Failed to click element.'));
			}
			return {
				url: String(result?.urlAfter ?? safeGetWebviewUrl(node)),
				title: String(result?.titleAfter ?? ''),
				selector: String(result?.selector ?? options.selector),
				tagName: String(result?.tagName ?? ''),
				text: String(result?.text ?? ''),
				href: String(result?.href ?? ''),
				clickPoint: {
					x: Number(result?.x ?? 0) || 0,
					y: Number(result?.y ?? 0) || 0,
				},
				urlBefore: String(result?.urlBefore ?? ''),
				urlAfter: String(result?.urlAfter ?? safeGetWebviewUrl(node)),
			};
		},
		[]
	);

	const inputTextInWebview = useCallback(
		async (
			node: AsyncShellWebviewElement,
			options: { selector: string; text: string; pressEnter?: boolean }
		): Promise<Record<string, unknown>> => {
			const script = `
				(() => {
					const args = ${JSON.stringify({
						selector: options.selector,
						text: options.text,
						pressEnter: options.pressEnter === true,
					})};
					const target = document.querySelector(args.selector);
					if (!target) {
						return {
							ok: false,
							error: 'Selector did not match any element.',
						};
					}
					if (!(target instanceof HTMLElement)) {
						return {
							ok: false,
							error: 'Matched node is not an HTMLElement.',
						};
					}
					const dispatchInput = (el) => {
						el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
						el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
					};
					const setNativeValue = (el, value) => {
						const proto =
							el instanceof HTMLTextAreaElement
								? HTMLTextAreaElement.prototype
								: el instanceof HTMLInputElement
									? HTMLInputElement.prototype
									: el instanceof HTMLSelectElement
										? HTMLSelectElement.prototype
										: null;
						const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
						if (descriptor?.set) {
							descriptor.set.call(el, value);
						} else {
							el.value = value;
						}
					};
					target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
					target.focus?.();
					let mode = 'unknown';
					if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
						setNativeValue(target, args.text);
						dispatchInput(target);
						mode = target instanceof HTMLTextAreaElement ? 'textarea' : target instanceof HTMLSelectElement ? 'select' : 'input';
					} else if (target.isContentEditable) {
						target.textContent = args.text;
						dispatchInput(target);
						mode = 'contenteditable';
					} else if ('value' in target) {
						try {
							target.value = args.text;
							dispatchInput(target);
							mode = 'value-property';
						} catch {
							target.textContent = args.text;
							dispatchInput(target);
							mode = 'textContent';
						}
					} else {
						target.textContent = args.text;
						dispatchInput(target);
						mode = 'textContent';
					}
					if (args.pressEnter) {
						const keyboardInit = {
							key: 'Enter',
							code: 'Enter',
							keyCode: 13,
							which: 13,
							bubbles: true,
							cancelable: true,
						};
						target.dispatchEvent(new KeyboardEvent('keydown', keyboardInit));
						target.dispatchEvent(new KeyboardEvent('keypress', keyboardInit));
						target.dispatchEvent(new KeyboardEvent('keyup', keyboardInit));
						const form = target.closest('form');
						if (form instanceof HTMLFormElement) {
							if (typeof form.requestSubmit === 'function') {
								form.requestSubmit();
							} else {
								form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
							}
						}
					}
					const value =
						target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
							? target.value
							: target.isContentEditable
								? String(target.textContent || '')
								: 'value' in target
									? String(target.value ?? '')
									: String(target.textContent || '');
					return {
						ok: true,
						selector: args.selector,
						mode,
						tagName: target.tagName.toLowerCase(),
						value,
						pressEnter: args.pressEnter,
						url: location.href,
						title: document.title || '',
					};
				})()
			`;
			const result = await node.executeJavaScript<Record<string, unknown>>(script, true);
			if (result?.ok === false) {
				throw new Error(String(result.error ?? 'Failed to input text.'));
			}
			return {
				url: String(result?.url ?? safeGetWebviewUrl(node)),
				title: String(result?.title ?? ''),
				selector: String(result?.selector ?? options.selector),
				mode: String(result?.mode ?? ''),
				tagName: String(result?.tagName ?? ''),
				value: String(result?.value ?? options.text),
				pressEnter: result?.pressEnter === true,
			};
		},
		[]
	);

	const waitForSelectorInWebview = useCallback(
		async (
			node: AsyncShellWebviewElement,
			options: { selector: string; visible?: boolean; timeoutMs?: number }
		): Promise<Record<string, unknown>> => {
			const timeoutMs = Math.min(Math.max(500, Math.floor(options.timeoutMs ?? 20_000)), 60_000);
			const script = `
				(() => {
					const args = ${JSON.stringify({
						selector: options.selector,
						visible: options.visible === true,
						timeoutMs,
					})};
					const root = document.documentElement || document.body;
					if (!root) {
						return Promise.resolve({
							ok: false,
							error: 'Document root is unavailable.',
						});
					}
					const isVisible = (el) => {
						if (!(el instanceof HTMLElement)) {
							return false;
						}
						const style = window.getComputedStyle(el);
						if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
							return false;
						}
						const rect = el.getBoundingClientRect();
						return rect.width > 0 && rect.height > 0;
					};
					const snapshot = (el) => {
						const rect = el instanceof HTMLElement ? el.getBoundingClientRect() : { width: 0, height: 0 };
						return {
							ok: true,
							selector: args.selector,
							tagName: el instanceof Element ? el.tagName.toLowerCase() : '',
							text: el instanceof Element ? String(el.innerText || el.textContent || '').trim().slice(0, 500) : '',
							visible: isVisible(el),
							url: location.href,
							title: document.title || '',
							width: Math.round(rect.width || 0),
							height: Math.round(rect.height || 0),
						};
					};
					const findMatch = () => {
						const el = document.querySelector(args.selector);
						if (!el) {
							return null;
						}
						if (args.visible && !isVisible(el)) {
							return null;
						}
						return el;
					};
					const immediate = findMatch();
					if (immediate) {
						return Promise.resolve(snapshot(immediate));
					}
					return new Promise((resolve) => {
						const observer = new MutationObserver(() => {
							const match = findMatch();
							if (!match) {
								return;
							}
							cleanup();
							resolve(snapshot(match));
						});
						const cleanup = () => {
							window.clearTimeout(timer);
							observer.disconnect();
						};
						const timer = window.setTimeout(() => {
							cleanup();
							resolve({
								ok: false,
								error: args.visible
									? 'Timed out waiting for a visible element matching the selector.'
									: 'Timed out waiting for an element matching the selector.',
							});
						}, args.timeoutMs);
						observer.observe(root, {
							childList: true,
							subtree: true,
							attributes: true,
							attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
						});
					});
				})()
			`;
			const result = await node.executeJavaScript<Record<string, unknown>>(script, true);
			if (result?.ok === false) {
				throw new Error(String(result.error ?? 'Failed while waiting for selector.'));
			}
			return {
				url: String(result?.url ?? safeGetWebviewUrl(node)),
				title: String(result?.title ?? ''),
				selector: String(result?.selector ?? options.selector),
				tagName: String(result?.tagName ?? ''),
				text: String(result?.text ?? ''),
				visible: result?.visible === true,
				size: {
					width: Number(result?.width ?? 0) || 0,
					height: Number(result?.height ?? 0) || 0,
				},
				timeoutMs,
			};
		},
		[]
	);

	const captureWebviewScreenshot = useCallback(async (node: AsyncShellWebviewElement): Promise<Record<string, unknown>> => {
		const image = await node.capturePage();
		const size = image.getSize();
		return {
			url: safeGetWebviewUrl(node),
			title: tabsRef.current.find((tab) => webviewsRef.current.get(tab.id) === node)?.pageTitle ?? '',
			width: size.width,
			height: size.height,
			dataUrl: image.toDataURL(),
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		if (!shell) {
			setBrowserPartition('async-agent-browser-fallback');
			setBrowserConfigReady(true);
			return () => {
				cancelled = true;
			};
		}
		void shell
			.invoke('browser:getConfig')
			.then((payload) => {
				if (cancelled) {
					return;
				}
				const response = payload as {
					ok?: boolean;
					partition?: string;
					config?: Partial<BrowserSidebarSettingsConfig>;
					defaultUserAgent?: string;
				};
				if (response.ok && response.partition) {
					const nextConfig = normalizeBrowserSidebarConfig(response.config);
					setBrowserPartition(response.partition);
					setBrowserConfig(nextConfig);
					defaultUserAgentRef.current = String(response.defaultUserAgent ?? '').trim();
				} else {
					setBrowserPartition('async-agent-browser-fallback');
				}
				setBrowserConfigReady(true);
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setBrowserPartition('async-agent-browser-fallback');
				setBrowserConfigReady(true);
			});
		return () => {
			cancelled = true;
		};
	}, [shell]);

	useEffect(() => {
		void refreshBrowserCaptureState();
		const timer = window.setInterval(
			() => {
				void refreshBrowserCaptureState();
			},
			captureState?.capturing ? 1_200 : 4_000
		);
		return () => {
			window.clearInterval(timer);
		};
	}, [captureState?.capturing, refreshBrowserCaptureState]);

	useEffect(() => {
		void refreshBrowserCaptureProxyStatus();
		const timer = window.setInterval(
			() => {
				void refreshBrowserCaptureProxyStatus();
			},
			captureProxyStatus?.running ? 2_500 : 6_000
		);
		return () => {
			window.clearInterval(timer);
		};
	}, [captureProxyStatus?.running, refreshBrowserCaptureProxyStatus]);

	useEffect(() => {
		try {
			window.localStorage.setItem(BROWSER_CAPTURE_DOCK_EXPANDED_KEY, capturePanelExpanded ? '1' : '0');
		} catch {
			/* ignore */
		}
	}, [capturePanelExpanded]);

	useEffect(() => {
		try {
			window.localStorage.setItem(BROWSER_CAPTURE_DOCK_HEIGHT_KEY, String(captureDockHeight));
		} catch {
			/* ignore */
		}
	}, [captureDockHeight]);

	useEffect(() => {
		try {
			window.localStorage.setItem(BROWSER_CAPTURE_DOCK_TAB_KEY, capturePanelTab);
		} catch {
			/* ignore */
		}
	}, [capturePanelTab]);

	useEffect(() => {
		return () => {
			if (copiedCaptureFieldTimerRef.current != null) {
				window.clearTimeout(copiedCaptureFieldTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!capturePanelExpanded || capturePanelTab !== 'requests') {
			return;
		}
		const timer = window.setTimeout(
			() => {
				void refreshBrowserCaptureRequests();
			},
			captureQuery.trim() ? 180 : 0
		);
		return () => {
			window.clearTimeout(timer);
		};
	}, [
		capturePanelExpanded,
		capturePanelTab,
		captureQuery,
		captureState?.pendingRequestCount,
		captureState?.requestCount,
		refreshBrowserCaptureRequests,
	]);

	useEffect(() => {
		if (!selectedCaptureRequestId) {
			setSelectedCaptureRequest(null);
			return;
		}
		void loadBrowserCaptureRequest(selectedCaptureRequestId);
	}, [loadBrowserCaptureRequest, selectedCaptureRequestId]);

	const copyCaptureText = useCallback(
		async (field: string, text: string) => {
			const value = String(text ?? '').trim();
			if (!value) {
				return;
			}
			let copied = false;
			try {
				const payload = (await shell?.invoke('clipboard:writeText', value)) as { ok?: boolean } | undefined;
				copied = payload?.ok === true;
			} catch {
				/* fall back to browser clipboard */
			}
			if (!copied) {
				try {
					await navigator.clipboard.writeText(value);
					copied = true;
				} catch {
					/* clipboard can be unavailable in restricted webview contexts */
				}
			}
			if (!copied) {
				return;
			}
			setCopiedCaptureField(field);
			if (copiedCaptureFieldTimerRef.current != null) {
				window.clearTimeout(copiedCaptureFieldTimerRef.current);
			}
			copiedCaptureFieldTimerRef.current = window.setTimeout(() => {
				setCopiedCaptureField(null);
				copiedCaptureFieldTimerRef.current = null;
			}, 1200);
		},
		[shell]
	);

	const loadBrowserCaptureExportRequests = useCallback(async (): Promise<{
		requests: BrowserCaptureRequestDetailUi[];
		scope: Record<string, unknown>;
	}> => {
		if (!shell) {
			return { requests: [], scope: {} };
		}
		const requestIds = Array.from(selectedCaptureRequestIds);
		const scope =
			requestIds.length > 0
				? { requestIds }
				: {
						query: captureQuery.trim(),
						statusGroup: captureStatusFilter === 'all' ? undefined : captureStatusFilter,
						source: captureSourceFilter === 'all' ? undefined : captureSourceFilter,
						method: captureMethodFilter === 'all' ? undefined : captureMethodFilter,
						resourceType: captureResourceFilter === 'all' ? undefined : captureResourceFilter,
					};
		const payload = (await shell.invoke('browserCapture:exportRequests', {
			...scope,
			offset: 0,
			limit: 500,
		})) as { ok?: boolean; requests?: unknown; error?: unknown };
		if (!payload?.ok) {
			throw new Error(String(payload?.error ?? t('app.browserCaptureExportFailed')));
		}
		return {
			requests: normalizeBrowserCaptureRequestDetails(payload.requests),
			scope,
		};
	}, [
		captureMethodFilter,
		captureQuery,
		captureResourceFilter,
		captureSourceFilter,
		captureStatusFilter,
		selectedCaptureRequestIds,
		shell,
		t,
	]);

	const copyBrowserCaptureCurl = useCallback(async () => {
		if (captureExportBusy) {
			return;
		}
		setCaptureExportBusy('curl');
		setCaptureExportError(null);
		try {
			const { requests } = await loadBrowserCaptureExportRequests();
			if (requests.length <= 0) {
				throw new Error(t('app.browserCaptureNoExportableRequests'));
			}
			await copyCaptureText('curl', requests.map(browserCaptureBuildCurl).join('\n\n'));
		} catch (error) {
			setCaptureExportError(error instanceof Error ? error.message : String(error));
		} finally {
			setCaptureExportBusy(null);
		}
	}, [captureExportBusy, copyCaptureText, loadBrowserCaptureExportRequests, t]);

	const exportBrowserCaptureRequests = useCallback(
		async (format: 'json' | 'har') => {
			if (captureExportBusy) {
				return;
			}
			setCaptureExportBusy(format);
			setCaptureExportError(null);
			try {
				const { requests, scope } = await loadBrowserCaptureExportRequests();
				if (requests.length <= 0) {
					throw new Error(t('app.browserCaptureNoExportableRequests'));
				}
				const text =
					format === 'har'
						? browserCaptureBuildHarExport(requests)
						: browserCaptureBuildJsonExport(requests, scope);
				browserCaptureDownloadTextFile(
					browserCaptureExportFileName(format),
					format === 'har' ? 'application/har+json' : 'application/json',
					text
				);
			} catch (error) {
				setCaptureExportError(error instanceof Error ? error.message : String(error));
			} finally {
				setCaptureExportBusy(null);
			}
		},
		[captureExportBusy, loadBrowserCaptureExportRequests, t]
	);

	const sendBrowserCaptureToAgentDraft = useCallback(async () => {
		if (captureExportBusy || !shell) {
			return;
		}
		setCaptureExportBusy('agent');
		setCaptureExportError(null);
		try {
			const { requests } = await loadBrowserCaptureExportRequests();
			if (requests.length <= 0) {
				throw new Error(t('app.browserCaptureNoExportableRequests'));
			}
			const scopeLabel =
				selectedCaptureRequestIds.size > 0
					? t('app.browserCaptureSelectedCount', { count: String(selectedCaptureRequestIds.size) })
					: t('app.browserCaptureFilteredCount', { count: String(captureRequestTotal) });
			const text = browserCaptureBuildAgentDraft(requests, scopeLabel, t);
			const payload = (await shell.invoke('composer:appendDraft', { text })) as { ok?: boolean; error?: unknown };
			if (!payload?.ok) {
				throw new Error(String(payload?.error ?? t('app.browserCaptureSendFailed')));
			}
			setCopiedCaptureField('agent');
			if (copiedCaptureFieldTimerRef.current != null) {
				window.clearTimeout(copiedCaptureFieldTimerRef.current);
			}
			copiedCaptureFieldTimerRef.current = window.setTimeout(() => {
				setCopiedCaptureField(null);
				copiedCaptureFieldTimerRef.current = null;
			}, 1200);
		} catch (error) {
			setCaptureExportError(error instanceof Error ? error.message : String(error));
		} finally {
			setCaptureExportBusy(null);
		}
	}, [captureExportBusy, captureRequestTotal, loadBrowserCaptureExportRequests, selectedCaptureRequestIds, shell, t]);

	const toggleCaptureRequestSelected = useCallback((requestId: string, selected: boolean) => {
		setSelectedCaptureRequestIds((prev) => {
			const next = new Set(prev);
			if (selected) {
				next.add(requestId);
			} else {
				next.delete(requestId);
			}
			return next;
		});
	}, []);

	const toggleVisibleCaptureRequestsSelected = useCallback(() => {
		setSelectedCaptureRequestIds((prev) => {
			const visibleIds = captureRequests.map((request) => request.id);
			if (visibleIds.length <= 0) {
				return prev;
			}
			const allVisibleSelected = visibleIds.every((id) => prev.has(id));
			const next = new Set(prev);
			for (const id of visibleIds) {
				if (allVisibleSelected) {
					next.delete(id);
				} else {
					next.add(id);
				}
			}
			return next;
		});
	}, [captureRequests]);

	const handleCaptureDockResizePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			setCapturePanelExpanded(true);
			const startY = event.clientY;
			const startHeight = captureDockHeight;
			const panel = event.currentTarget.closest('.ref-browser-panel');
			const panelHeight = panel instanceof HTMLElement ? panel.clientHeight : window.innerHeight;
			const maxHeight = Math.min(
				BROWSER_CAPTURE_DOCK_MAX_HEIGHT,
				Math.max(BROWSER_CAPTURE_DOCK_MIN_HEIGHT, Math.round(panelHeight * 0.62))
			);
			const handlePointerMove = (moveEvent: PointerEvent) => {
				const delta = startY - moveEvent.clientY;
				setCaptureDockHeight(clampBrowserCaptureDockHeight(startHeight + delta, maxHeight));
			};
			const handlePointerUp = () => {
				window.removeEventListener('pointermove', handlePointerMove);
				window.removeEventListener('pointerup', handlePointerUp);
				document.body.classList.remove('is-resizing-browser-capture-dock');
			};
			document.body.classList.add('is-resizing-browser-capture-dock');
			window.addEventListener('pointermove', handlePointerMove);
			window.addEventListener('pointerup', handlePointerUp);
		},
		[captureDockHeight]
	);

	const handleRegisterWebview = useCallback((id: string, node: AsyncShellWebviewElement | null) => {
		if (node) {
			webviewsRef.current.set(id, node);
			if (!defaultUserAgentRef.current) {
				try {
					defaultUserAgentRef.current = String(node.getUserAgent?.() ?? '').trim();
				} catch {
					/* ignore */
				}
			}
		} else {
			webviewsRef.current.delete(id);
		}
	}, []);

	const handleTabNavigate = useCallback(
		(id: string, patch: { currentUrl: string; canGoBack: boolean; canGoForward: boolean }) => {
			const addressFocused =
				typeof document !== 'undefined' && document.activeElement === addressInputRef.current;
			const keepDraft = id === activeTabIdRef.current && addressFocused;
			setTabs((prev) =>
				prev.map((tab) => {
					if (tab.id !== id) {
						return tab;
					}
					const resolvedUrl = patch.currentUrl || tab.currentUrl;
					return {
						...tab,
						currentUrl: resolvedUrl,
						draftUrl: keepDraft ? tab.draftUrl : resolvedUrl,
						canGoBack: patch.canGoBack,
						canGoForward: patch.canGoForward,
						loadError: null,
					};
				})
			);
		},
		[]
	);

	const handleTabTitle = useCallback((id: string, title: string) => {
		setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, pageTitle: title } : tab)));
	}, []);

	const handleTabLoading = useCallback((id: string, isLoading: boolean, currentUrl?: string) => {
		setTabs((prev) =>
			prev.map((tab) => {
				if (tab.id !== id) {
					return tab;
				}
				const next: BrowserTab = { ...tab, isLoading };
				if (isLoading) {
					next.loadError = null;
				} else if (currentUrl && currentUrl !== tab.currentUrl) {
					const addressFocused =
						typeof document !== 'undefined' && document.activeElement === addressInputRef.current;
					const keepDraft = id === activeTabIdRef.current && addressFocused;
					next.currentUrl = currentUrl;
					if (!keepDraft) {
						next.draftUrl = currentUrl;
					}
				}
				return next;
			})
		);
	}, []);

	const handleTabFailLoad = useCallback((id: string, error: { message: string; url: string }) => {
		setTabs((prev) =>
			prev.map((tab) => {
				if (tab.id !== id) {
					return tab;
				}
				return {
					...tab,
					isLoading: false,
					currentUrl: error.url || tab.currentUrl,
					loadError: error,
				};
			})
		);
	}, []);

	const openInNewTab = useCallback((url: string) => {
		const trimmed = String(url ?? '').trim();
		if (!trimmed) {
			return;
		}
		const tab = createBrowserTab(trimmed);
		setTabs((prev) => [...prev, tab]);
		setActiveTabId(tab.id);
	}, []);

	const navigateTab = useCallback((tabId: string, rawTarget: string) => {
		const nextUrl = normalizeBrowserTarget(rawTarget);
		const prevTab = tabsRef.current.find((tab) => tab.id === tabId) ?? null;
		const sameAsRequested = prevTab?.requestedUrl === nextUrl;
		setActiveTabId(tabId);
		setTabs((prev) =>
			prev.map((tab) => {
				if (tab.id !== tabId) {
					return tab;
				}
				return {
					...tab,
					requestedUrl: nextUrl,
					currentUrl: nextUrl,
					draftUrl: nextUrl,
					pageTitle: '',
					isLoading: true,
					canGoBack: false,
					canGoForward: false,
					loadError: null,
				};
			})
		);
		if (sameAsRequested) {
			webviewsRef.current.get(tabId)?.reload();
		}
	}, []);

	// Subscribe to main-process forwarded new-window events for webview contents.
	// Electron 12+ deprecated the 'new-window' event; the host (this webContents)
	// receives 'async-shell:browserNewWindow' from web-contents-created hook in main.
	useEffect(() => {
		const subscribe = shell?.subscribeBrowserNewWindow;
		if (!subscribe) {
			return;
		}
		const unsubscribe = subscribe((payload) => {
			openInNewTab(String(payload?.url ?? ''));
		});
		return () => {
			unsubscribe?.();
		};
	}, [shell, openInNewTab]);

	const addNewTab = useCallback(() => {
		const tab = createBrowserTab();
		setTabs((prev) => [...prev, tab]);
		setActiveTabId(tab.id);
		window.setTimeout(() => {
			addressInputRef.current?.focus();
			addressInputRef.current?.select();
		}, 50);
	}, []);

	const closeTab = useCallback((id: string) => {
		const prev = tabsRef.current;
		const closedIndex = prev.findIndex((tab) => tab.id === id);
		if (closedIndex < 0) {
			return;
		}
		webviewsRef.current.delete(id);
		if (prev.length <= 1) {
			const fresh = createBrowserTab();
			setTabs([fresh]);
			setActiveTabId(fresh.id);
			window.setTimeout(() => {
				addressInputRef.current?.focus();
				addressInputRef.current?.select();
			}, 50);
			return;
		}
		const nextTabs = prev.filter((tab) => tab.id !== id);
		setTabs(nextTabs);
		if (activeTabIdRef.current === id) {
			const nextActive = nextTabs[Math.min(closedIndex, nextTabs.length - 1)];
			setActiveTabId(nextActive.id);
		}
	}, []);

	const activateTab = useCallback((id: string) => {
		setActiveTabId(id);
	}, []);

	const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
	const activeWebview = () => (activeTab ? webviewsRef.current.get(activeTab.id) ?? null : null);

	const onAddressChange = useCallback(
		(value: string) => {
			setTabs((prev) => prev.map((tab) => (tab.id === activeTabId ? { ...tab, draftUrl: value } : tab)));
		},
		[activeTabId]
	);

	const onAddressSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (!activeTab) {
				return;
			}
			addressInputRef.current?.blur();
			navigateTab(activeTabId, activeTab.draftUrl);
		},
		[activeTab, activeTabId, navigateTab]
	);

	const onAddressKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLInputElement>) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				if (activeTab) {
					setTabs((prev) =>
						prev.map((tab) => (tab.id === activeTabId ? { ...tab, draftUrl: tab.currentUrl } : tab))
					);
				}
				event.currentTarget.blur();
			}
		},
		[activeTab, activeTabId]
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const key = event.key.toLowerCase();
			const commandKey = event.ctrlKey || event.metaKey;
			if (commandKey && key === 'l') {
				event.preventDefault();
				addressInputRef.current?.focus();
				addressInputRef.current?.select();
				return;
			}
			const target = event.target as HTMLElement | null;
			const editing =
				target instanceof HTMLElement &&
				(Boolean(target.closest('input, textarea, select')) || target.isContentEditable);
			if (editing) {
				return;
			}
			if (commandKey && key === 't') {
				event.preventDefault();
				addNewTab();
				return;
			}
			if (commandKey && key === 'w') {
				event.preventDefault();
				const id = activeTabIdRef.current;
				if (id) {
					closeTab(id);
				}
				return;
			}
			if ((commandKey && key === 'r') || event.key === 'F5') {
				event.preventDefault();
				const id = activeTabIdRef.current;
				if (!id) {
					return;
				}
				setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, loadError: null } : tab)));
				webviewsRef.current.get(id)?.reload();
				return;
			}
			if (event.altKey && event.key === 'ArrowLeft') {
				event.preventDefault();
				const node = webviewsRef.current.get(activeTabIdRef.current);
				if (node?.canGoBack()) {
					node.goBack();
				}
				return;
			}
			if (event.altKey && event.key === 'ArrowRight') {
				event.preventDefault();
				const node = webviewsRef.current.get(activeTabIdRef.current);
				if (node?.canGoForward()) {
					node.goForward();
				}
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [addNewTab, closeTab]);

	useEffect(() => {
		const onSync = (event: Event) => {
			const detail = browserSidebarConfigSyncDetail(event);
			if (!detail) {
				return;
			}
			applyBrowserConfigLocally(detail.config, detail.defaultUserAgent);
		};
		window.addEventListener(BROWSER_SIDEBAR_CONFIG_SYNC_EVENT, onSync);
		return () => {
			window.removeEventListener(BROWSER_SIDEBAR_CONFIG_SYNC_EVENT, onSync);
		};
	}, [applyBrowserConfigLocally]);

	useEffect(() => {
		if (!shell) {
			return;
		}
		const payload = {
			activeTabId,
			tabs: tabs.map((tab) => ({
				id: tab.id,
				requestedUrl: tab.requestedUrl,
				currentUrl: tab.currentUrl,
				pageTitle: tab.pageTitle,
				isLoading: tab.isLoading,
				canGoBack: tab.canGoBack,
				canGoForward: tab.canGoForward,
				loadError: tab.loadError,
			})),
			guestBindings: tabs
				.map((tab) => {
					const node = webviewsRef.current.get(tab.id);
					if (!node?.getWebContentsId) {
						return null;
					}
					try {
						const webContentsId = Number(node.getWebContentsId());
						if (!Number.isInteger(webContentsId) || webContentsId <= 0) {
							return null;
						}
						return {
							tabId: tab.id,
							webContentsId,
						};
					} catch {
						return null;
					}
				})
				.filter((binding): binding is { tabId: string; webContentsId: number } => Boolean(binding)),
			updatedAt: Date.now(),
		};
		const timer = window.setTimeout(() => {
			void shell.invoke('browser:syncState', payload).catch(() => {
				/* ignore */
			});
		}, 40);
		return () => {
			window.clearTimeout(timer);
		};
	}, [activeTabId, shell, tabs]);

	useEffect(() => {
		if (!pendingCommand) {
			return;
		}
		const command = pendingCommand;
		const finish = () => onCommandHandled(command.commandId);
		if (command.type === 'navigate') {
			const activeId = activeTabIdRef.current;
			const hasActiveTab = Boolean(activeId && tabsRef.current.some((tab) => tab.id === activeId));
			if (command.newTab || !hasActiveTab || !activeId) {
				openInNewTab(normalizeBrowserTarget(command.target));
			} else {
				navigateTab(activeId, command.target);
			}
			finish();
			return;
		}
		if (command.type === 'applyConfig') {
			applyBrowserConfigLocally(command.config, command.defaultUserAgent);
			finish();
			return;
		}
		if (command.type === 'closeSidebar') {
			finish();
			return;
		}
		void (async () => {
			const targetTabId =
				command.tabId && tabsRef.current.some((tab) => tab.id === command.tabId)
					? command.tabId
					: activeTabIdRef.current;
			if (!targetTabId) {
				if (
					command.type === 'readPage' ||
					command.type === 'screenshotPage' ||
					command.type === 'clickElement' ||
					command.type === 'inputText' ||
					command.type === 'waitForSelector'
				) {
					await notifyBrowserCommandResult(shell, {
						commandId: command.commandId,
						ok: false,
						error: 'No active browser tab is available.',
					});
				}
				finish();
				return;
			}
			if (command.type === 'closeTab') {
				closeTab(targetTabId);
				finish();
				return;
			}
			setActiveTabId(targetTabId);
			if (
				command.type === 'readPage' ||
				command.type === 'screenshotPage' ||
				command.type === 'clickElement' ||
				command.type === 'inputText' ||
				command.type === 'waitForSelector'
			) {
				try {
					const node = await waitForWebviewNode(targetTabId);
					if (command.waitForLoad !== false) {
						await waitForWebviewSettled(node, targetTabId);
					}
					if (command.type === 'readPage') {
						const result = await readPageFromWebview(node, {
							selector: command.selector,
							includeHtml: command.includeHtml,
							maxChars: command.maxChars,
						});
						await notifyBrowserCommandResult(shell, {
							commandId: command.commandId,
							ok: true,
							result,
						});
					} else if (command.type === 'clickElement') {
						const result = await clickElementInWebview(node, {
							selector: command.selector,
						});
						if (command.waitForLoad !== false) {
							await new Promise((resolve) => window.setTimeout(resolve, 60));
							await waitForWebviewSettled(node, targetTabId);
						}
						await notifyBrowserCommandResult(shell, {
							commandId: command.commandId,
							ok: true,
							result,
						});
					} else if (command.type === 'inputText') {
						const result = await inputTextInWebview(node, {
							selector: command.selector,
							text: command.text,
							pressEnter: command.pressEnter,
						});
						if (command.waitForLoad !== false && command.pressEnter) {
							await new Promise((resolve) => window.setTimeout(resolve, 60));
							await waitForWebviewSettled(node, targetTabId);
						}
						await notifyBrowserCommandResult(shell, {
							commandId: command.commandId,
							ok: true,
							result,
						});
					} else if (command.type === 'waitForSelector') {
						const result = await waitForSelectorInWebview(node, {
							selector: command.selector,
							visible: command.visible,
							timeoutMs: command.timeoutMs,
						});
						await notifyBrowserCommandResult(shell, {
							commandId: command.commandId,
							ok: true,
							result,
						});
					} else {
						const result = await captureWebviewScreenshot(node);
						await notifyBrowserCommandResult(shell, {
							commandId: command.commandId,
							ok: true,
							result,
						});
					}
				} catch (error) {
					await notifyBrowserCommandResult(shell, {
						commandId: command.commandId,
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					});
				} finally {
					finish();
				}
				return;
			}
			const node = webviewsRef.current.get(targetTabId);
			if (command.type === 'reload') {
				setTabs((prev) => prev.map((tab) => (tab.id === targetTabId ? { ...tab, loadError: null } : tab)));
				node?.reload();
			} else if (command.type === 'stop') {
				node?.stop();
			} else if (command.type === 'goBack') {
				if (node?.canGoBack()) {
					node.goBack();
				}
			} else if (command.type === 'goForward' && node?.canGoForward()) {
				node.goForward();
			}
			finish();
		})();
	}, [
		applyBrowserConfigLocally,
		captureWebviewScreenshot,
		clickElementInWebview,
		closeTab,
		inputTextInWebview,
		navigateTab,
		onCommandHandled,
		openInNewTab,
		pendingCommand,
		readPageFromWebview,
		shell,
		waitForSelectorInWebview,
		waitForWebviewNode,
		waitForWebviewSettled,
	]);

	const headerLabel = activeTab
		? activeTab.isLoading
			? t('app.browserLoading')
			: activeTab.pageTitle || activeTab.currentUrl.replace(/^https?:\/\//i, '') || t('app.tabBrowser')
		: t('app.tabBrowser');
	const headerUrl = activeTab?.currentUrl ?? '';
	const userAgentProp = browserConfig.userAgent.trim() || undefined;
	const fingerprintPayloadKey = useMemo(() => JSON.stringify(browserConfig.fingerprint), [browserConfig.fingerprint]);
	const fingerprintScript = useMemo(() => {
		const patch = fingerprintSettingsToInjectPatch(browserConfig.fingerprint);
		return buildBrowserFingerprintStealthScript(patch);
	}, [fingerprintPayloadKey]);
	const captureRequestCount = captureState?.requestCount ?? 0;
	const capturePendingCount = captureState?.pendingRequestCount ?? 0;
	const captureTotalCount = captureRequestCount + capturePendingCount;
	const captureAttachedTabCount = captureState?.tabs.filter((tab) => tab.attached).length ?? 0;
	const captureKnownTabCount = captureState?.tabs.length ?? 0;
	const captureHasAttachError = Boolean(captureState?.tabs.some((tab) => tab.lastError));
	const browserTabCountLabel = t('app.browserTabsCount', { count: String(tabs.length) });
	const captureStatusTitle =
		captureError ||
		(captureHasAttachError
			? t('app.browserCaptureAttachWarning')
			: captureIsActive
				? t('app.browserCaptureCapturing')
				: t('app.browserCaptureReady'));
	const captureProxyIsRunning = captureProxyStatus?.running === true;
	const captureProxyPrimaryAddress = captureProxyStatus?.primaryAddress || '127.0.0.1';
	const captureProxyPort = captureProxyStatus?.port ?? 8888;
	const captureProxyUrl = captureProxyStatus?.proxyUrl || `http://${captureProxyPrimaryAddress}:${captureProxyPort}`;
	const captureProxyCaUrl =
		captureProxyStatus?.caDownloadUrl || `${captureProxyUrl.replace(/\/$/, '')}/__async_capture/ca.pem`;
	const captureProxyStatusText = captureProxyError
		? captureProxyError
		: captureProxyIsRunning
			? t('app.browserCaptureProxyRunning')
			: t('app.browserCaptureProxyStopped');
	const clearDataTitle = clearDataError || t('app.browserClearData');
	const selectedCaptureSummary =
		(selectedCaptureRequestId
			? captureRequests.find((request) => request.id === selectedCaptureRequestId)
			: null) ?? null;
	const selectedCaptureView = selectedCaptureRequest ?? selectedCaptureSummary;
	const captureListCaption = captureListError
		? captureListError
		: captureListBusy
			? t('app.browserCaptureLoadingRequests')
			: t('app.browserCaptureShowingRequests', {
					count: String(captureRequests.length),
					total: String(captureRequestTotal),
				});
	const visibleCaptureSelectedCount = captureRequests.reduce(
		(count, request) => count + (selectedCaptureRequestIds.has(request.id) ? 1 : 0),
		0
	);
	const captureSelectAllChecked = captureRequests.length > 0 && visibleCaptureSelectedCount === captureRequests.length;
	const captureSelectedCount = selectedCaptureRequestIds.size;
	const captureBulkScopeLabel =
		captureSelectedCount > 0
			? t('app.browserCaptureSelectedCount', { count: String(captureSelectedCount) })
			: t('app.browserCaptureFilteredCount', { count: String(captureRequestTotal) });
	const captureBulkStatusText = captureExportError || captureBulkScopeLabel;
	const captureBulkActionsDisabled =
		Boolean(captureExportBusy) || (captureSelectedCount <= 0 && captureRequestTotal <= 0);
	const captureCanLoadMore = captureRequests.length < captureRequestTotal;
	const captureRemainingRequestCount = Math.max(0, captureRequestTotal - captureRequests.length);
	const captureStatusFilters = useMemo<Array<{ key: BrowserCaptureStatusFilter; label: string }>>(
		() => [
			{ key: 'all', label: t('app.browserCaptureFilterAll') },
			{ key: 'pending', label: t('app.browserCaptureFilterPending') },
			{ key: '2xx', label: '2xx' },
			{ key: '3xx', label: '3xx' },
			{ key: '4xx', label: '4xx' },
			{ key: '5xx', label: '5xx' },
			{ key: 'error', label: t('app.browserCaptureFilterError') },
		],
		[t]
	);
	const captureMethodFilters = useMemo<Array<{ key: BrowserCaptureMethodFilter; label: string }>>(
		() => [
			{ key: 'all', label: t('app.browserCaptureFilterAll') },
			{ key: 'GET', label: 'GET' },
			{ key: 'POST', label: 'POST' },
			{ key: 'PUT', label: 'PUT' },
			{ key: 'PATCH', label: 'PATCH' },
			{ key: 'DELETE', label: 'DELETE' },
			{ key: 'OPTIONS', label: 'OPTIONS' },
			{ key: 'OTHER', label: t('app.browserCaptureFilterOther') },
		],
		[t]
	);
	const captureSourceFilters = useMemo<Array<{ key: BrowserCaptureSourceFilter; label: string }>>(
		() => [
			{ key: 'all', label: t('app.browserCaptureFilterAll') },
			{ key: 'browser', label: t('app.browserCaptureSourceBrowserShort') },
			{ key: 'proxy', label: t('app.browserCaptureSourceProxyShort') },
		],
		[t]
	);
	const captureResourceFilters = useMemo<Array<{ key: BrowserCaptureResourceFilter; label: string }>>(
		() => [
			{ key: 'all', label: t('app.browserCaptureFilterAll') },
			{ key: 'document', label: t('app.browserCaptureResourceDocument') },
			{ key: 'xhr', label: 'XHR' },
			{ key: 'fetch', label: 'Fetch' },
			{ key: 'script', label: t('app.browserCaptureResourceScript') },
			{ key: 'stylesheet', label: t('app.browserCaptureResourceStylesheet') },
			{ key: 'image', label: t('app.browserCaptureResourceImage') },
			{ key: 'other', label: t('app.browserCaptureFilterOther') },
		],
		[t]
	);
	const captureDetailTabs = useMemo<Array<{ key: BrowserCaptureDetailTab; label: string }>>(
		() => [
			{ key: 'headers', label: t('app.browserCaptureTabHeaders') },
			{ key: 'request', label: t('app.browserCaptureTabRequest') },
			{ key: 'response', label: t('app.browserCaptureTabResponse') },
		],
		[t]
	);
	const capturePanelTabs = useMemo<Array<{ key: BrowserCapturePanelTab; label: string }>>(
		() => [
			{ key: 'requests', label: t('app.browserCaptureTabRequests') },
			{ key: 'devices', label: t('app.browserCaptureTabDevices') },
		],
		[t]
	);
	useEffect(() => {
		if (!captureSelectAllRef.current) {
			return;
		}
		captureSelectAllRef.current.indeterminate =
			visibleCaptureSelectedCount > 0 && visibleCaptureSelectedCount < captureRequests.length;
	}, [captureRequests.length, visibleCaptureSelectedCount]);
	const handleCaptureRowKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>, requestId: string) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				setSelectedCaptureRequestId(requestId);
				return;
			}
			if (event.key === ' ') {
				event.preventDefault();
				toggleCaptureRequestSelected(requestId, !selectedCaptureRequestIds.has(requestId));
			}
		},
		[selectedCaptureRequestIds, toggleCaptureRequestSelected]
	);
	const captureDockBodyStyle = {
		'--ref-browser-capture-dock-height': `${captureDockHeight}px`,
	} as CSSProperties;
	const selectedRequestHeaderEntries = selectedCaptureRequest
		? Object.entries(selectedCaptureRequest.requestHeaders).sort(([left], [right]) => left.localeCompare(right))
		: [];
	const selectedResponseHeaderEntries = selectedCaptureRequest
		? Object.entries(selectedCaptureRequest.responseHeaders).sort(([left], [right]) => left.localeCompare(right))
		: [];
	const selectedRequestBodyText = selectedCaptureRequest
		? browserCaptureFormatBody(selectedCaptureRequest.requestBody)
		: '';
	const selectedResponseBodyText = selectedCaptureRequest
		? browserCaptureFormatBody(selectedCaptureRequest.responseBody)
		: '';
	const selectedResponseOmissionText = selectedCaptureRequest?.responseBodyOmittedReason
		? t('app.browserCaptureResponseBodyOmitted', {
				reason: selectedCaptureRequest.responseBodyOmittedReason,
			})
		: '';

	return (
		<div className={`ref-agent-review-shell ref-browser-shell ref-browser-shell--${variant}`}>
			<div className="ref-agent-review-head">
				<div className="ref-browser-head-main">
					<div className="ref-agent-review-title-stack ref-browser-title-stack">
						<span className="ref-agent-review-kicker">
							<span
								className={`ref-browser-live-dot${activeTab?.isLoading ? ' is-loading' : ''}`}
								aria-hidden="true"
							/>
							{t('app.tabBrowser')}
						</span>
						<span className="ref-agent-review-title" title={headerUrl}>
							{headerLabel}
						</span>
					</div>
					<div className="ref-browser-head-meta" aria-label={t('app.tabBrowser')}>
						<span className="ref-browser-status-chip">{browserTabCountLabel}</span>
						{variant === 'window' ? null : (
							<span className={`ref-browser-status-chip${captureIsActive ? ' is-active' : ''}`}>
								{captureIsActive
									? t('app.browserCaptureRequestsShort', {
											count: String(captureTotalCount),
										})
									: t('app.browserCaptureReady')}
							</span>
						)}
					</div>
				</div>
				{variant === 'window' ? (
					<div className="ref-agent-review-actions">
						<button
							type="button"
							aria-label={t('app.browserOpenSettingsInMain')}
							title={t('app.browserOpenSettingsInMain')}
							className="ref-right-icon-tab"
							onClick={onOpenBrowserSettings}
						>
							<IconSettings />
						</button>
					</div>
				) : (
					<RightSidebarTabs
						t={t}
						hasPlan={hasAgentPlanSidebarContent}
						openView={openView}
						closeSidebar={closeSidebar}
						extraActions={
							<button
								type="button"
								aria-label={t('app.browserSettings')}
								title={t('app.browserSettings')}
								className="ref-right-icon-tab"
								onClick={onOpenBrowserSettings}
							>
								<IconSettings />
							</button>
						}
					/>
				)}
			</div>
			<div className="ref-right-panel-stage">
				<div className={`ref-right-panel-view ref-right-panel-view--agent ref-browser-panel ref-browser-panel--${variant}`}>
					{browserConfigReady ? (
						<div className="ref-browser-tabstrip" role="tablist" aria-label={t('app.tabBrowser')}>
							<div className="ref-browser-tabstrip-scroll">
								{tabs.map((tab) => {
									const tabActive = tab.id === activeTabId;
									const tabLabel =
										(tab.pageTitle && tab.pageTitle.trim()) ||
										(tab.currentUrl ? tab.currentUrl.replace(/^https?:\/\//i, '') : '') ||
										t('app.browserUntitled');
									return (
										<div
											key={tab.id}
											role="tab"
											aria-selected={tabActive}
											tabIndex={0}
											className={`ref-browser-tab${tabActive ? ' is-active' : ''}`}
											title={tab.currentUrl || tabLabel}
											onClick={() => activateTab(tab.id)}
											onKeyDown={(event) => {
												if (event.key === 'Enter' || event.key === ' ') {
													event.preventDefault();
													activateTab(tab.id);
												}
											}}
											onMouseDown={(event) => {
												// middle-click closes tab, like real browsers
												if (event.button === 1) {
													event.preventDefault();
													closeTab(tab.id);
												}
											}}
										>
											<span className="ref-browser-tab-indicator" aria-hidden="true">
												{tab.isLoading ? (
													<span className="ref-browser-tab-spinner" />
												) : (
													<IconGlobe className="ref-browser-tab-favicon" />
												)}
											</span>
											<span className="ref-browser-tab-label">{tabLabel}</span>
											<button
												type="button"
												className="ref-browser-tab-close"
												aria-label={t('app.browserCloseTab')}
												title={t('app.browserCloseTab')}
												onClick={(event) => {
													event.stopPropagation();
													closeTab(tab.id);
												}}
											>
												<IconCloseSmall />
											</button>
										</div>
									);
								})}
							</div>
							<button
								type="button"
								className="ref-browser-tabstrip-add"
								aria-label={t('app.browserNewTab')}
								title={t('app.browserNewTab')}
								onClick={addNewTab}
							>
								<IconPlus />
							</button>
						</div>
					) : null}
					<div className="ref-right-toolbar ref-browser-toolbar">
						<div className="ref-browser-toolbar-group ref-browser-toolbar-group--nav">
							<button
								type="button"
								className="ref-icon-tile ref-browser-tool-btn"
								aria-label={t('common.back')}
								title={t('common.back')}
								disabled={!activeTab?.canGoBack}
								onClick={() => {
									const node = activeWebview();
									if (!node?.canGoBack()) {
										return;
									}
									node.goBack();
								}}
							>
								<IconArrowLeft />
							</button>
							<button
								type="button"
								className="ref-icon-tile ref-browser-tool-btn"
								aria-label={t('app.browserForward')}
								title={t('app.browserForward')}
								disabled={!activeTab?.canGoForward}
								onClick={() => {
									const node = activeWebview();
									if (!node?.canGoForward()) {
										return;
									}
									node.goForward();
								}}
							>
								<IconArrowRight />
							</button>
							<button
								type="button"
								className="ref-icon-tile ref-browser-tool-btn"
								aria-label={activeTab?.isLoading ? t('app.browserStop') : t('common.refresh')}
								title={activeTab?.isLoading ? t('app.browserStop') : t('common.refresh')}
								onClick={() => {
									const node = activeWebview();
									if (!node) {
										return;
									}
									if (activeTab?.isLoading) {
										node.stop();
										return;
									}
									setTabs((prev) =>
										prev.map((tab) => (tab.id === activeTabId ? { ...tab, loadError: null } : tab))
									);
									node.reload();
								}}
							>
								{activeTab?.isLoading ? <IconStop /> : <IconRefresh />}
							</button>
							<div className="ref-browser-clear-wrap">
								<button
									type="button"
									className="ref-icon-tile ref-browser-tool-btn"
									aria-label={clearDataTitle}
									title={clearDataTitle}
									disabled={clearDataBusy}
									onClick={() => {
										setClearDataConfirmOpen((open) => !open);
										setClearDataError(null);
									}}
								>
									<IconTrash />
								</button>
								{clearDataConfirmOpen ? (
									<div className="ref-browser-clear-confirm" role="dialog" aria-label={t('app.browserClearData')}>
										<span className="ref-browser-clear-confirm-copy">
											{clearDataError || t('app.browserClearDataConfirm')}
										</span>
										<div className="ref-browser-clear-confirm-actions">
											<button
												type="button"
												className="ref-browser-mini-btn ref-browser-mini-btn--danger"
												disabled={clearDataBusy}
												onClick={() => void clearBrowserData()}
											>
												{clearDataBusy ? t('app.browserClearingData') : t('app.browserClearDataAction')}
											</button>
											<button
												type="button"
												className="ref-browser-mini-btn"
												disabled={clearDataBusy}
												onClick={() => {
													setClearDataConfirmOpen(false);
													setClearDataError(null);
												}}
											>
												{t('common.cancel')}
											</button>
										</div>
									</div>
								) : null}
							</div>
						</div>
						<form className="ref-browser-address-form" onSubmit={onAddressSubmit}>
							<IconGlobe className="ref-browser-address-icon" />
							<input
								ref={addressInputRef}
								type="text"
								className="ref-browser-address-input"
								value={activeTab?.draftUrl ?? ''}
								placeholder={t('app.browserAddressPlaceholder')}
								spellCheck={false}
								autoCapitalize="none"
								autoCorrect="off"
								onChange={(event) => onAddressChange(event.target.value)}
								onFocus={(event) => event.currentTarget.select()}
								onKeyDown={onAddressKeyDown}
							/>
							<button
								type="submit"
								className="ref-browser-address-go"
								aria-label={t('app.browserGo')}
								title={t('app.browserGo')}
								disabled={!String(activeTab?.draftUrl ?? '').trim()}
							>
								<IconArrowUp />
							</button>
						</form>
					</div>
					<div className="ref-browser-webview-wrap">
						{browserConfigReady && browserPartition ? (
							tabs.map((tab) => (
								<BrowserTabView
										key={tab.id}
										tab={tab}
										partition={browserPartition}
										userAgent={userAgentProp}
										fingerprintScript={fingerprintScript}
										active={tab.id === activeTabId}
										t={t}
										onNavigate={handleTabNavigate}
										onTitle={handleTabTitle}
										onLoading={handleTabLoading}
										onFailLoad={handleTabFailLoad}
										onRegisterWebview={handleRegisterWebview}
									/>
							))
						) : (
							<div className="ref-browser-preparing">
								<div className="ref-agent-plan-status-title">{t('app.browserPreparing')}</div>
								<p className="ref-agent-plan-status-body">{t('app.browserSettingsDescription')}</p>
							</div>
						)}
						{activeTab?.loadError ? (
							<div className="ref-browser-error-card" role="status">
								<div className="ref-browser-error-title">{t('app.browserLoadFailed')}</div>
								<p className="ref-browser-error-body">{activeTab.loadError.message}</p>
								{activeTab.loadError.url ? (
									<p className="ref-browser-error-url" title={activeTab.loadError.url}>
										{activeTab.loadError.url}
									</p>
								) : null}
								<button
									type="button"
									className="ref-browser-error-btn"
									onClick={() => {
										const tabId = activeTabId;
										setTabs((prev) =>
											prev.map((tab) => (tab.id === tabId ? { ...tab, loadError: null } : tab))
										);
										webviewsRef.current.get(tabId)?.reload();
									}}
								>
									{t('common.refresh')}
								</button>
							</div>
						) : null}
					</div>
					<div
						className={`ref-browser-capture-dock${capturePanelExpanded ? ' is-expanded' : ' is-collapsed'}${
							captureIsActive ? ' is-active' : ''
						}`}
					>
						<div className="ref-browser-capture-dock-summary">
							<button
								type="button"
								className="ref-browser-capture-dock-toggle"
								aria-expanded={capturePanelExpanded}
								aria-label={
									capturePanelExpanded ? t('app.browserCaptureCollapse') : t('app.browserCaptureExpand')
								}
								title={
									capturePanelExpanded ? t('app.browserCaptureCollapse') : t('app.browserCaptureExpand')
								}
								onClick={() => setCapturePanelExpanded((expanded) => !expanded)}
							>
								<span className="ref-browser-capture-dot" aria-hidden="true" />
								<span className="ref-browser-capture-dock-title">
									{captureIsActive ? t('app.browserCaptureCapturing') : t('app.browserCaptureReady')}
								</span>
								<span className="ref-browser-capture-dock-metric">
									{t('app.browserCaptureRequestsShort', { count: String(captureTotalCount) })}
								</span>
								<span className="ref-browser-capture-dock-metric">
									{t('app.browserCaptureTabsShort', {
										attached: String(captureAttachedTabCount),
										total: String(captureKnownTabCount || tabs.length),
									})}
								</span>
								<span className={`ref-browser-capture-dock-metric${captureProxyIsRunning ? ' is-active' : ''}`}>
									{captureProxyIsRunning
										? t('app.browserCaptureProxyShortOn')
										: t('app.browserCaptureProxyShortOff')}
								</span>
								<IconChevron className="ref-browser-capture-dock-chevron" />
							</button>
							<div className="ref-browser-capture-dock-quick-actions">
								<button
									type="button"
									className="ref-browser-capture-btn"
									disabled={Boolean(captureBusy)}
									onClick={() => void runBrowserCaptureAction(captureIsActive ? 'stop' : 'start')}
								>
									{captureBusy === 'start'
										? t('app.browserCaptureStarting')
										: captureBusy === 'stop'
											? t('app.browserCaptureStopping')
											: captureIsActive
												? t('app.browserCaptureStop')
												: t('app.browserCaptureStart')}
								</button>
								<button
									type="button"
									className="ref-browser-capture-btn ref-browser-capture-btn--ghost"
									disabled={Boolean(captureBusy) || captureTotalCount <= 0}
									onClick={() => void runBrowserCaptureAction('clear')}
								>
									{captureBusy === 'clear' ? t('app.browserCaptureClearing') : t('app.browserCaptureClear')}
								</button>
							</div>
						</div>
						{capturePanelExpanded ? (
							<>
								<div
									className="ref-browser-capture-dock-resize"
									role="separator"
									aria-orientation="horizontal"
									title={t('app.browserCaptureResizeDock')}
									onPointerDown={handleCaptureDockResizePointerDown}
								>
									<span aria-hidden="true" />
								</div>
								<div className="ref-browser-capture-dock-body" style={captureDockBodyStyle}>
								<div className="ref-browser-capture-control-row">
									<div className="ref-browser-capture-dock-copy">
										<div className="ref-browser-capture-dock-heading">{t('app.browserCapturePanel')}</div>
										<div className="ref-browser-capture-dock-subtitle" title={captureStatusTitle}>
											{captureStatusTitle}
										</div>
									</div>
									<div className="ref-browser-capture-dock-stats" aria-label={t('app.browserCapturePanel')}>
										<div className="ref-browser-capture-stat">
											<span>{t('app.browserCaptureStatus')}</span>
											<strong>
												{captureIsActive ? t('app.browserCaptureCapturing') : t('app.browserCaptureReady')}
											</strong>
										</div>
										<div className="ref-browser-capture-stat">
											<span>{t('app.browserCaptureRequests')}</span>
											<strong>{captureTotalCount}</strong>
										</div>
										<div className="ref-browser-capture-stat">
											<span>{t('app.browserCaptureAttachedTabs')}</span>
											<strong>
												{captureAttachedTabCount}/{captureKnownTabCount || tabs.length}
											</strong>
										</div>
									</div>
									<div className="ref-browser-capture-actions">
										<button
											type="button"
											className="ref-browser-capture-btn"
											disabled={Boolean(captureBusy)}
											onClick={() => void runBrowserCaptureAction(captureIsActive ? 'stop' : 'start')}
										>
											{captureBusy === 'start'
												? t('app.browserCaptureStarting')
												: captureBusy === 'stop'
													? t('app.browserCaptureStopping')
													: captureIsActive
														? t('app.browserCaptureStop')
														: t('app.browserCaptureStart')}
										</button>
										<button
											type="button"
											className="ref-browser-capture-btn ref-browser-capture-btn--ghost"
											disabled={Boolean(captureBusy) || captureTotalCount <= 0}
											onClick={() => void runBrowserCaptureAction('clear')}
										>
											{captureBusy === 'clear' ? t('app.browserCaptureClearing') : t('app.browserCaptureClear')}
										</button>
									</div>
								</div>
								<div className="ref-browser-capture-mode-tabs" role="tablist" aria-label={t('app.browserCapturePanel')}>
									{capturePanelTabs.map((tab) => (
										<button
											key={tab.key}
											type="button"
											role="tab"
											aria-selected={capturePanelTab === tab.key}
											className={`ref-browser-capture-mode-tab${capturePanelTab === tab.key ? ' is-active' : ''}`}
											onClick={() => setCapturePanelTab(tab.key)}
										>
											{tab.label}
										</button>
									))}
								</div>
								{capturePanelTab === 'requests' ? (
								<div className="ref-browser-capture-network">
									<div className="ref-browser-capture-list">
										<div className="ref-browser-capture-bulk-toolbar">
											<span className={`ref-browser-capture-bulk-status${captureExportError ? ' has-error' : ''}`}>
												{captureBulkStatusText}
											</span>
											<div className="ref-browser-capture-bulk-actions">
												<button
													type="button"
													className="ref-browser-capture-mini-btn ref-browser-capture-mini-btn--primary"
													disabled={captureBulkActionsDisabled || !shell}
													onClick={() => void sendBrowserCaptureToAgentDraft()}
													title={t('app.browserCaptureSendToAgent')}
												>
													<IconArrowUpRight />
													<span>
														{copiedCaptureField === 'agent'
															? t('app.browserCaptureSentToAgent')
															: captureExportBusy === 'agent'
																? t('app.browserCaptureSendingToAgent')
																: t('app.browserCaptureSendToAgent')}
													</span>
												</button>
												<button
													type="button"
													className="ref-browser-capture-mini-btn"
													disabled={captureBulkActionsDisabled}
													onClick={() => void copyBrowserCaptureCurl()}
													title={t('app.browserCaptureCopyCurl')}
												>
													<IconCopy />
													<span>
														{copiedCaptureField === 'curl'
															? t('app.browserCaptureCopied')
															: captureExportBusy === 'curl'
																? t('app.browserCaptureExporting')
																: t('app.browserCaptureCopyCurl')}
													</span>
												</button>
												<button
													type="button"
													className="ref-browser-capture-mini-btn"
													disabled={captureBulkActionsDisabled}
													onClick={() => void exportBrowserCaptureRequests('json')}
													title={t('app.browserCaptureExportJson')}
												>
													<IconDownload />
													<span>
														{captureExportBusy === 'json'
															? t('app.browserCaptureExporting')
															: t('app.browserCaptureExportJson')}
													</span>
												</button>
												<button
													type="button"
													className="ref-browser-capture-mini-btn"
													disabled={captureBulkActionsDisabled}
													onClick={() => void exportBrowserCaptureRequests('har')}
													title={t('app.browserCaptureExportHar')}
												>
													<IconDownload />
													<span>
														{captureExportBusy === 'har'
															? t('app.browserCaptureExporting')
															: t('app.browserCaptureExportHar')}
													</span>
												</button>
											</div>
										</div>
										<div className="ref-browser-capture-list-toolbar">
											<div className="ref-browser-capture-list-toolbar-top">
												<label className="ref-browser-capture-search-wrap">
													<IconSearch className="ref-browser-capture-search-icon" />
													<input
														type="search"
														className="ref-browser-capture-search"
														value={captureQuery}
														placeholder={t('app.browserCaptureSearchPlaceholder')}
														aria-label={t('app.browserCaptureSearchPlaceholder')}
														onChange={(event) => setCaptureQuery(event.target.value)}
													/>
												</label>
												<span className="ref-browser-capture-list-count" title={captureListCaption}>
													{captureListCaption}
												</span>
											</div>
											<div className="ref-browser-capture-filter-groups">
												<div
													className="ref-browser-capture-filter-strip ref-browser-capture-filter-strip--status"
													aria-label={t('app.browserCaptureStatusFilterLabel')}
												>
													<span className="ref-browser-capture-filter-label">
														<IconListFilter className="ref-browser-capture-filter-icon" />
														{t('app.browserCaptureStatus')}
													</span>
													{captureStatusFilters.map((filter) => (
														<button
															key={filter.key}
															type="button"
															className={`ref-browser-capture-filter-chip${
																captureStatusFilter === filter.key ? ' is-active' : ''
															}`}
															onClick={() => setCaptureStatusFilter(filter.key)}
														>
															{filter.label}
														</button>
													))}
												</div>
												<div
													className="ref-browser-capture-filter-strip ref-browser-capture-filter-strip--method"
													aria-label={t('app.browserCaptureMethodFilterLabel')}
												>
													<span className="ref-browser-capture-filter-label">
														{t('app.browserCaptureColumnMethod')}
													</span>
													{captureMethodFilters.map((filter) => (
														<button
															key={filter.key}
															type="button"
															className={`ref-browser-capture-filter-chip${
																captureMethodFilter === filter.key ? ' is-active' : ''
															}`}
															onClick={() => setCaptureMethodFilter(filter.key)}
														>
															{filter.label}
														</button>
													))}
												</div>
												<div
													className="ref-browser-capture-filter-strip ref-browser-capture-filter-strip--source"
													aria-label={t('app.browserCaptureSourceFilterLabel')}
												>
													<span className="ref-browser-capture-filter-label">
														{t('app.browserCaptureColumnSource')}
													</span>
													{captureSourceFilters.map((filter) => (
														<button
															key={filter.key}
															type="button"
															className={`ref-browser-capture-filter-chip${
																captureSourceFilter === filter.key ? ' is-active' : ''
															}`}
															onClick={() => setCaptureSourceFilter(filter.key)}
														>
															{filter.label}
														</button>
													))}
												</div>
												<div
													className="ref-browser-capture-filter-strip ref-browser-capture-filter-strip--resource"
													aria-label={t('app.browserCaptureResourceFilterLabel')}
												>
													<span className="ref-browser-capture-filter-label">
														{t('app.browserCaptureResourceType')}
													</span>
													{captureResourceFilters.map((filter) => (
														<button
															key={filter.key}
															type="button"
															className={`ref-browser-capture-filter-chip${
																captureResourceFilter === filter.key ? ' is-active' : ''
															}`}
															onClick={() => setCaptureResourceFilter(filter.key)}
														>
															{filter.label}
														</button>
													))}
												</div>
											</div>
										</div>
										<div className="ref-browser-capture-table" role="table" aria-label={t('app.browserCaptureRequests')}>
											<div className="ref-browser-capture-table-head" role="row">
												<label
													className="ref-browser-capture-check-cell"
													title={t('app.browserCaptureToggleVisible')}
												>
													<input
														ref={captureSelectAllRef}
														type="checkbox"
														checked={captureSelectAllChecked}
														disabled={captureRequests.length <= 0}
														aria-label={t('app.browserCaptureToggleVisible')}
														onChange={toggleVisibleCaptureRequestsSelected}
													/>
												</label>
												<span>{t('app.browserCaptureColumnSeq')}</span>
												<span>{t('app.browserCaptureColumnSource')}</span>
												<span>{t('app.browserCaptureColumnMethod')}</span>
												<span>{t('app.browserCaptureColumnStatus')}</span>
												<span>{t('app.browserCaptureColumnHost')}</span>
												<span>{t('app.browserCaptureColumnPath')}</span>
												<span>{t('app.browserCaptureColumnTime')}</span>
											</div>
											<div className="ref-browser-capture-table-body">
												{captureRequests.length > 0 ? (
													<>
													{captureRequests.map((request) => {
														const activeRequest = request.id === selectedCaptureRequestId;
														const checkedRequest = selectedCaptureRequestIds.has(request.id);
														return (
															<div
																key={request.id}
																role="row"
																tabIndex={0}
																className={`ref-browser-capture-row${activeRequest ? ' is-selected' : ''}${
																	request.errorText ? ' has-error' : ''
																}${checkedRequest ? ' is-checked' : ''}`}
																onClick={() => setSelectedCaptureRequestId(request.id)}
																onKeyDown={(event) => handleCaptureRowKeyDown(event, request.id)}
															>
																<label
																	className="ref-browser-capture-check-cell"
																	title={t('app.browserCaptureToggleRequest')}
																	onClick={(event) => event.stopPropagation()}
																>
																	<input
																		type="checkbox"
																		checked={checkedRequest}
																		aria-label={t('app.browserCaptureToggleRequest')}
																		onChange={(event) =>
																			toggleCaptureRequestSelected(request.id, event.currentTarget.checked)
																		}
																	/>
																</label>
																<span className="ref-browser-capture-cell ref-browser-capture-seq">
																	#{request.seq}
																</span>
																<span
																	className={`ref-browser-capture-source ref-browser-capture-source--${request.source}`}
																	title={
																		request.source === 'proxy'
																			? t('app.browserCaptureSourceProxy')
																			: t('app.browserCaptureSourceBrowser')
																	}
																>
																	{request.source === 'proxy'
																		? t('app.browserCaptureSourceProxyShort')
																		: t('app.browserCaptureSourceBrowserShort')}
																</span>
																<span className="ref-browser-capture-method" data-method={request.method}>
																	{request.method}
																</span>
																<span
																	className="ref-browser-capture-status"
																	data-status={request.status == null ? 'pending' : String(Math.floor(request.status / 100))}
																>
																	{request.status ?? '--'}
																</span>
																<span className="ref-browser-capture-host" title={browserCaptureUrlHost(request.url)}>
																	{browserCaptureUrlHost(request.url) || '--'}
																</span>
																<span className="ref-browser-capture-path" title={request.url}>
																	{browserCaptureUrlPath(request.url)}
																</span>
																<span className="ref-browser-capture-time">
																	{browserCaptureFormatDuration(request.durationMs)}
																</span>
															</div>
														);
													})}
													{captureCanLoadMore ? (
														<div className="ref-browser-capture-load-more">
															<button
																type="button"
																className="ref-browser-capture-load-more-btn"
																disabled={captureListBusy}
																onClick={() => void refreshBrowserCaptureRequests('append')}
															>
																<span>
																	{captureListBusy
																		? t('app.browserCaptureLoadingRequests')
																		: t('app.browserCaptureLoadMore')}
																</span>
																<span className="ref-browser-capture-load-more-count">
																	{t('app.browserCaptureRemainingCount', {
																		count: String(captureRemainingRequestCount),
																	})}
																</span>
															</button>
														</div>
													) : null}
													</>
												) : (
													<div className="ref-browser-capture-empty">
														{captureListBusy
															? t('app.browserCaptureLoadingRequests')
															: t('app.browserCaptureNoRequests')}
													</div>
												)}
											</div>
										</div>
									</div>
									<div className="ref-browser-capture-detail">
										{selectedCaptureView ? (
											<>
												<div className="ref-browser-capture-detail-head">
													<div className="ref-browser-capture-detail-meta">
														<span
															className="ref-browser-capture-method"
															data-method={selectedCaptureView.method}
														>
															{selectedCaptureView.method}
														</span>
														<span
															className="ref-browser-capture-status"
															data-status={
																selectedCaptureView.status == null
																	? 'pending'
																	: String(Math.floor(selectedCaptureView.status / 100))
															}
														>
															{selectedCaptureView.status ?? '--'}
														</span>
														<span className="ref-browser-capture-detail-time">
															{browserCaptureFormatDuration(selectedCaptureView.durationMs)}
														</span>
													</div>
													<div className="ref-browser-capture-detail-actions">
														<button
															type="button"
															className="ref-browser-copy-btn"
															disabled={!selectedCaptureRequest}
															onClick={() => {
																if (selectedCaptureRequest) {
																	void copyCaptureText('curl', browserCaptureBuildCurl(selectedCaptureRequest));
																}
															}}
														>
															<IconCopy />
															<span>
																{copiedCaptureField === 'curl'
																	? t('app.browserCaptureCopied')
																	: t('app.browserCaptureCopyCurl')}
															</span>
														</button>
														<button
															type="button"
															className="ref-browser-copy-btn"
															disabled={!selectedCaptureView.url}
															onClick={() => void copyCaptureText('url', selectedCaptureView.url)}
														>
															<IconCopy />
															<span>
																{copiedCaptureField === 'url'
																	? t('app.browserCaptureCopied')
																	: t('app.browserCaptureCopyUrl')}
															</span>
														</button>
													</div>
												</div>
												<div className="ref-browser-capture-detail-url" title={selectedCaptureView.url}>
													{selectedCaptureView.url}
												</div>
												{selectedCaptureBusy ? (
													<div className="ref-browser-capture-empty">
														{t('app.browserCaptureLoadingRequest')}
													</div>
												) : selectedCaptureRequest ? (
													<>
														<div className="ref-browser-capture-detail-tabs" role="tablist">
															{captureDetailTabs.map((tab) => (
																<button
																	key={tab.key}
																	type="button"
																	role="tab"
																	aria-selected={captureDetailTab === tab.key}
																	className={`ref-browser-capture-detail-tab${
																		captureDetailTab === tab.key ? ' is-active' : ''
																	}`}
																	onClick={() => setCaptureDetailTab(tab.key)}
																>
																	{tab.label}
																</button>
															))}
														</div>
														<div className="ref-browser-capture-detail-scroll">
															{captureDetailTab === 'headers' ? (
																<>
																	<div className="ref-browser-capture-detail-section">
																		<div className="ref-browser-capture-section-head">
																			<div className="ref-browser-capture-section-title">
																				{t('app.browserCaptureRequestHeaders')}
																			</div>
																			<button
																				type="button"
																				className="ref-browser-copy-icon-btn"
																				aria-label={t('app.browserCaptureCopyRequestHeaders')}
																				title={t('app.browserCaptureCopyRequestHeaders')}
																				disabled={selectedRequestHeaderEntries.length <= 0}
																				onClick={() =>
																					void copyCaptureText(
																						'requestHeaders',
																						browserCaptureFormatHeaders(selectedCaptureRequest.requestHeaders)
																					)
																				}
																			>
																				<IconCopy />
																			</button>
																		</div>
																		<div className="ref-browser-capture-kv-list">
																			{selectedRequestHeaderEntries.length > 0 ? (
																				selectedRequestHeaderEntries.map(([key, value]) => (
																					<div className="ref-browser-capture-kv" key={`req-${key}`}>
																						<span>{key}</span>
																						<code>{value}</code>
																					</div>
																				))
																			) : (
																				<div className="ref-browser-capture-inline-empty">
																					{t('app.browserCaptureEmptyBody')}
																				</div>
																			)}
																		</div>
																	</div>
																	<div className="ref-browser-capture-detail-section">
																		<div className="ref-browser-capture-section-head">
																			<div className="ref-browser-capture-section-title">
																				{t('app.browserCaptureResponseHeaders')}
																			</div>
																			<button
																				type="button"
																				className="ref-browser-copy-icon-btn"
																				aria-label={t('app.browserCaptureCopyResponseHeaders')}
																				title={t('app.browserCaptureCopyResponseHeaders')}
																				disabled={selectedResponseHeaderEntries.length <= 0}
																				onClick={() =>
																					void copyCaptureText(
																						'responseHeaders',
																						browserCaptureFormatHeaders(selectedCaptureRequest.responseHeaders)
																					)
																				}
																			>
																				<IconCopy />
																			</button>
																		</div>
																		<div className="ref-browser-capture-kv-list">
																			{selectedResponseHeaderEntries.length > 0 ? (
																				selectedResponseHeaderEntries.map(([key, value]) => (
																					<div className="ref-browser-capture-kv" key={`res-${key}`}>
																						<span>{key}</span>
																						<code>{value}</code>
																					</div>
																				))
																			) : (
																				<div className="ref-browser-capture-inline-empty">
																					{t('app.browserCaptureEmptyBody')}
																				</div>
																			)}
																		</div>
																	</div>
																</>
															) : captureDetailTab === 'request' ? (
																<div className="ref-browser-capture-detail-section">
																	<div className="ref-browser-capture-section-head">
																		<div className="ref-browser-capture-section-title">
																			{t('app.browserCaptureRequestBody')}
																		</div>
																		<button
																			type="button"
																			className="ref-browser-copy-icon-btn"
																			aria-label={t('app.browserCaptureCopyRequestBody')}
																			title={t('app.browserCaptureCopyRequestBody')}
																			disabled={!selectedRequestBodyText}
																			onClick={() => void copyCaptureText('requestBody', selectedRequestBodyText)}
																		>
																			<IconCopy />
																		</button>
																	</div>
																	<pre className="ref-browser-capture-body-block ref-browser-capture-body-block--large">
																		{selectedRequestBodyText || t('app.browserCaptureEmptyBody')}
																	</pre>
																	{selectedCaptureRequest.requestBodyTruncated ? (
																		<div className="ref-browser-capture-note">
																			{t('app.browserCaptureBodyTruncated')}
																		</div>
																	) : null}
																</div>
															) : (
																<div className="ref-browser-capture-detail-section">
																	<div className="ref-browser-capture-meta-grid">
																		<span>{t('app.browserCaptureColumnSource')}</span>
																		<strong>
																			{selectedCaptureRequest.source === 'proxy'
																				? t('app.browserCaptureSourceProxy')
																				: t('app.browserCaptureSourceBrowser')}
																		</strong>
																		<span>{t('app.browserCaptureColumnStatus')}</span>
																		<strong>{selectedCaptureRequest.status ?? '--'}</strong>
																		<span>{t('app.browserCaptureContentType')}</span>
																		<strong>{selectedCaptureRequest.contentType ?? '--'}</strong>
																		<span>{t('app.browserCaptureResourceType')}</span>
																		<strong>{selectedCaptureRequest.resourceType ?? '--'}</strong>
																	</div>
																	<div className="ref-browser-capture-section-head">
																		<div className="ref-browser-capture-section-title">
																			{t('app.browserCaptureResponseBody')}
																		</div>
																		<button
																			type="button"
																			className="ref-browser-copy-icon-btn"
																			aria-label={t('app.browserCaptureCopyResponseBody')}
																			title={t('app.browserCaptureCopyResponseBody')}
																			disabled={!selectedResponseBodyText}
																			onClick={() => void copyCaptureText('responseBody', selectedResponseBodyText)}
																		>
																			<IconCopy />
																		</button>
																	</div>
																	<pre className="ref-browser-capture-body-block ref-browser-capture-body-block--large">
																		{selectedResponseBodyText ||
																			selectedResponseOmissionText ||
																			t('app.browserCaptureEmptyBody')}
																	</pre>
																	{selectedCaptureRequest.responseBodyTruncated ? (
																		<div className="ref-browser-capture-note">
																			{t('app.browserCaptureBodyTruncated')}
																		</div>
																	) : null}
																</div>
															)}
														</div>
													</>
												) : (
													<div className="ref-browser-capture-empty">
														{t('app.browserCaptureRequestNotFound')}
													</div>
												)}
											</>
										) : (
											<div className="ref-browser-capture-empty">{t('app.browserCaptureSelectRequest')}</div>
										)}
									</div>
								</div>
								) : (
								<div className="ref-browser-capture-device-panel">
									<div className="ref-browser-capture-device-main">
										<div className="ref-browser-capture-device-head">
											<div className="ref-browser-capture-device-title">
												<span className={`ref-browser-capture-device-dot${captureProxyIsRunning ? ' is-active' : ''}`} />
												<div>
													<strong>{t('app.browserCaptureDeviceTitle')}</strong>
													<span>{captureProxyStatusText}</span>
												</div>
											</div>
											<div className="ref-browser-capture-device-actions">
												<button
													type="button"
													className="ref-browser-capture-btn"
													disabled={Boolean(captureProxyBusy || captureBusy)}
													onClick={() => void runBrowserCaptureProxyAction(captureProxyIsRunning ? 'stop' : 'start')}
												>
													{captureProxyBusy === 'start'
														? t('app.browserCaptureProxyStarting')
														: captureProxyBusy === 'stop'
															? t('app.browserCaptureProxyStopping')
															: captureProxyIsRunning
																? t('app.browserCaptureProxyStop')
																: t('app.browserCaptureProxyStart')}
												</button>
												<button
													type="button"
													className="ref-browser-capture-btn ref-browser-capture-btn--ghost"
													disabled={captureProxyBusy === 'ca'}
													onClick={() => void exportBrowserCaptureProxyCa()}
												>
													{copiedCaptureField === 'ca'
														? t('app.browserCaptureProxyCaDownloaded')
														: captureProxyBusy === 'ca'
															? t('app.browserCaptureExporting')
															: t('app.browserCaptureProxyDownloadCa')}
												</button>
												<button
													type="button"
													className="ref-browser-capture-btn ref-browser-capture-btn--ghost"
													onClick={() => {
														setCaptureSourceFilter('proxy');
														setCapturePanelTab('requests');
													}}
												>
													{t('app.browserCaptureShowProxyRequests')}
												</button>
											</div>
										</div>
										<div className="ref-browser-capture-device-fields">
											<div className="ref-browser-capture-device-field ref-browser-capture-device-field--wide">
												<span>{t('app.browserCaptureProxyAddress')}</span>
												<code title={captureProxyUrl}>{captureProxyUrl}</code>
												<button
													type="button"
													className="ref-browser-copy-icon-btn"
													aria-label={t('app.browserCaptureCopyProxyAddress')}
													title={t('app.browserCaptureCopyProxyAddress')}
													onClick={() => void copyCaptureText('proxyUrl', captureProxyUrl)}
												>
													<IconCopy />
												</button>
											</div>
											<div className="ref-browser-capture-device-field">
												<span>{t('app.browserCaptureProxyHost')}</span>
												<code title={captureProxyPrimaryAddress}>{captureProxyPrimaryAddress}</code>
												<button
													type="button"
													className="ref-browser-copy-icon-btn"
													aria-label={t('app.browserCaptureCopyProxyHost')}
													title={t('app.browserCaptureCopyProxyHost')}
													onClick={() => void copyCaptureText('proxyHost', captureProxyPrimaryAddress)}
												>
													<IconCopy />
												</button>
											</div>
											<div className="ref-browser-capture-device-field">
												<span>{t('app.browserCaptureProxyPort')}</span>
												<code>{captureProxyPort}</code>
												<button
													type="button"
													className="ref-browser-copy-icon-btn"
													aria-label={t('app.browserCaptureCopyProxyPort')}
													title={t('app.browserCaptureCopyProxyPort')}
													onClick={() => void copyCaptureText('proxyPort', String(captureProxyPort))}
												>
													<IconCopy />
												</button>
											</div>
											<div className="ref-browser-capture-device-field ref-browser-capture-device-field--wide">
												<span>{t('app.browserCaptureProxyCaUrl')}</span>
												<code title={captureProxyCaUrl}>{captureProxyCaUrl}</code>
												<button
													type="button"
													className="ref-browser-copy-icon-btn"
													aria-label={t('app.browserCaptureCopyProxyCaUrl')}
													title={t('app.browserCaptureCopyProxyCaUrl')}
													onClick={() => void copyCaptureText('proxyCaUrl', captureProxyCaUrl)}
												>
													<IconCopy />
												</button>
											</div>
										</div>
									</div>
									<div className="ref-browser-capture-device-steps">
										<div className="ref-browser-capture-device-step">
											<span>1</span>
											<p>{t('app.browserCaptureDeviceStepWifi')}</p>
										</div>
										<div className="ref-browser-capture-device-step">
											<span>2</span>
											<p>{t('app.browserCaptureDeviceStepProxy')}</p>
										</div>
										<div className="ref-browser-capture-device-step">
											<span>3</span>
											<p>{t('app.browserCaptureDeviceStepCa')}</p>
										</div>
										<div className="ref-browser-capture-device-step">
											<span>4</span>
											<p>{t('app.browserCaptureDeviceStepCapture')}</p>
										</div>
										<div className="ref-browser-capture-device-note">
											{t('app.browserCaptureDeviceLimit')}
										</div>
									</div>
								</div>
								)}
							</div>
							</>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
});

export const AgentBrowserWindowSurface = memo(function AgentBrowserWindowSurface() {
	const { shell } = useAppShellChromeCore();
	const [pendingBrowserCommands, setPendingBrowserCommands] = useState<BrowserControlPayload[]>([]);

	const openBrowserSettingsInHost = useCallback(() => {
		void shell?.invoke('app:requestOpenSettings', { nav: 'browser' }).catch(() => {
			/* ignore */
		});
	}, [shell]);

	useEffect(() => {
		hideBootSplash();
	}, []);

	const closeWindow = useCallback(() => {
		void shell?.invoke('app:windowClose').catch(() => {
			/* ignore */
		});
	}, [shell]);

	useEffect(() => {
		const subscribe = shell?.subscribeBrowserControl;
		if (!subscribe) {
			return;
		}
		const unsubscribe = subscribe((payload) => {
			if (!isBrowserControlPayload(payload)) {
				return;
			}
			if (payload.type === 'closeSidebar') {
				closeWindow();
				return;
			}
			setPendingBrowserCommands((prev) => [...prev, payload]);
		});
		return () => {
			unsubscribe?.();
		};
	}, [closeWindow, shell]);

	useEffect(() => {
		if (!shell) {
			return;
		}
		void shell.invoke('browser:windowReady').catch(() => {
			/* ignore */
		});
	}, [shell]);

	const handleBrowserCommandHandled = useCallback((commandId: string) => {
		setPendingBrowserCommands((prev) => prev.filter((command) => command.commandId !== commandId));
	}, []);

	return (
		<div className="ref-browser-window-root">
			<AgentRightSidebarBrowserPanel
				hasAgentPlanSidebarContent={false}
				closeSidebar={closeWindow}
				openView={() => {}}
				onOpenBrowserSettings={openBrowserSettingsInHost}
				pendingCommand={pendingBrowserCommands[0] ?? null}
				onCommandHandled={handleBrowserCommandHandled}
				variant="window"
			/>
		</div>
	);
});
