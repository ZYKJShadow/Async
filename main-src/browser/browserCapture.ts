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
	updatedAt: number | null;
	tabs: BrowserCaptureTabState[];
	note?: string;
};

export type BrowserCaptureRequestSummary = {
	id: string;
	seq: number;
	tabId: string;
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

function makeDefaultCaptureState(note?: string): BrowserCaptureState {
	return {
		capturing: false,
		startedAt: null,
		requestCount: 0,
		pendingRequestCount: 0,
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
	dropAllPendingRequests(session);
	touchCaptureSession(session);
	return buildCaptureState(session);
}

export function listBrowserCaptureRequestsForHostId(
	hostId: number,
	options?: {
		query?: string;
		tabId?: string;
		status?: number | null;
		offset?: number;
		limit?: number;
	}
): BrowserCaptureListResult {
	const session = sessionsByHostId.get(hostId);
	if (!session) {
		return { total: 0, offset: 0, limit: 0, items: [] };
	}
	const query = String(options?.query ?? '').trim().toLowerCase();
	const tabId = String(options?.tabId ?? '').trim();
	const statusFilter =
		options?.status == null ? null : Number.isFinite(Number(options.status)) ? Number(options.status) : null;
	const filtered = session.requests.filter((record) => {
		if (tabId && record.tabId !== tabId) {
			return false;
		}
		if (statusFilter != null && record.status !== statusFilter) {
			return false;
		}
		if (!query) {
			return true;
		}
		const haystack = [
			record.tabId,
			record.method,
			record.url,
			record.contentType ?? '',
			record.status == null ? '' : String(record.status),
			record.errorText ?? '',
		]
			.join(' ')
			.toLowerCase();
		return haystack.includes(query);
	});
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
