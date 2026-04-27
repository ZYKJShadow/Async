/**
 * captureAnalysis — Convert the active browser-capture state into a focused
 * analysis prompt that can be dropped into the Async agent composer.
 *
 * This is the "AI analysis" surface ported from anything-analyzer (scene
 * detector + prompt templates + crypto-script extraction), but instead of
 * running its own LLM it produces a single Markdown brief that the existing
 * agent runtime can consume.
 */

import type {
	BrowserCaptureHookEvent,
	BrowserCaptureRequestDetail,
	BrowserCaptureStorageSnapshot,
} from './browser/browserCapture.js';

export type CaptureAnalysisMode = 'auto' | 'api-reverse' | 'security-audit' | 'performance' | 'crypto-reverse';

export type CaptureAnalysisOptions = {
	mode: CaptureAnalysisMode;
	requestIds?: string[];
	customNote?: string;
	maxRequests?: number;
};

export type CaptureSceneHint = {
	scene: string;
	confidence: 'high' | 'medium' | 'low';
	evidence: string;
	relatedSeq: number[];
};

export type CaptureAnalysisInput = {
	requests: BrowserCaptureRequestDetail[];
	hookEvents: BrowserCaptureHookEvent[];
	storageSnapshots: BrowserCaptureStorageSnapshot[];
};

export type CaptureAnalysisResult = {
	mode: CaptureAnalysisMode;
	scenes: CaptureSceneHint[];
	prompt: string;
	cryptoSnippets: CaptureCryptoSnippet[];
	usedRequestCount: number;
	totalRequestCount: number;
	hookEventCount: number;
	storageHostCount: number;
};

export type CaptureCryptoSnippet = {
	label: string;
	url: string;
	preview: string;
};

const DEFAULT_MAX_REQUESTS = 40;
const REQUEST_BODY_PREVIEW = 1200;
const HEADER_PREVIEW_KEYS = new Set([
	'authorization',
	'cookie',
	'set-cookie',
	'x-signature',
	'x-sign',
	'x-timestamp',
	'x-nonce',
	'x-request-sign',
	'signature',
	'x-api-key',
	'x-csrf-token',
	'content-type',
	'accept',
	'origin',
	'referer',
]);

export function buildCaptureAnalysis(input: CaptureAnalysisInput, options: CaptureAnalysisOptions): CaptureAnalysisResult {
	const { mode } = options;
	const filteredRequests = filterRequestsForAnalysis(input.requests, options);
	const scenes = detectScenes(filteredRequests, input.hookEvents);
	const cryptoSnippets = extractCryptoSnippets(input.hookEvents, input.requests);
	const prompt = renderPrompt({ mode, requests: filteredRequests, scenes, cryptoSnippets, options, fullInput: input });
	return {
		mode,
		scenes,
		prompt,
		cryptoSnippets,
		usedRequestCount: filteredRequests.length,
		totalRequestCount: input.requests.length,
		hookEventCount: input.hookEvents.length,
		storageHostCount: input.storageSnapshots.length,
	};
}

function filterRequestsForAnalysis(
	requests: BrowserCaptureRequestDetail[],
	options: CaptureAnalysisOptions
): BrowserCaptureRequestDetail[] {
	const ids = options.requestIds && options.requestIds.length > 0 ? new Set(options.requestIds) : null;
	const limit = Math.max(1, Math.min(200, options.maxRequests ?? DEFAULT_MAX_REQUESTS));
	const candidates = ids ? requests.filter((r) => ids.has(r.id)) : prioritizeRequests(requests, options.mode);
	return candidates.slice(0, limit);
}

function prioritizeRequests(
	requests: BrowserCaptureRequestDetail[],
	mode: CaptureAnalysisMode
): BrowserCaptureRequestDetail[] {
	const scored = requests.map((req) => ({ req, score: scoreRequestForMode(req, mode) }));
	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return b.req.seq - a.req.seq;
	});
	return scored.map((entry) => entry.req);
}

