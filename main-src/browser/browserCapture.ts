import { webContents, type WebContents } from 'electron';

const MAX_CAPTURE_TEXT_CHARS = 200_000;
const MAX_CAPTURED_REQUESTS = 500;
const ATTACH_RETRY_MS = 3_000;
const DETACH_RETRY_MS = 1_000;
const BINARY_CONTENT_TYPE_PREFIXES = [
	'image/',
	'audio/',
	'video/',
	'font/',
	'application/octet-stream',
	'application/pdf',
	'application/zip',
	'application/x-protobuf',
];

export type BrowserCaptureTabState = {
	tabId: string;
	webContentsId: number;
	attached: boolean;
	pendingRequestCount: number;
	lastError: string | null;
};

export type BrowserCaptureState = {
	capturing: boolean;
	startedAt: number | null;
	requestCount: number;
	pendingRequestCount: number;
	hookEventCount: number;
	storageHostCount: number;
	updatedAt: number | null;
	tabs: BrowserCaptureTabState[];
	note?: string;
};

export type BrowserCaptureHookEvent = {
	id: string;
	seq: number;
	tabId: string | null;
	ts: number;
	url: string;
	category: string;
	label: string;
	args: string;
	result: string | null;
	stack: string;
};

export type BrowserCaptureHookListResult = {
	total: number;
	offset: number;
	limit: number;
	items: BrowserCaptureHookEvent[];
};

export type BrowserCaptureAnalysisRecord = {
	id: string;
	threadId: string;
	mode: string;
	title: string;
	sourceUrl: string;
	createdAt: number;
};

export type BrowserCaptureStorageEntry = {
	key: string;
	value: string;
};

export type BrowserCaptureStorageSnapshot = {
	id: string;
	tabId: string | null;
	host: string;
	url: string;
	ts: number;
	cookies: string;
	localStorage: BrowserCaptureStorageEntry[];
	sessionStorage: BrowserCaptureStorageEntry[];
};

export type BrowserCaptureSource = 'browser' | 'proxy';

export type BrowserCaptureRequestSummary = {
	id: string;
	seq: number;
	tabId: string;
	source: BrowserCaptureSource;
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

export type BrowserCaptureRequestDetail = BrowserCaptureRequestSummary & {
	requestHeaders: Record<string, string>;
	requestBody: string | null;
	responseHeaders: Record<string, string>;
	responseBody: string | null;
};

export type BrowserCaptureListResult = {
	total: number;
	offset: number;
	limit: number;
	items: BrowserCaptureRequestSummary[];
};

export type BrowserCaptureRequestQuery = {
	query?: string;
	tabId?: string;
	source?: BrowserCaptureSource | 'all';
	method?: string;
	resourceType?: string;
	status?: number | null;
	statusGroup?: string;
	requestIds?: string[];
	offset?: number;
	limit?: number;
};

export type BrowserCaptureExternalRequestInput = {
	method: string;
	url: string;
	status?: number | null;
	requestHeaders?: Record<string, unknown>;
	requestBody?: string | Buffer | null;
	requestBodyTruncated?: boolean;
	responseHeaders?: Record<string, unknown>;
	responseBody?: string | Buffer | null;
	responseBodyTruncated?: boolean;
	responseBodyOmittedReason?: string | null;
	resourceType?: string | null;
	startedAt?: number;
	durationMs?: number | null;
	errorText?: string | null;
};

type BrowserCaptureGuestBinding = {
	tabId: string;
	webContentsId: number;
};

type PendingRequestInfo = {
	tabId: string;
	method: string;
	url: string;
	resourceType: string | null;
	startedAt: number;
	requestHeaders: Record<string, string>;
	requestBody: string | null;
	requestBodyTruncated: boolean;
	status: number | null;
	responseHeaders: Record<string, string>;
	responseContentType: string | null;
	errorText: string | null;
};

type BrowserCaptureRecord = BrowserCaptureRequestDetail;

type BrowserCaptureAttachment = {
	hostId: number;
	tabId: string;
	guestId: number;
	contents: WebContents;
	pendingByRequestId: Map<string, PendingRequestInfo>;
	messageHandler: (event: Electron.Event, method: string, params: Record<string, unknown>) => void;
	detachHandler: (event: Electron.Event, reason: string) => void;
};

type BrowserCaptureSession = {
	hostId: number;
	capturing: boolean;
	startedAt: number | null;
	nextSeq: number;
	requests: BrowserCaptureRecord[];
	bindingsByTabId: Map<string, number>;
	attachmentsByGuestId: Map<number, BrowserCaptureAttachment>;
	bindingErrorsByTabId: Map<string, string>;
	retryAfterByGuestId: Map<number, number>;
	updatedAt: number | null;
	hookEvents: BrowserCaptureHookEvent[];
	nextHookSeq: number;
	storageByHost: Map<string, BrowserCaptureStorageSnapshot>;
	recentAnalyses: BrowserCaptureAnalysisRecord[];
};

const sessionsByHostId = new Map<number, BrowserCaptureSession>();

function isHttpRequestUrl(raw: unknown): raw is string {
	if (typeof raw !== 'string') {
		return false;
	}
	return raw.startsWith('http://') || raw.startsWith('https://');
}

function clipCaptureText(raw: unknown): { text: string | null; truncated: boolean } {
	if (raw == null) {
		return { text: null, truncated: false };
	}
	const text = String(raw);
	if (text.length <= MAX_CAPTURE_TEXT_CHARS) {
		return { text, truncated: false };
	}
	return {
		text: `${text.slice(0, MAX_CAPTURE_TEXT_CHARS)}\n[TRUNCATED]`,
		truncated: true,
	};
}

function normalizeHeaderValue(raw: unknown): string {
	if (raw == null) {
		return '';
	}
	if (typeof raw === 'string') {
		return raw;
	}
	if (typeof raw === 'number' || typeof raw === 'boolean') {
		return String(raw);
	}
	if (Array.isArray(raw)) {
		return raw.map((item) => normalizeHeaderValue(item)).join(', ');
	}
	try {
		return JSON.stringify(raw);
	} catch {
		return String(raw);
	}
}

function normalizeHeaders(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== 'object') {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const name = String(key ?? '').trim();
		if (!name) {
			continue;
		}
		out[name] = normalizeHeaderValue(value);
	}
	return out;
}

