import * as http from 'node:http';
import * as https from 'node:https';
import type { Readable } from 'node:stream';
import FormData from 'form-data';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import type { BotInboundMessage } from '../botRuntime.js';

export type BotTodoListItem = {
	content: string;
	status: 'pending' | 'in_progress' | 'completed';
	activeForm?: string;
};

export type BotStreamChannel = 'leader' | 'worker';

export type StreamReplyCallbacks = {
	onStart: () => Promise<void>;
	onDelta: (fullText: string, channel?: BotStreamChannel) => Promise<void>;
	onToolStatus: (name: string, state: 'running' | 'completed' | 'error', detail?: string) => void;
	onTodoUpdate: (todos: BotTodoListItem[]) => void;
	onDone: (fullText: string) => Promise<void>;
	onError: (error: string) => Promise<void>;
};

export type BotInboundAttachment = {
	kind: 'image' | 'file';
	localPath: string;
	name?: string;
};

export type PlatformInboundEnvelope = BotInboundMessage & {
	messageId?: string;
	attachments?: BotInboundAttachment[];
	reply: (text: string) => Promise<void>;
	replyImage?: (filePath: string) => Promise<void>;
	replyFile?: (filePath: string) => Promise<void>;
	sendTyping?: () => Promise<void>;
	streamReply?: StreamReplyCallbacks;
};

export type PlatformMessageHandler = (message: PlatformInboundEnvelope) => Promise<void>;

export type BotPlatformAdapter = {
	platform: 'telegram' | 'slack' | 'discord' | 'feishu';
	start(onMessage: PlatformMessageHandler): Promise<void>;
	stop(): Promise<void>;
};

const CANCEL_INTENT_PATTERNS = [
	/^\s*\/(stop|cancel|abort)\b/i,
	/^\s*(stop|cancel|abort|halt)\b[!.。]?$/i,
	/^\s*(停|取消|别做了|别再|中止|停一下|打断)[!。.!]?$/,
];

export function looksLikeCancelIntent(text: string): boolean {
	const trimmed = String(text ?? '').trim();
	if (!trimmed) {
		return false;
	}
	return CANCEL_INTENT_PATTERNS.some((re) => re.test(trimmed));
}

export type BotSlashCommand =
	| { kind: 'stop' }
	| { kind: 'reset' }
	| { kind: 'help' }
	| { kind: 'status' }
	| { kind: 'model'; value: string }
	| { kind: 'workspace'; value: string }
	| { kind: 'mode'; value: string }
	| { kind: 'approve'; value: string }
	| { kind: 'deny'; value: string };

export function parseBotSlashCommand(text: string): BotSlashCommand | null {
	const trimmed = String(text ?? '').trim();
	if (!trimmed.startsWith('/')) {
		return null;
	}
	const firstSpace = trimmed.search(/\s/);
	const head = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
	const rest = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();
	switch (head) {
		case '/stop':
		case '/cancel':
		case '/abort':
			return { kind: 'stop' };
		case '/reset':
		case '/new':
		case '/clear':
			return { kind: 'reset' };
		case '/help':
			return { kind: 'help' };
		case '/status':
		case '/state':
			return { kind: 'status' };
		case '/model':
			return { kind: 'model', value: rest };
		case '/workspace':
		case '/ws':
			return { kind: 'workspace', value: rest };
		case '/mode':
			return { kind: 'mode', value: rest };
		case '/y':
		case '/approve':
		case '/allow':
			return { kind: 'approve', value: rest };
		case '/n':
		case '/deny':
			return { kind: 'deny', value: rest };
		default:
			return null;
	}
}

export function splitPlainText(text: string, maxLength: number): string[] {
	const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim();
	if (!normalized) {
		return ['(empty)'];
	}
	if (normalized.length <= maxLength) {
		return [normalized];
	}
	const chunks: string[] = [];
	let rest = normalized;
	while (rest.length > maxLength) {
		const slice = rest.slice(0, maxLength);
		const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
		const cut = breakAt > maxLength * 0.5 ? breakAt : maxLength;
		chunks.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest) {
		chunks.push(rest);
	}
	return chunks.filter(Boolean);
}

export function safeJsonParse<T>(raw: string): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

export function websocketMessageToText(raw: unknown): string {
	if (typeof raw === 'string') {
		return raw;
	}
	if (Buffer.isBuffer(raw)) {
		return raw.toString('utf8');
	}
	if (raw instanceof ArrayBuffer) {
		return Buffer.from(raw).toString('utf8');
	}
	if (Array.isArray(raw)) {
		return Buffer.concat(raw.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))).toString('utf8');
	}
	return String(raw ?? '');
}

export function resolveIntegrationProxyUrl(integration: BotIntegrationConfig): string | undefined {
	switch (integration.platform) {
		case 'telegram':
			return integration.telegram?.proxyUrl?.trim() || undefined;
		case 'slack':
			return integration.slack?.proxyUrl?.trim() || undefined;
		case 'discord':
			return integration.discord?.proxyUrl?.trim() || undefined;
		case 'feishu':
			return integration.feishu?.proxyUrl?.trim() || undefined;
		default:
			return undefined;
	}
}