function scoreRequestForMode(req: BrowserCaptureRequestDetail, mode: CaptureAnalysisMode): number {
	let score = 0;
	const url = (req.url || '').toLowerCase();
	const method = (req.method || '').toUpperCase();
	const contentType = (req.contentType || req.responseHeaders?.['content-type'] || '').toLowerCase();
	const status = req.status ?? 0;
	if (url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.gif') || url.endsWith('.webp') || url.endsWith('.svg')) {
		score -= 6;
	}
	if (url.endsWith('.css') || url.endsWith('.woff') || url.endsWith('.woff2') || url.endsWith('.ttf')) {
		score -= 5;
	}
	if (url.endsWith('.js') || url.endsWith('.map')) {
		score -= 3;
	}
	if (contentType.includes('json') || contentType.includes('text/event-stream') || contentType.includes('xml')) {
		score += 5;
	}
	if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
		score += 4;
	}
	if (status >= 400) {
		score += 2;
	}
	if (req.requestBody && req.requestBody.length > 32) {
		score += 2;
	}
	if (req.source === 'proxy') {
		score += 1;
	}
	if (mode === 'api-reverse' && (method !== 'GET' || contentType.includes('json'))) {
		score += 3;
	}
	if (mode === 'security-audit' && (status === 401 || status === 403 || /token|auth|session|password/i.test(url))) {
		score += 4;
	}
	if (mode === 'performance' && req.durationMs && req.durationMs > 500) {
		score += 4;
	}
	if (mode === 'crypto-reverse' && /sign|hash|encrypt|decrypt|cipher|hmac|aes|rsa|sm[234]|crypto/i.test(url)) {
		score += 5;
	}
	return score;
}

function detectScenes(
	requests: BrowserCaptureRequestDetail[],
	hookEvents: BrowserCaptureHookEvent[]
): CaptureSceneHint[] {
	const scenesMap = new Map<string, CaptureSceneHint>();
	const add = (scene: string, confidence: CaptureSceneHint['confidence'], evidence: string, seq: number) => {
		const key = `${scene}:${confidence}`;
		const existing = scenesMap.get(key);
		if (existing) {
			if (!existing.relatedSeq.includes(seq)) {
				existing.relatedSeq.push(seq);
			}
		} else {
			scenesMap.set(key, { scene, confidence, evidence, relatedSeq: [seq] });
		}
	};
	for (const req of requests) {
		const url = (req.url || '').toLowerCase();
		const method = (req.method || '').toUpperCase();
		const contentType = (req.responseHeaders?.['content-type'] || '').toLowerCase();
		const body = (req.requestBody || '').toLowerCase();
		if (contentType.includes('text/event-stream')) {
			add('sse-stream', 'high', 'SSE response (text/event-stream)', req.seq);
		}
		if (
			/\/(chat\/completions|v1\/messages|api\/chat|completions|claude\/messages|generate)\b/.test(url) ||
			(/\bmessages\b/.test(body) && /\bmodel\b/.test(body) && /\bstream\b/.test(body))
		) {
			add('ai-chat', 'high', 'AI-style API path or payload (messages/model/stream)', req.seq);
		}
		if (/\/oauth(2)?\/(authorize|token)/.test(url) || url.includes('redirect_uri=')) {
			add('auth-oauth', 'high', 'OAuth path or redirect_uri parameter', req.seq);
		}
		if (req.responseBody && /(?:"|')(access|refresh|id|auth)_token(?:"|')/i.test(req.responseBody)) {
			add('auth-token', 'high', 'access_token / refresh_token in response body', req.seq);
		}
		const authHeader = req.requestHeaders?.['authorization'] || req.requestHeaders?.['Authorization'] || '';
		if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
			add('auth-token', 'medium', 'Bearer Authorization header', req.seq);
		}
		if (req.responseHeaders?.['set-cookie']) {
			add('auth-session', 'medium', 'Set-Cookie response', req.seq);
		}
		if (/\/(register|signup|sign-up)\b/.test(url) && method === 'POST' && /(email|password)/.test(body)) {
			add('registration', 'high', 'Registration path with email/password fields', req.seq);
		}
		if (/\/(login|signin|sign-in|auth\/login)\b/.test(url) && method === 'POST' && /(password|passwd)/.test(body)) {
			add('login', 'high', 'Login path with password field', req.seq);
		}
		if ((req.requestHeaders?.['upgrade'] || '').toLowerCase() === 'websocket') {
			add('websocket', 'high', 'Upgrade: websocket header', req.seq);
		}
		const headerKeys = Object.keys(req.requestHeaders || {});
		for (const key of headerKeys) {
			const lower = key.toLowerCase();
			if (
				lower === 'x-signature' ||
				lower === 'x-sign' ||
				lower === 'x-timestamp' ||
				lower === 'x-nonce' ||
				lower === 'x-request-sign' ||
				lower === 'signature'
			) {
				add('crypto-encryption', 'medium', `Signature header: ${key}`, req.seq);
				break;
			}
		}
	}
	if (hookEvents.some((event) => event.category.startsWith('crypto'))) {
		const seq = requests[0]?.seq ?? 0;
		const sample = hookEvents.find((event) => event.category.startsWith('crypto'));
		add('crypto-encryption', 'high', `JS crypto hook fired: ${sample?.label ?? 'crypto.*'}`, seq);
	}
	return Array.from(scenesMap.values());
}