function contentTypeFromHeaders(headers: Record<string, string>): string | null {
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === 'content-type') {
			const trimmed = String(value ?? '').trim();
			return trimmed || null;
		}
	}
	return null;
}

function isBinaryContentType(contentType: string | null): boolean {
	if (!contentType) {
		return false;
	}
	const lower = contentType.toLowerCase();
	return BINARY_CONTENT_TYPE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function decodeResponseBody(
	body: string,
	base64Encoded: boolean,
	contentType: string | null
): { text: string | null; truncated: boolean; omittedReason: string | null } {
	if (isBinaryContentType(contentType)) {
		return { text: null, truncated: false, omittedReason: 'binary-content' };
	}
	try {
		const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
		const clipped = clipCaptureText(text);
		return {
			text: clipped.text,
			truncated: clipped.truncated,
			omittedReason: null,
		};
	} catch {
		return { text: null, truncated: false, omittedReason: 'decode-failed' };
	}
}

function decodeExternalCaptureBody(
	body: string | Buffer | null | undefined,
	contentType: string | null
): { text: string | null; truncated: boolean; omittedReason: string | null } {
	if (body == null) {
		return { text: null, truncated: false, omittedReason: null };
	}
	if (isBinaryContentType(contentType)) {
		return { text: null, truncated: false, omittedReason: 'binary-content' };
	}
	try {
		const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
		const clipped = clipCaptureText(text);
		return {
			text: clipped.text,
			truncated: clipped.truncated,
			omittedReason: null,
		};
	} catch {
		return { text: null, truncated: false, omittedReason: 'decode-failed' };
	}
}

function makeDefaultCaptureState(note?: string): BrowserCaptureState {
	return {
		capturing: false,
		startedAt: null,
		requestCount: 0,
		pendingRequestCount: 0,
		hookEventCount: 0,
		storageHostCount: 0,
		updatedAt: null,
		tabs: [],
		...(note ? { note } : {}),
	};
}

function getOrCreateCaptureSession(hostId: number): BrowserCaptureSession {
	const existing = sessionsByHostId.get(hostId);
	if (existing) {
		return existing;
	}
	const created: BrowserCaptureSession = {
		hostId,
		capturing: false,
		startedAt: null,
		nextSeq: 1,
		requests: [],
		bindingsByTabId: new Map(),
		attachmentsByGuestId: new Map(),
		bindingErrorsByTabId: new Map(),
		retryAfterByGuestId: new Map(),
		updatedAt: null,
		hookEvents: [],
		nextHookSeq: 1,
		storageByHost: new Map(),
		recentAnalyses: [],
	};
	sessionsByHostId.set(hostId, created);
	return created;
}

function touchCaptureSession(session: BrowserCaptureSession): void {
	session.updatedAt = Date.now();
}

function cloneCaptureSummary(record: BrowserCaptureRecord): BrowserCaptureRequestSummary {
	return {
		id: record.id,
		seq: record.seq,
		tabId: record.tabId,
		source: record.source ?? 'browser',
		method: record.method,
		url: record.url,
		status: record.status,
		contentType: record.contentType,
		resourceType: record.resourceType,
		startedAt: record.startedAt,
		durationMs: record.durationMs,
		hasRequestBody: Boolean(record.requestBody),
		requestBodyTruncated: record.requestBodyTruncated,
		hasResponseBody: Boolean(record.responseBody),
		responseBodyTruncated: record.responseBodyTruncated,
		responseBodyOmittedReason: record.responseBodyOmittedReason,
		errorText: record.errorText,
	};
}

function cloneCaptureDetail(record: BrowserCaptureRecord): BrowserCaptureRequestDetail {
	return {
		...cloneCaptureSummary(record),
		requestHeaders: { ...record.requestHeaders },
		requestBody: record.requestBody,
		responseHeaders: { ...record.responseHeaders },
		responseBody: record.responseBody,
	};
}

export function matchesBrowserCaptureStatusGroup(
	status: number | null,
	errorText: string | null,
	statusGroup: string
): boolean {
	const group = String(statusGroup ?? '').trim().toLowerCase();
	if (!group) {
		return true;
	}
	const bucket = status == null ? 'pending' : `${Math.floor(status / 100)}xx`;
	if (group === 'error') {
		return Boolean(errorText) || (status != null && status >= 400);
	}
	return group === bucket;
}

export function filterBrowserCaptureRequestDetails(
	records: readonly BrowserCaptureRequestDetail[],
	options?: BrowserCaptureRequestQuery
): BrowserCaptureRequestDetail[] {
	const query = String(options?.query ?? '').trim().toLowerCase();
	const tabId = String(options?.tabId ?? '').trim();
	const source = String(options?.source ?? '').trim().toLowerCase();
	const method = String(options?.method ?? '').trim().toUpperCase();
	const resourceType = String(options?.resourceType ?? '').trim().toLowerCase();
	const statusFilter =
		options?.status == null ? null : Number.isFinite(Number(options.status)) ? Number(options.status) : null;
	const statusGroup = String(options?.statusGroup ?? '').trim().toLowerCase();
	const requestIdSet =
		Array.isArray(options?.requestIds) && options.requestIds.length > 0
			? new Set(options.requestIds.map((id) => String(id ?? '').trim()).filter(Boolean))
			: null;
	return records.filter((record) => {
		if (requestIdSet && !requestIdSet.has(record.id)) {
			return false;
		}
		if (tabId && record.tabId !== tabId) {
			return false;
		}
		if (source && source !== 'all' && record.source !== source) {
			return false;
		}
		if (method) {
			const recordMethod = record.method.trim().toUpperCase();
			if (method === 'OTHER') {
				if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(recordMethod)) {
					return false;
				}
			} else if (recordMethod !== method) {
				return false;
			}
		}
		if (resourceType) {
			const recordResourceType = String(record.resourceType ?? '').trim().toLowerCase();
			if (resourceType === 'other') {
				if (['document', 'xhr', 'fetch', 'script', 'stylesheet', 'image'].includes(recordResourceType)) {
					return false;
				}
			} else if (recordResourceType !== resourceType) {
				return false;
			}
		}
		if (statusFilter != null && record.status !== statusFilter) {
			return false;
		}
		if (statusGroup && !matchesBrowserCaptureStatusGroup(record.status, record.errorText, statusGroup)) {
			return false;
		}
		if (!query) {
			return true;
		}
		const haystack = [
			record.tabId,
			record.source ?? 'browser',
			record.method,
			record.url,
			record.contentType ?? '',
			record.resourceType ?? '',
			record.status == null ? '' : String(record.status),
			record.errorText ?? '',
		]
			.join(' ')
			.toLowerCase();
		return haystack.includes(query);
	});
}