export function createProxyAgent(proxyUrl?: string): InstanceType<typeof HttpsProxyAgent> | undefined {
	const trimmed = proxyUrl?.trim();
	if (!trimmed) {
		return undefined;
	}
	return new HttpsProxyAgent(trimmed);
}

export function electronProxyRulesFromUrl(proxyUrl: string): string {
	const parsed = new URL(proxyUrl);
	const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
	if (scheme === 'http' || scheme === 'https') {
		return `http=${parsed.host};https=${parsed.host}`;
	}
	return `${scheme}://${parsed.host}`;
}

type JsonPrimitive = string | number | boolean;

type JsonRequestOptions = {
	method?: string;
	headers?: Record<string, string | undefined>;
	body?: unknown;
	timeoutMs?: number;
	proxyUrl?: string;
	signal?: AbortSignal;
	responseType?: 'json' | 'stream';
	returnHeaders?: boolean;
};

type HttpInstanceRequestOptions = {
	url: string;
	method?: string;
	headers?: Record<string, string | undefined>;
	params?: Record<string, JsonPrimitive | null | undefined>;
	data?: unknown;
	timeout?: number;
	responseType?: 'json' | 'stream';
	$return_headers?: boolean;
};

function appendQueryParams(url: string, params?: Record<string, JsonPrimitive | null | undefined>): string {
	if (!params || Object.keys(params).length === 0) {
		return url;
	}
	const parsed = new URL(url);
	for (const [key, value] of Object.entries(params)) {
		if (value === null || value === undefined) {
			continue;
		}
		parsed.searchParams.set(key, String(value));
	}
	return parsed.toString();
}

function normalizeHeaders(input?: Record<string, string | undefined>): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(input ?? {})) {
		if (value === undefined) {
			continue;
		}
		headers[key] = value;
	}
	return headers;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
	const target = name.toLowerCase();
	return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
	const target = name.toLowerCase();
	const key = Object.keys(headers).find((headerName) => headerName.toLowerCase() === target);
	return key ? headers[key] : undefined;
}

function isMultipartContentType(headers: Record<string, string>): boolean {
	return String(readHeader(headers, 'content-type') ?? '')
		.toLowerCase()
		.includes('multipart/form-data');
}

function buildMultipartFormData(body: Record<string, unknown>): FormData {
	const form = new FormData();
	for (const [key, value] of Object.entries(body)) {
		if (value === undefined || value === null) {
			continue;
		}
		if (Buffer.isBuffer(value)) {
			form.append(key, value, { filename: key });
			continue;
		}
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			form.append(key, String(value));
			continue;
		}
		if (typeof (value as { pipe?: unknown }).pipe === 'function') {
			form.append(key, value as Readable);
			continue;
		}
		form.append(key, JSON.stringify(value));
	}
	return form;
}