function extractCryptoSnippets(
	hookEvents: BrowserCaptureHookEvent[],
	requests: BrowserCaptureRequestDetail[]
): CaptureCryptoSnippet[] {
	const snippets: CaptureCryptoSnippet[] = [];
	const seenLabels = new Set<string>();
	const candidateUrls = new Set<string>();
	for (const event of hookEvents) {
		if (!event.category.startsWith('crypto')) continue;
		if (seenLabels.has(event.label)) continue;
		seenLabels.add(event.label);
		const url = event.url || '';
		if (url) candidateUrls.add(url);
		snippets.push({
			label: event.label,
			url,
			preview: event.args ? truncate(event.args, 600) : '',
		});
		if (snippets.length >= 12) break;
	}
	// Add crypto-related script URLs from request list as additional snippets.
	for (const req of requests) {
		const url = req.url.toLowerCase();
		if (!/(crypto|jsencrypt|sm[234]|aes|forge|hmac)/.test(url)) continue;
		if (candidateUrls.has(req.url)) continue;
		candidateUrls.add(req.url);
		snippets.push({
			label: `script:${req.url.split('/').pop() || 'crypto.js'}`,
			url: req.url,
			preview: req.responseBody ? truncate(req.responseBody, 400) : '(body not captured)',
		});
		if (snippets.length >= 18) break;
	}
	return snippets;
}

function renderPrompt(args: {
	mode: CaptureAnalysisMode;
	requests: BrowserCaptureRequestDetail[];
	scenes: CaptureSceneHint[];
	cryptoSnippets: CaptureCryptoSnippet[];
	options: CaptureAnalysisOptions;
	fullInput: CaptureAnalysisInput;
}): string {
	const { mode, requests, scenes, cryptoSnippets, options, fullInput } = args;
	const sections: string[] = [];
	sections.push(renderHeader(mode, options));
	sections.push(renderModeInstructions(mode));
	if (scenes.length > 0) {
		sections.push(renderScenesSection(scenes));
	}
	if (options.customNote && options.customNote.trim()) {
		sections.push(`## User note\n\n${options.customNote.trim()}`);
	}
	sections.push(renderRequestsSection(requests));
	if (mode === 'crypto-reverse' || cryptoSnippets.length > 0) {
		sections.push(renderCryptoSection(cryptoSnippets, fullInput.hookEvents));
	}
	if (mode === 'security-audit' || fullInput.storageSnapshots.length > 0) {
		sections.push(renderStorageSection(fullInput.storageSnapshots));
	}
	sections.push(renderFooter(mode));
	return sections.filter(Boolean).join('\n\n');
}