function filterBrowserCaptureRecords(
	session: BrowserCaptureSession,
	options?: BrowserCaptureRequestQuery
): BrowserCaptureRecord[] {
	return filterBrowserCaptureRequestDetails(session.requests, options);
}

function buildCaptureState(session: BrowserCaptureSession): BrowserCaptureState {
	const tabs: BrowserCaptureTabState[] = Array.from(session.bindingsByTabId.entries())
		.map(([tabId, guestId]) => {
			const attachment = session.attachmentsByGuestId.get(guestId);
			return {
				tabId,
				webContentsId: guestId,
				attached: Boolean(attachment),
				pendingRequestCount: attachment?.pendingByRequestId.size ?? 0,
				lastError: session.bindingErrorsByTabId.get(tabId) ?? null,
			};
		})
		.sort((a, b) => a.tabId.localeCompare(b.tabId));
	const pendingRequestCount = tabs.reduce((sum, tab) => sum + tab.pendingRequestCount, 0);
	let note: string | undefined;
	if (session.capturing && tabs.length === 0) {
		note = 'Capture is armed, but no live built-in browser tabs are registered yet.';
	} else if (!session.capturing && session.requests.length > 0) {
		note = 'Capture is stopped. Stored requests remain available until cleared.';
	}
	return {
		capturing: session.capturing,
		startedAt: session.startedAt,
		requestCount: session.requests.length,
		pendingRequestCount,
		hookEventCount: session.hookEvents.length,
		storageHostCount: session.storageByHost.size,
		updatedAt: session.updatedAt,
		tabs,
		...(note ? { note } : {}),
	};
}

export function extractBrowserCaptureGuestBindingsFromState(rawState: unknown): BrowserCaptureGuestBinding[] {
	const obj = rawState && typeof rawState === 'object' ? (rawState as Record<string, unknown>) : {};
	const rawBindings = Array.isArray(obj.guestBindings) ? obj.guestBindings : [];
	const seenTabIds = new Set<string>();
	const seenGuestIds = new Set<number>();
	const out: BrowserCaptureGuestBinding[] = [];
	for (const raw of rawBindings) {
		if (!raw || typeof raw !== 'object') {
			continue;
		}
		const item = raw as Record<string, unknown>;
		const tabId = String(item.tabId ?? '').trim();
		const webContentsId = Number(item.webContentsId);
		if (!tabId || !Number.isInteger(webContentsId) || webContentsId <= 0) {
			continue;
		}
		if (seenTabIds.has(tabId) || seenGuestIds.has(webContentsId)) {
			continue;
		}
		seenTabIds.add(tabId);
		seenGuestIds.add(webContentsId);
		out.push({ tabId, webContentsId });
	}
	return out;
}

function dropAllPendingRequests(session: BrowserCaptureSession): void {
	for (const attachment of session.attachmentsByGuestId.values()) {
		attachment.pendingByRequestId.clear();
	}
}

function pushCaptureRecord(session: BrowserCaptureSession, record: BrowserCaptureRecord): void {
	session.requests.push(record);
	if (session.requests.length > MAX_CAPTURED_REQUESTS) {
		session.requests.splice(0, session.requests.length - MAX_CAPTURED_REQUESTS);
	}
	touchCaptureSession(session);
}