export async function requestJson<T>(url: string, options: JsonRequestOptions = {}): Promise<T> {
	const target = new URL(url);
	const proxyAgent = createProxyAgent(options.proxyUrl);
	const headers = normalizeHeaders(options.headers);
	let payload: string | Buffer | undefined;
	let streamBody: Readable | null = null;
	if (options.body !== undefined) {
		if (typeof options.body === 'string' || Buffer.isBuffer(options.body)) {
			payload = options.body;
		} else if (
			isMultipartContentType(headers) &&
			typeof options.body === 'object' &&
			options.body !== null &&
			!Array.isArray(options.body)
		) {
			const form = buildMultipartFormData(options.body as Record<string, unknown>);
			const normalizedFormHeaders = normalizeHeaders(form.getHeaders() as Record<string, string>);
			for (const key of Object.keys(headers)) {
				if (key.toLowerCase() === 'content-type' || key.toLowerCase() === 'content-length') {
					delete headers[key];
				}
			}
			Object.assign(headers, normalizedFormHeaders);
			try {
				headers['content-length'] = String(form.getLengthSync());
			} catch {
				/* ignore */
			}
			streamBody = form as unknown as Readable;
		} else if (
			typeof options.body === 'object' &&
			options.body !== null &&
			'getHeaders' in (options.body as Record<string, unknown>) &&
			typeof (options.body as { getHeaders: () => Record<string, string> }).getHeaders === 'function'
		) {
			const form = options.body as {
				getHeaders: () => Record<string, string>;
				getLengthSync?: () => number;
				pipe: (destination: NodeJS.WritableStream) => void;
			};
			Object.assign(headers, form.getHeaders());
			if (!hasHeader(headers, 'content-length') && typeof form.getLengthSync === 'function') {
				try {
					headers['content-length'] = String(form.getLengthSync());
				} catch {
					/* ignore */
				}
			}
			streamBody = form as unknown as Readable;
		} else {
			payload = JSON.stringify(options.body);
		}
	}
	if (payload !== undefined && !hasHeader(headers, 'content-type') && !Buffer.isBuffer(payload)) {
		headers['content-type'] = 'application/json';
	}
	if (payload !== undefined && !hasHeader(headers, 'content-length')) {
		headers['content-length'] = Buffer.byteLength(payload).toString();
	}

	return await new Promise<T>((resolve, reject) => {
		const requestImpl = target.protocol === 'http:' ? http.request : https.request;
		const req = requestImpl(
			target,
			{
				method: options.method ?? (payload === undefined ? 'GET' : 'POST'),
				headers,
				agent: proxyAgent,
			},
			(response) => {
				const status = response.statusCode ?? 0;
				if (options.responseType === 'stream') {
					if (status < 200 || status >= 300) {
						const chunks: Buffer[] = [];
						response.on('data', (chunk) => {
							chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
						});
						response.on('end', () => {
							const raw = Buffer.concat(chunks).toString('utf8');
							const detail = raw.trim().slice(0, 240);
							reject(new Error(`Request failed: ${status}${detail ? ` ${detail}` : ''}`));
						});
						return;
					}
					if (options.returnHeaders) {
						resolve({ data: response, headers: response.headers } as T);
					} else {
						resolve(response as T);
					}
					return;
				}
				const chunks: Buffer[] = [];
				response.on('data', (chunk) => {
					chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
				});
				response.on('end', () => {
					const raw = Buffer.concat(chunks).toString('utf8');
					if (status < 200 || status >= 300) {
						const detail = raw.trim().slice(0, 240);
						reject(new Error(`Request failed: ${status}${detail ? ` ${detail}` : ''}`));
						return;
					}
					if (!raw.trim()) {
						resolve({} as T);
						return;
					}
					try {
						resolve(JSON.parse(raw) as T);
					} catch {
						reject(new Error('Request returned non-JSON response.'));
					}
				});
			}
		);

		const timeoutMs = options.timeoutMs ?? 30_000;
		req.setTimeout(timeoutMs, () => {
			req.destroy(new Error(`Request timed out after ${timeoutMs}ms.`));
		});

		const onAbort = () => {
			req.destroy(new Error('Request aborted.'));
		};
		if (options.signal) {
			if (options.signal.aborted) {
				onAbort();
			} else {
				options.signal.addEventListener('abort', onAbort, { once: true });
			}
		}

		req.on('error', (error) => {
			if (options.signal) {
				options.signal.removeEventListener('abort', onAbort);
			}
			reject(error);
		});
		req.on('close', () => {
			if (options.signal) {
				options.signal.removeEventListener('abort', onAbort);
			}
		});

		if (streamBody) {
			streamBody.pipe(req);
			return;
		}
		if (payload !== undefined) {
			req.write(payload);
		}
		req.end();
	});
}

export function createJsonHttpInstance(proxyUrl?: string) {
	const request = async <T = any>(options: HttpInstanceRequestOptions): Promise<T> =>
		await requestJson<T>(appendQueryParams(options.url, options.params), {
			method: options.method,
			headers: options.headers,
			body: options.data,
			timeoutMs: options.timeout,
			proxyUrl,
			responseType: options.responseType,
			returnHeaders: options.$return_headers === true,
		});

	return {
		request,
		get: async <T = any>(url: string, options?: Omit<HttpInstanceRequestOptions, 'url' | 'method'>) =>
			await request<T>({ ...(options ?? {}), url, method: 'GET' }),
		delete: async <T = any>(url: string, options?: Omit<HttpInstanceRequestOptions, 'url' | 'method'>) =>
			await request<T>({ ...(options ?? {}), url, method: 'DELETE' }),
		head: async <T = any>(url: string, options?: Omit<HttpInstanceRequestOptions, 'url' | 'method'>) =>
			await request<T>({ ...(options ?? {}), url, method: 'HEAD' }),
		options: async <T = any>(url: string, options?: Omit<HttpInstanceRequestOptions, 'url' | 'method'>) =>
			await request<T>({ ...(options ?? {}), url, method: 'OPTIONS' }),
		post: async <T = any>(url: string, data?: unknown, options?: Omit<HttpInstanceRequestOptions, 'url' | 'method' | 'data'>) =>
			await request<T>({ ...(options ?? {}), url, method: 'POST', data }),
		put: async <T = any>(url: string, data?: unknown, options?: Omit<HttpInstanceRequestOptions, 'url' | 'method' | 'data'>) =>
			await request<T>({ ...(options ?? {}), url, method: 'PUT', data }),
		patch: async <T = any>(url: string, data?: unknown, options?: Omit<HttpInstanceRequestOptions, 'url' | 'method' | 'data'>) =>
			await request<T>({ ...(options ?? {}), url, method: 'PATCH', data }),
	};
}