function renderHeader(mode: CaptureAnalysisMode, options: CaptureAnalysisOptions): string {
	const modeLabel = MODE_TITLES[mode];
	return `# Browser capture analysis brief\n\n**Mode**: ${modeLabel}` +
		(options.requestIds && options.requestIds.length > 0
			? `\n**Scope**: ${options.requestIds.length} request(s) selected by the user`
			: '\n**Scope**: top-ranked requests from the current capture');
}

function renderModeInstructions(mode: CaptureAnalysisMode): string {
	const lines = MODE_INSTRUCTIONS[mode];
	return `## Goal\n\n${lines}`;
}

function renderScenesSection(scenes: CaptureSceneHint[]): string {
	const ordered = [...scenes].sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]);
	const rows = ordered.map((scene) => {
		const seqList = scene.relatedSeq.slice(0, 8).map((seq) => `#${seq}`).join(', ');
		const more = scene.relatedSeq.length > 8 ? ` (+${scene.relatedSeq.length - 8} more)` : '';
		return `- **${scene.scene}** (${scene.confidence}): ${scene.evidence} — requests: ${seqList}${more}`;
	});
	return `## Detected scenes\n\n${rows.join('\n')}`;
}

function renderRequestsSection(requests: BrowserCaptureRequestDetail[]): string {
	if (requests.length === 0) {
		return `## Requests\n\n_No matching requests captured._`;
	}
	const rows = requests.map((req) => renderRequest(req));
	return `## Requests (${requests.length})\n\n${rows.join('\n\n---\n\n')}`;
}

function renderRequest(req: BrowserCaptureRequestDetail): string {
	const status = req.status ?? '—';
	const duration = req.durationMs ? `${req.durationMs}ms` : '—';
	const lines: string[] = [];
	lines.push(`### #${req.seq} ${req.method} ${req.url}`);
	lines.push(`Status: ${status} · Duration: ${duration} · Source: ${req.source}` + (req.contentType ? ` · ${req.contentType}` : ''));
	const reqHeaders = pickInterestingHeaders(req.requestHeaders);
	if (reqHeaders.length > 0) {
		lines.push(`**Request headers**:\n\n\`\`\`\n${reqHeaders.join('\n')}\n\`\`\``);
	}
	if (req.requestBody) {
		lines.push(`**Request body**:\n\n\`\`\`\n${truncate(req.requestBody, REQUEST_BODY_PREVIEW)}\n\`\`\``);
	}
	const resHeaders = pickInterestingHeaders(req.responseHeaders);
	if (resHeaders.length > 0) {
		lines.push(`**Response headers**:\n\n\`\`\`\n${resHeaders.join('\n')}\n\`\`\``);
	}
	if (req.responseBody) {
		lines.push(`**Response body**:\n\n\`\`\`\n${truncate(req.responseBody, REQUEST_BODY_PREVIEW)}\n\`\`\``);
	} else if (req.responseBodyOmittedReason) {
		lines.push(`_Response body omitted: ${req.responseBodyOmittedReason}_`);
	}
	if (req.errorText) {
		lines.push(`_Error: ${req.errorText}_`);
	}
	return lines.join('\n\n');
}

function pickInterestingHeaders(headers: Record<string, string> | undefined | null): string[] {
	if (!headers) return [];
	const out: string[] = [];
	for (const [key, value] of Object.entries(headers)) {
		if (HEADER_PREVIEW_KEYS.has(key.toLowerCase()) || key.toLowerCase().startsWith('x-')) {
			out.push(`${key}: ${truncate(value, 240)}`);
		}
	}
	return out;
}

function renderCryptoSection(
	snippets: CaptureCryptoSnippet[],
	hookEvents: BrowserCaptureHookEvent[]
): string {
	const cryptoEvents = hookEvents.filter((event) => event.category.startsWith('crypto')).slice(0, 30);
	if (cryptoEvents.length === 0 && snippets.length === 0) {
		return `## Crypto traces\n\n_No JS crypto hooks recorded during capture._`;
	}
	const lines: string[] = [];
	if (snippets.length > 0) {
		lines.push('### Hook & script highlights');
		for (const snippet of snippets) {
			lines.push(`- **${snippet.label}** ${snippet.url ? `_(${snippet.url})_` : ''}\n  args: \`${truncate(snippet.preview, 240)}\``);
		}
	}
	if (cryptoEvents.length > 0) {
		lines.push('### Recent crypto hook events');
		for (const event of cryptoEvents) {
			lines.push(
				`- \`${event.label}\` @ ${new Date(event.ts).toISOString()} · args: \`${truncate(event.args, 220)}\`` +
					(event.result ? ` · → ${truncate(event.result, 180)}` : '')
			);
		}
	}
	return `## Crypto traces\n\n${lines.join('\n')}`;
}