function finalizePendingRequest(
	session: BrowserCaptureSession,
	pending: PendingRequestInfo,
	result?: { responseBody?: string | null; responseBodyTruncated?: boolean; responseBodyOmittedReason?: string | null }
): void {
	const seq = session.nextSeq;
	session.nextSeq += 1;
	const record: BrowserCaptureRecord = {
		id: `browser-capture-${session.hostId}-${seq}`,
		seq,
		tabId: pending.tabId,
		source: 'browser',
		method: pending.method,
		url: pending.url,
		status: pending.status,
		contentType: pending.responseContentType,
		resourceType: pending.resourceType,
		startedAt: pending.startedAt,
		durationMs: Math.max(0, Date.now() - pending.startedAt),
		hasRequestBody: Boolean(pending.requestBody),
		requestBodyTruncated: pending.requestBodyTruncated,
		hasResponseBody: Boolean(result?.responseBody),
		responseBodyTruncated: result?.responseBodyTruncated === true,
		responseBodyOmittedReason: result?.responseBodyOmittedReason ?? null,
		errorText: pending.errorText,
		requestHeaders: { ...pending.requestHeaders },
		requestBody: pending.requestBody,
		responseHeaders: { ...pending.responseHeaders },
		responseBody: result?.responseBody ?? null,
	};
	pushCaptureRecord(session, record);
}

function releaseCaptureAttachment(
	session: BrowserCaptureSession,
	attachment: BrowserCaptureAttachment,
	options?: { lastError?: string | null; retryAfterMs?: number }
): void {
	attachment.pendingByRequestId.clear();
	session.attachmentsByGuestId.delete(attachment.guestId);
	try {
		attachment.contents.debugger.removeListener('message', attachment.messageHandler);
		attachment.contents.debugger.removeListener('detach', attachment.detachHandler);
	} catch {
		/* ignore */
	}
	try {
		if (attachment.contents.debugger.isAttached()) {
			attachment.contents.debugger.detach();
		}
	} catch {
		/* ignore */
	}
	if (session.bindingsByTabId.get(attachment.tabId) === attachment.guestId) {
		if (options?.lastError) {
			session.bindingErrorsByTabId.set(attachment.tabId, options.lastError);
		} else {
			session.bindingErrorsByTabId.delete(attachment.tabId);
		}
	}
	if (options?.retryAfterMs && options.retryAfterMs > 0) {
		session.retryAfterByGuestId.set(attachment.guestId, Date.now() + options.retryAfterMs);
	} else {
		session.retryAfterByGuestId.delete(attachment.guestId);
	}
	touchCaptureSession(session);
}

async function readResponseBody(
	attachment: BrowserCaptureAttachment,
	requestId: string,
	contentType: string | null
): Promise<{ responseBody: string | null; responseBodyTruncated: boolean; responseBodyOmittedReason: string | null }> {
	if (!attachment.contents || attachment.contents.isDestroyed() || !attachment.contents.debugger.isAttached()) {
		return {
			responseBody: null,
			responseBodyTruncated: false,
			responseBodyOmittedReason: 'browser-tab-unavailable',
		};
	}
	if (isBinaryContentType(contentType)) {
		return {
			responseBody: null,
			responseBodyTruncated: false,
			responseBodyOmittedReason: 'binary-content',
		};
	}
	try {
		const result = (await attachment.contents.debugger.sendCommand('Network.getResponseBody', {
			requestId,
		})) as {
			body?: string;
			base64Encoded?: boolean;
		};
		const decoded = decodeResponseBody(
			String(result.body ?? ''),
			result.base64Encoded === true,
			contentType
		);
		return {
			responseBody: decoded.text,
			responseBodyTruncated: decoded.truncated,
			responseBodyOmittedReason: decoded.omittedReason,
		};
	} catch {
		return {
			responseBody: null,
			responseBodyTruncated: false,
			responseBodyOmittedReason: 'unavailable',
		};
	}
}

function applyResponseToPending(pending: PendingRequestInfo, responseRaw: unknown): void {
	const response = responseRaw && typeof responseRaw === 'object' ? (responseRaw as Record<string, unknown>) : {};
	pending.status = Number(response.status ?? 0) || null;
	pending.responseHeaders = normalizeHeaders(response.headers);
	pending.responseContentType =
		typeof response.mimeType === 'string' && response.mimeType.trim()
			? response.mimeType.trim()
			: contentTypeFromHeaders(pending.responseHeaders);
}

function seedPendingRequest(
	tabId: string,
	requestRaw: unknown,
	resourceTypeRaw: unknown
): PendingRequestInfo | null {
	const request = requestRaw && typeof requestRaw === 'object' ? (requestRaw as Record<string, unknown>) : null;
	const url = request?.url;
	if (!request || !isHttpRequestUrl(url)) {
		return null;
	}
	const requestBody = clipCaptureText(request.postData);
	return {
		tabId,
		method: String(request.method ?? 'GET').trim() || 'GET',
		url,
		resourceType: typeof resourceTypeRaw === 'string' && resourceTypeRaw.trim() ? resourceTypeRaw.trim() : null,
		startedAt: Date.now(),
		requestHeaders: normalizeHeaders(request.headers),
		requestBody: requestBody.text,
		requestBodyTruncated: requestBody.truncated,
		status: null,
		responseHeaders: {},
		responseContentType: null,
		errorText: null,
	};
}

async function handleCaptureDebuggerMessage(
	session: BrowserCaptureSession,
	attachment: BrowserCaptureAttachment,
	method: string,
	params: Record<string, unknown>
): Promise<void> {
	if (!session.attachmentsByGuestId.has(attachment.guestId)) {
		return;
	}
	if (method === 'Network.requestWillBeSent') {
		const requestId = String(params.requestId ?? '').trim();
		if (!requestId) {
			return;
		}
		const existing = attachment.pendingByRequestId.get(requestId);
		if (existing && params.redirectResponse) {
			applyResponseToPending(existing, params.redirectResponse);
			finalizePendingRequest(session, existing, {
				responseBody: null,
				responseBodyTruncated: false,
				responseBodyOmittedReason: 'redirect',
			});
			attachment.pendingByRequestId.delete(requestId);
		}
		const seeded = seedPendingRequest(attachment.tabId, params.request, params.type);
		if (!seeded) {
			return;
		}
		attachment.pendingByRequestId.set(requestId, seeded);
		touchCaptureSession(session);
		return;
	}
	if (method === 'Network.responseReceived') {
		const requestId = String(params.requestId ?? '').trim();
		if (!requestId) {
			return;
		}
		let pending = attachment.pendingByRequestId.get(requestId);
		if (!pending) {
			const seeded = seedPendingRequest(attachment.tabId, params.response, params.type);
			if (!seeded) {
				return;
			}
			pending = seeded;
			attachment.pendingByRequestId.set(requestId, pending);
		}
		applyResponseToPending(pending, params.response);
		return;
	}
	if (method === 'Network.loadingFinished') {
		const requestId = String(params.requestId ?? '').trim();
		if (!requestId) {
			return;
		}
		const pending = attachment.pendingByRequestId.get(requestId);
		if (!pending) {
			return;
		}
		attachment.pendingByRequestId.delete(requestId);
		const body = await readResponseBody(attachment, requestId, pending.responseContentType);
		finalizePendingRequest(session, pending, body);
		return;
	}
	if (method === 'Network.loadingFailed') {
		const requestId = String(params.requestId ?? '').trim();
		if (!requestId) {
			return;
		}
		const pending = attachment.pendingByRequestId.get(requestId);
		if (!pending) {
			return;
		}
		attachment.pendingByRequestId.delete(requestId);
		pending.errorText = String(params.errorText ?? 'Request failed');
		finalizePendingRequest(session, pending, {
			responseBody: null,
			responseBodyTruncated: false,
			responseBodyOmittedReason: 'request-failed',
		});
	}
}

async function attachCaptureToGuest(
	session: BrowserCaptureSession,
	tabId: string,
	guestId: number
): Promise<void> {
	const retryAfter = session.retryAfterByGuestId.get(guestId) ?? 0;
	if (retryAfter > Date.now()) {
		return;
	}
	const contents = webContents.fromId(guestId);
	if (!contents || contents.isDestroyed()) {
		session.bindingErrorsByTabId.set(tabId, 'Browser tab is not ready for capture yet.');
		session.retryAfterByGuestId.set(guestId, Date.now() + DETACH_RETRY_MS);
		touchCaptureSession(session);
		return;
	}
	if (contents.debugger.isAttached()) {
		session.bindingErrorsByTabId.set(tabId, 'Debugger is already attached to this browser tab.');
		session.retryAfterByGuestId.set(guestId, Date.now() + ATTACH_RETRY_MS);
		touchCaptureSession(session);
		return;
	}
	try {
		contents.debugger.attach('1.3');
	} catch (error) {
		session.bindingErrorsByTabId.set(
			tabId,
			error instanceof Error ? error.message : String(error)
		);
		session.retryAfterByGuestId.set(guestId, Date.now() + ATTACH_RETRY_MS);
		touchCaptureSession(session);
		return;
	}
	const attachment: BrowserCaptureAttachment = {
		hostId: session.hostId,
		tabId,
		guestId,
		contents,
		pendingByRequestId: new Map(),
		messageHandler: (_event, method, params) => {
			void handleCaptureDebuggerMessage(session, attachment, method, params as Record<string, unknown>);
		},
		detachHandler: (_event, reason) => {
			if (!session.attachmentsByGuestId.has(guestId)) {
				return;
			}
			releaseCaptureAttachment(session, attachment, {
				lastError: `Capture detached: ${String(reason ?? 'unknown')}`,
				retryAfterMs: session.capturing ? DETACH_RETRY_MS : 0,
			});
			if (session.capturing) {
				void reconcileCaptureAttachmentsForHostId(session.hostId);
			}
		},
	};
	contents.debugger.on('message', attachment.messageHandler);
	contents.debugger.on('detach', attachment.detachHandler);
	try {
		await contents.debugger.sendCommand('Network.enable', {});
		session.attachmentsByGuestId.set(guestId, attachment);
		session.bindingErrorsByTabId.delete(tabId);
		session.retryAfterByGuestId.delete(guestId);
		touchCaptureSession(session);
	} catch (error) {
		releaseCaptureAttachment(session, attachment);
		session.bindingErrorsByTabId.set(
			tabId,
			error instanceof Error ? error.message : String(error)
		);
		session.retryAfterByGuestId.set(guestId, Date.now() + ATTACH_RETRY_MS);
		touchCaptureSession(session);
	}
}

async function reconcileCaptureAttachmentsForHostId(hostId: number): Promise<void> {
	const session = sessionsByHostId.get(hostId);
	if (!session) {
		return;
	}
	for (const attachment of Array.from(session.attachmentsByGuestId.values())) {
		const boundGuestId = session.bindingsByTabId.get(attachment.tabId);
		if (boundGuestId !== attachment.guestId) {
			releaseCaptureAttachment(session, attachment);
		}
	}
	if (!session.capturing) {
		return;
	}
	for (const [tabId, guestId] of session.bindingsByTabId.entries()) {
		const existing = session.attachmentsByGuestId.get(guestId);
		if (existing && existing.tabId === tabId) {
			continue;
		}
		await attachCaptureToGuest(session, tabId, guestId);
	}
}