function renderStorageSection(snapshots: BrowserCaptureStorageSnapshot[]): string {
	if (snapshots.length === 0) {
		return '';
	}
	const rows = snapshots.slice(0, 8).map((snapshot) => {
		const cookieCount = snapshot.cookies.split(';').filter((part) => part.trim()).length;
		const localPreview = snapshot.localStorage
			.slice(0, 6)
			.map((entry) => `${entry.key}=${truncate(entry.value, 80)}`)
			.join('; ');
		return `- **${snapshot.host}** · cookies: ${cookieCount} · localStorage: ${snapshot.localStorage.length} · sessionStorage: ${snapshot.sessionStorage.length}` +
			(localPreview ? `\n  - localStorage sample: ${localPreview}` : '');
	});
	return `## Storage snapshots\n\n${rows.join('\n')}`;
}

function renderFooter(mode: CaptureAnalysisMode): string {
	switch (mode) {
		case 'api-reverse':
			return '## Deliverable\n\n1. Endpoint table (method · path · auth · summary).\n2. Request/response shape per endpoint.\n3. Reproduction snippet (Python `requests` or `curl`).';
		case 'security-audit':
			return '## Deliverable\n\nFor each finding: severity · evidence (request seq) · impact · remediation.';
		case 'performance':
			return '## Deliverable\n\nWaterfall summary, top 5 slow endpoints with hypothesised cause and fix proposal.';
		case 'crypto-reverse':
			return '## Deliverable\n\nIdentify the algorithm, key/IV provenance, and produce a Python reproduction. Reference the relevant request seqs and hook labels.';
		case 'auto':
		default:
			return '## Deliverable\n\nSummarise what this site does, list the most important endpoints, then highlight any auth, crypto, or anomaly worth deeper analysis.';
	}
}

const MODE_TITLES: Record<CaptureAnalysisMode, string> = {
	auto: 'Auto-detect',
	'api-reverse': 'API reverse engineering',
	'security-audit': 'Security audit',
	performance: 'Performance analysis',
	'crypto-reverse': 'JS crypto reverse engineering',
};

const MODE_INSTRUCTIONS: Record<CaptureAnalysisMode, string> = {
	auto: 'Inspect the captured traffic and decide on the most useful framing yourself: API map, security findings, perf hot spots, or crypto/signature reverse. State your framing up front, then deliver.',
	'api-reverse':
		'Reverse-engineer the public-or-internal API surface. For each endpoint deduce: purpose, auth model, required headers, request schema, response shape, and reproducibility outside the browser.',
	'security-audit':
		'Audit the captured traffic for OWASP-style issues: token leaks, missing auth, CSRF risks, sensitive data in URLs/cookies, mixed content, dangerous CORS, exposed PII. Tie each finding to a specific request seq.',
	performance:
		'Find the slowest interactions and the most likely root cause: large payloads, blocking sequence, redundant requests, missing caching, third-party fan-out. Suggest concrete fixes.',
	'crypto-reverse':
		'Identify the encryption / signing scheme that the page uses. Map JS hook traces (CryptoJS / JSEncrypt / forge / SM2-3-4 / crypto.subtle / btoa) to the requests they sign, deduce the algorithm, key/IV provenance, and reproduce in pure Python.',
};

const CONFIDENCE_RANK: Record<CaptureSceneHint['confidence'], number> = {
	high: 3,
	medium: 2,
	low: 1,
};

function truncate(text: string, max: number): string {
	if (!text) return '';
	if (text.length <= max) return text;
	return text.slice(0, max) + '…';
}