export function syncBrowserCaptureBindingsForHostId(hostId: number, rawState: unknown): void {
	const session = getOrCreateCaptureSession(hostId);
	const bindings = extractBrowserCaptureGuestBindingsFromState(rawState);
	const nextBindings = new Map<string, number>();
	for (const binding of bindings) {
		nextBindings.set(binding.tabId, binding.webContentsId);
	}
	session.bindingsByTabId = nextBindings;
	for (const tabId of Array.from(session.bindingErrorsByTabId.keys())) {
		if (!nextBindings.has(tabId)) {
			session.bindingErrorsByTabId.delete(tabId);
		}
	}
	for (const guestId of Array.from(session.retryAfterByGuestId.keys())) {
		if (!bindings.some((binding) => binding.webContentsId === guestId)) {
			session.retryAfterByGuestId.delete(guestId);
		}
	}
	touchCaptureSession(session);
	void reconcileCaptureAttachmentsForHostId(hostId);
}

export function getBrowserCaptureStateForHostId(hostId: number): BrowserCaptureState {
	const session = sessionsByHostId.get(hostId);
	if (!session) {
		return makeDefaultCaptureState('No browser capture session has been started yet.');
	}
	return buildCaptureState(session);
}

export async function startBrowserCaptureForHostId(
	hostId: number,
	options?: { clear?: boolean }
): Promise<BrowserCaptureState> {
	const session = getOrCreateCaptureSession(hostId);
	if (options?.clear !== false) {
		session.requests = [];
		session.nextSeq = 1;
		dropAllPendingRequests(session);
	}
	session.capturing = true;
	session.startedAt = Date.now();
	touchCaptureSession(session);
	await reconcileCaptureAttachmentsForHostId(hostId);
	return buildCaptureState(session);
}

export async function stopBrowserCaptureForHostId(hostId: number): Promise<BrowserCaptureState> {
	const session = sessionsByHostId.get(hostId);
	if (!session) {
		return makeDefaultCaptureState('No browser capture session has been started yet.');
	}
	session.capturing = false;
	session.startedAt = null;
	for (const attachment of Array.from(session.attachmentsByGuestId.values())) {
		releaseCaptureAttachment(session, attachment);
	}
	touchCaptureSession(session);
	return buildCaptureState(session);
}

export function clearBrowserCaptureDataForHostId(hostId: number): BrowserCaptureState {
	const session = sessionsByHostId.get(hostId);
	if (!session) {
		return makeDefaultCaptureState('No browser capture session has been started yet.');
	}
	session.requests = [];
	session.nextSeq = 1;
	session.hookEvents = [];
	session.nextHookSeq = 1;
	session.storageByHost.clear();
	dropAllPendingRequests(session);
	touchCaptureSession(session);
	return buildCaptureState(session);
}

const HOOK_EVENT_CAP = 800;

export function appendBrowserCaptureHookEventsForHostId(
	hostId: number,
	tabId: string | null,
	rawEvents: unknown
): number {
	if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
		return 0;
	}
	const session = sessionsByHostId.get(hostId);
	if (!session?.capturing) {
		return 0;
	}
	let appended = 0;
	for (const raw of rawEvents) {
		if (!raw || typeof raw !== 'object') continue;
		const obj = raw as Record<string, unknown>;
		const category = typeof obj.category === 'string' ? obj.category : 'unknown';
		const label = typeof obj.label === 'string' ? obj.label : 'event';
		const argsStr = typeof obj.args === 'string' ? obj.args : safeJsonStringify(obj.args);
		const resultStr =
			obj.result === null || obj.result === undefined
				? null
				: typeof obj.result === 'string'
					? obj.result
					: safeJsonStringify(obj.result);
		const tsRaw = Number(obj.ts);
		const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? Math.floor(tsRaw) : Date.now();
		const url = typeof obj.url === 'string' ? obj.url : '';
		const stack = typeof obj.stack === 'string' ? obj.stack : '';
		const seq = session.nextHookSeq++;
		session.hookEvents.push({
			id: `hook-${seq}`,
			seq,
			tabId: tabId ?? null,
			ts,
			url,
			category,
			label,
			args: argsStr,
			result: resultStr,
			stack,
		});
		appended += 1;
	}
	if (session.hookEvents.length > HOOK_EVENT_CAP) {
		session.hookEvents.splice(0, session.hookEvents.length - HOOK_EVENT_CAP);
	}
	if (appended > 0) {
		touchCaptureSession(session);
	}
	return appended;
}

function safeJsonStringify(value: unknown): string {
	try {
		const out = JSON.stringify(value);
		return typeof out === 'string' ? out : '';
	} catch {
		return '';
	}
}

export function listBrowserCaptureHookEventsForHostId(
	hostId: number,
	options?: { offset?: number; limit?: number; category?: string; tabId?: string; query?: string }
): BrowserCaptureHookListResult {
	const session = sessionsByHostId.get(hostId);
	if (!session) {
		return { total: 0, offset: 0, limit: 0, items: [] };
	}
	const category = options?.category && options.category !== 'all' ? options.category : null;
	const tabId = options?.tabId && options.tabId !== 'all' ? options.tabId : null;
	const query = options?.query?.toLowerCase() ?? '';
	const filtered = session.hookEvents.filter((event) => {
		if (category && !event.category.startsWith(category)) {
			return false;
		}
		if (tabId && event.tabId !== tabId) {
			return false;
		}
		if (query) {
			if (
				!event.label.toLowerCase().includes(query) &&
				!event.url.toLowerCase().includes(query) &&
				!(event.args || '').toLowerCase().includes(query)
			) {
				return false;
			}
		}
		return true;
	});
	const offset = Math.max(0, options?.offset ?? 0);
	const limit = Math.max(1, Math.min(500, options?.limit ?? 200));
	const slice = filtered.slice(offset, offset + limit);
	return {
		total: filtered.length,
		offset,
		limit,
		items: slice,
	};
}

const MAX_STORAGE_HOSTS = 64;
const MAX_STORAGE_BYTES = 256 * 1024;

function clipForStorage(text: string): string {
	if (!text) return '';
	if (text.length <= MAX_STORAGE_BYTES) return text;
	return text.slice(0, MAX_STORAGE_BYTES) + '…';
}

export function ingestBrowserCaptureStorageSnapshot(
	hostId: number,
	tabId: string | null,
	snapshot: {
		host?: unknown;
		url?: unknown;
		ts?: unknown;
		cookies?: unknown;
		localStorage?: unknown;
		sessionStorage?: unknown;
	}
): void {
	const session = sessionsByHostId.get(hostId);
	if (!session?.capturing) {
		return;
	}
	const host =
		typeof snapshot.host === 'string' && snapshot.host
			? snapshot.host
			: typeof snapshot.url === 'string'
				? safeHostnameFromUrl(snapshot.url)
				: '';
	if (!host || host === 'about:' || host === 'unknown') {
		return;
	}
	const url = typeof snapshot.url === 'string' ? snapshot.url : '';
	const tsRaw = Number(snapshot.ts);
	const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? Math.floor(tsRaw) : Date.now();
	const cookies = typeof snapshot.cookies === 'string' ? clipForStorage(snapshot.cookies) : '';
	const localEntries = normalizeStorageEntries(snapshot.localStorage);
	const sessionEntries = normalizeStorageEntries(snapshot.sessionStorage);
	const id = `storage:${host}`;
	session.storageByHost.set(id, {
		id,
		tabId: tabId ?? null,
		host,
		url,
		ts,
		cookies,
		localStorage: localEntries,
		sessionStorage: sessionEntries,
	});
	if (session.storageByHost.size > MAX_STORAGE_HOSTS) {
		const oldestKey = session.storageByHost.keys().next().value;
		if (oldestKey) {
			session.storageByHost.delete(oldestKey);
		}
	}
	touchCaptureSession(session);
}

function normalizeStorageEntries(raw: unknown): BrowserCaptureStorageEntry[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: BrowserCaptureStorageEntry[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;
		const obj = entry as Record<string, unknown>;
		const key = typeof obj.key === 'string' ? obj.key : '';
		const value = typeof obj.value === 'string' ? obj.value : '';
		if (!key) continue;
		out.push({ key, value: clipForStorage(value) });
		if (out.length >= 200) break;
	}
	return out;
}

function safeHostnameFromUrl(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return '';
	}
}

export function listBrowserCaptureStorageSnapshotsForHostId(hostId: number): BrowserCaptureStorageSnapshot[] {
	const session = sessionsByHostId.get(hostId);
	if (!session) {
		return [];
	}
	return Array.from(session.storageByHost.values()).sort((a, b) => a.host.localeCompare(b.host));
}

export function addBrowserCaptureExternalRequestForHostId(
	hostId: number,
	input: BrowserCaptureExternalRequestInput
): BrowserCaptureRequestDetail | null {
	if (!isHttpRequestUrl(input.url)) {
		return null;
	}
	const session = sessionsByHostId.get(hostId);
	if (!session?.capturing) {
		return null;
	}
	const requestHeaders = normalizeHeaders(input.requestHeaders);
	const responseHeaders = normalizeHeaders(input.responseHeaders);
	const requestContentType = contentTypeFromHeaders(requestHeaders);
	const responseContentType = contentTypeFromHeaders(responseHeaders);
	const requestBody = decodeExternalCaptureBody(input.requestBody, requestContentType);
	const responseBody = decodeExternalCaptureBody(input.responseBody, responseContentType);
	const seq = session.nextSeq;
	session.nextSeq += 1;
	const statusRaw = Number(input.status);
	const startedAtRaw = Number(input.startedAt);
	const durationRaw = Number(input.durationMs);
	const record: BrowserCaptureRecord = {
		id: `browser-capture-${session.hostId}-${seq}`,
		seq,
		tabId: 'external-device',
		source: 'proxy',
		method: (input.method || 'GET').trim().toUpperCase(),
		url: input.url,
		status: Number.isFinite(statusRaw) ? statusRaw : null,
		contentType: responseContentType,
		resourceType: input.resourceType?.trim() || 'proxy',
		startedAt: Number.isFinite(startedAtRaw) && startedAtRaw > 0 ? Math.floor(startedAtRaw) : Date.now(),
		durationMs: Number.isFinite(durationRaw) && durationRaw >= 0 ? Math.floor(durationRaw) : null,
		hasRequestBody: Boolean(requestBody.text),
		requestBodyTruncated: requestBody.truncated || input.requestBodyTruncated === true,
		hasResponseBody: Boolean(responseBody.text),
		responseBodyTruncated: responseBody.truncated || input.responseBodyTruncated === true,
		responseBodyOmittedReason: input.responseBodyOmittedReason ?? responseBody.omittedReason,
		errorText: input.errorText?.trim() || null,
		requestHeaders,
		requestBody: requestBody.text,
		responseHeaders,
		responseBody: responseBody.text,
	};
	pushCaptureRecord(session, record);
	return cloneCaptureDetail(record);
}

export function listBrowserCaptureRequestsForHostId(
	hostId: number,
	options?: BrowserCaptureRequestQuery
): BrowserCaptureListResult {
	const session = sessionsByHostId.get(hostId);
	if (!session) {
		return { total: 0, offset: 0, limit: 0, items: [] };
	}
	const filtered = filterBrowserCaptureRecords(session, options);
	const offsetRaw = Number(options?.offset ?? 0);
	const limitRaw = Number(options?.limit ?? 50);
	const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
	const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 50;
	return {
		total: filtered.length,
		offset,
		limit,
		items: filtered.slice(offset, offset + limit).map(cloneCaptureSummary),
	};
}

export function listBrowserCaptureRequestDetailsForHostId(
	hostId: number,
	options?: BrowserCaptureRequestQuery
): BrowserCaptureRequestDetail[] {
	const session = sessionsByHostId.get(hostId);
	if (!session) {
		return [];
	}
	const filtered = filterBrowserCaptureRecords(session, options);
	const offsetRaw = Number(options?.offset ?? 0);
	const limitRaw = Number(options?.limit ?? MAX_CAPTURED_REQUESTS);
	const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
	const limit =
		Number.isFinite(limitRaw) && limitRaw > 0
			? Math.min(MAX_CAPTURED_REQUESTS, Math.floor(limitRaw))
			: MAX_CAPTURED_REQUESTS;
	return filtered.slice(offset, offset + limit).map(cloneCaptureDetail);
}

export function getBrowserCaptureRequestForHostId(
	hostId: number,
	options: { requestId?: string; seq?: number }
): BrowserCaptureRequestDetail | null {
	const session = sessionsByHostId.get(hostId);
	if (!session) {
		return null;
	}
	const requestId = String(options.requestId ?? '').trim();
	if (requestId) {
		const found = session.requests.find((record) => record.id === requestId);
		return found ? cloneCaptureDetail(found) : null;
	}
	const seq = Number(options.seq ?? 0);
	if (Number.isFinite(seq) && seq > 0) {
		const found = session.requests.find((record) => record.seq === seq);
		return found ? cloneCaptureDetail(found) : null;
	}
	return null;
}


/** Snapshot the in-memory capture session for persistence. */
export function snapshotBrowserCaptureSessionForHostId(hostId: number): {
	requests: BrowserCaptureRequestDetail[];
	hookEvents: BrowserCaptureHookEvent[];
	storageSnapshots: BrowserCaptureStorageSnapshot[];
} | null {
	const session = sessionsByHostId.get(hostId);
	if (!session) {
		return null;
	}
	return {
		requests: session.requests.map((record) => cloneCaptureDetail(record)),
		hookEvents: session.hookEvents.map((event) => ({ ...event })),
		storageSnapshots: Array.from(session.storageByHost.values()).map((snapshot) => ({
			...snapshot,
			localStorage: snapshot.localStorage.map((entry) => ({ ...entry })),
			sessionStorage: snapshot.sessionStorage.map((entry) => ({ ...entry })),
		})),
	};
}

/** Replace the in-memory capture session contents with a saved snapshot. */
export function restoreBrowserCaptureSessionForHostId(
	hostId: number,
	payload: {
		requests?: BrowserCaptureRequestDetail[];
		hookEvents?: BrowserCaptureHookEvent[];
		storageSnapshots?: BrowserCaptureStorageSnapshot[];
	}
): BrowserCaptureState {
	const session = getOrCreateCaptureSession(hostId);
	const requests = Array.isArray(payload.requests) ? payload.requests : [];
	const hookEvents = Array.isArray(payload.hookEvents) ? payload.hookEvents : [];
	const storageSnapshots = Array.isArray(payload.storageSnapshots) ? payload.storageSnapshots : [];
	session.requests = requests.map((record) => cloneCaptureDetail(record));
	session.nextSeq = (requests.reduce((max, record) => Math.max(max, record.seq), 0) || 0) + 1;
	session.hookEvents = hookEvents.map((event) => ({ ...event }));
	session.nextHookSeq = (hookEvents.reduce((max, event) => Math.max(max, event.seq), 0) || 0) + 1;
	session.storageByHost.clear();
	for (const snapshot of storageSnapshots) {
		session.storageByHost.set(snapshot.id, {
			...snapshot,
			localStorage: snapshot.localStorage.map((entry) => ({ ...entry })),
			sessionStorage: snapshot.sessionStorage.map((entry) => ({ ...entry })),
		});
	}
	dropAllPendingRequests(session);
	touchCaptureSession(session);
	return buildCaptureState(session);
}


const MAX_RECENT_ANALYSES = 12;

export function recordBrowserCaptureAnalysisForHostId(
	hostId: number,
	record: { threadId: string; mode: string; title: string; sourceUrl?: string }
): BrowserCaptureAnalysisRecord {
	const session = getOrCreateCaptureSession(hostId);
	const entry: BrowserCaptureAnalysisRecord = {
		id: `analysis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
		threadId: record.threadId,
		mode: record.mode,
		title: record.title,
		sourceUrl: record.sourceUrl ?? '',
		createdAt: Date.now(),
	};
	session.recentAnalyses.unshift(entry);
	if (session.recentAnalyses.length > MAX_RECENT_ANALYSES) {
		session.recentAnalyses.length = MAX_RECENT_ANALYSES;
	}
	touchCaptureSession(session);
	return entry;
}

export function listBrowserCaptureAnalysesForHostId(hostId: number): BrowserCaptureAnalysisRecord[] {
	const session = sessionsByHostId.get(hostId);
	return session ? session.recentAnalyses.slice() : [];
}

export function removeBrowserCaptureAnalysisForHostId(hostId: number, analysisId: string): void {
	const session = sessionsByHostId.get(hostId);
	if (!session) return;
	session.recentAnalyses = session.recentAnalyses.filter((entry) => entry.id !== analysisId);
	touchCaptureSession(session);
}
