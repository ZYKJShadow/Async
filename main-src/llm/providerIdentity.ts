import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { OAuthProviderKind, ProviderOAuthAuthRecord, ShellSettings } from '../settingsStore.js';
import {
	ANTIGRAVITY_USER_AGENT,
	CODEX_EMULATED_VERSION,
	CLAUDE_CODE_EMULATED_VERSION,
	formatResolvedProviderIdentityUserAgent,
	resolveProviderIdentitySettings,
	resolveProviderIdentityWithOverride,
	type ProviderIdentitySettings,
} from '../../src/providerIdentitySettings.js';
import { buildCodexUserAgent } from './codexUserAgent.js';

type OpenAIClientOptions = NonNullable<ConstructorParameters<typeof OpenAI>[0]>;
type AnthropicClientOptions = NonNullable<ConstructorParameters<typeof Anthropic>[0]>;

const RUNTIME_PROVIDER_SESSION_ID = randomUUID();
const DEFAULT_APP_VERSION = '0.0.0';
const ANTHROPIC_OFFICIAL_BASE_URL = 'https://api.anthropic.com';
const CLAUDE_CODE_ANTHROPIC_BETA =
	'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28';
let CACHED_PROVIDER_DEVICE_ID: string | null = null;

function getAppVersion(): string {
	try {
		const version = app.getVersion?.();
		if (typeof version === 'string' && version.trim()) {
			return version.trim();
		}
	} catch {
		/* ignore */
	}
	return process.env.npm_package_version?.trim() || DEFAULT_APP_VERSION;
}

function providerIdentityFromSettings(
	settings: ShellSettings,
	override?: ProviderIdentitySettings | null
): ReturnType<typeof resolveProviderIdentitySettings> {
	return resolveProviderIdentityWithOverride(settings.providerIdentity, override);
}

export function providerIdentityForOAuthProvider(
	provider: OAuthProviderKind | undefined
): ProviderIdentitySettings | undefined {
	if (provider === 'codex') {
		return { preset: 'codex' };
	}
	if (provider === 'claude') {
		return { preset: 'claude-code' };
	}
	if (provider === 'antigravity') {
		return { preset: 'antigravity' };
	}
	return undefined;
}

export function providerIdentityForOAuthAuth(
	auth: Pick<ProviderOAuthAuthRecord, 'provider'> | null | undefined
): ProviderIdentitySettings | undefined {
	return providerIdentityForOAuthProvider(auth?.provider);
}

export function isClaudeOAuthAccessToken(token: string | undefined | null): boolean {
	return String(token ?? '').includes('sk-ant-oat');
}

export function buildAnthropicAuthOptions(
	apiKey: string,
	auth?: Pick<ProviderOAuthAuthRecord, 'provider' | 'accessToken'> | null
): Pick<AnthropicClientOptions, 'apiKey' | 'authToken' | 'defaultQuery'> {
	const trimmedApiKey = apiKey.trim();
	const oauthToken =
		auth?.provider === 'claude'
			? auth.accessToken.trim()
			: isClaudeOAuthAccessToken(trimmedApiKey)
				? trimmedApiKey
				: '';
	if (oauthToken) {
		return { authToken: oauthToken, apiKey: null, defaultQuery: { beta: 'true' } };
	}
	return { apiKey: trimmedApiKey };
}

type MutableRequestHeaders = Record<string, string | null | undefined> | Headers;

function isClaudeOAuthClientOptions(options: AnthropicClientOptions): boolean {
	const authToken = typeof options.authToken === 'string' ? options.authToken.trim() : '';
	const defaultQuery =
		options.defaultQuery && typeof options.defaultQuery === 'object'
			? options.defaultQuery as Record<string, unknown>
			: {};
	return Boolean(authToken) && (isClaudeOAuthAccessToken(authToken) || defaultQuery.beta === 'true');
}

function withClaudeOAuthBaseURL(options: AnthropicClientOptions): AnthropicClientOptions {
	const explicitBaseURL = typeof options.baseURL === 'string' ? options.baseURL.trim() : '';
	return {
		...options,
		baseURL: explicitBaseURL || ANTHROPIC_OFFICIAL_BASE_URL,
	};
}

function ensureMutableRequestHeaders(request: { headers?: unknown }): MutableRequestHeaders {
	const raw = request.headers;
	if (!raw) {
		const headers: Record<string, string> = {};
		request.headers = headers;
		return headers;
	}
	if (raw instanceof Headers) {
		return raw;
	}
	if (Array.isArray(raw)) {
		const headers: Record<string, string> = {};
		for (const pair of raw) {
			if (!Array.isArray(pair) || pair.length < 2) {
				continue;
			}
			const name = String(pair[0] ?? '').trim();
			const value = String(pair[1] ?? '');
			if (name) {
				headers[name] = value;
			}
		}
		request.headers = headers;
		return headers;
	}
	if (typeof raw === 'object') {
		return raw as Record<string, string | null | undefined>;
	}
	const headers: Record<string, string> = {};
	request.headers = headers;
	return headers;
}

function headerKey(headers: MutableRequestHeaders, name: string): string | undefined {
	if (headers instanceof Headers) {
		return undefined;
	}
	const target = name.toLowerCase();
	return Object.keys(headers).find((key) => key.toLowerCase() === target);
}

function getRequestHeader(headers: MutableRequestHeaders, name: string): string {
	if (headers instanceof Headers) {
		return headers.get(name) ?? '';
	}
	const key = headerKey(headers, name);
	const value = key ? headers[key] : undefined;
	return typeof value === 'string' ? value : '';
}

function setRequestHeader(headers: MutableRequestHeaders, name: string, value: string): void {
	if (headers instanceof Headers) {
		headers.set(name, value);
		return;
	}
	const existing = headerKey(headers, name);
	if (existing && existing !== name) {
		delete headers[existing];
	}
	headers[name] = value;
}

function deleteRequestHeader(headers: MutableRequestHeaders, name: string): void {
	if (headers instanceof Headers) {
		headers.delete(name);
		return;
	}
	const target = name.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === target) {
			delete headers[key];
		}
	}
}

function safeUrlParts(rawUrl: string): { origin: string; path: string } {
	try {
		const parsed = new URL(rawUrl);
		return {
			origin: `${parsed.protocol}//${parsed.host}`,
			path: `${parsed.pathname}${parsed.search}`,
		};
	} catch {
		return { origin: '<invalid-url>', path: rawUrl };
	}
}

function summarizeAnthropicBody(body: unknown): Record<string, unknown> | undefined {
	if (typeof body !== 'string' || !body.trim().startsWith('{')) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		const system = parsed.system;
		const firstSystemText =
			Array.isArray(system) && system[0] && typeof system[0] === 'object'
				? (system[0] as Record<string, unknown>).text
				: undefined;
		const metadata = parsed.metadata && typeof parsed.metadata === 'object'
			? parsed.metadata as Record<string, unknown>
			: undefined;
		return {
			bodyModel: typeof parsed.model === 'string' ? parsed.model : '',
			bodyStream: parsed.stream === true,
			messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : undefined,
			toolCount: Array.isArray(parsed.tools) ? parsed.tools.length : undefined,
			systemKind: Array.isArray(system) ? 'array' : typeof system,
			systemBlockCount: Array.isArray(system) ? system.length : undefined,
			hasBillingHeader: typeof firstSystemText === 'string' && firstSystemText.startsWith('x-anthropic-billing-header:'),
			hasMetadataUserId: typeof metadata?.user_id === 'string' && metadata.user_id.length > 0,
			hasThinking: parsed.thinking != null,
		};
	} catch {
		return { bodyParse: 'failed' };
	}
}

function logAnthropicWireDebug(params: {
	url: string;
	method?: string;
	stream: boolean;
	headers: MutableRequestHeaders;
	body: unknown;
}): void {
	const { origin, path } = safeUrlParts(params.url);
	const authorization = getRequestHeader(params.headers, 'Authorization');
	const anthropicBeta = getRequestHeader(params.headers, 'Anthropic-Beta');
	const summary = {
		origin,
		path,
		method: params.method ?? '',
		stream: params.stream,
		hasAuthorization: Boolean(authorization),
		authorizationKind: authorization.startsWith('Bearer ') ? 'bearer' : authorization ? 'other' : 'none',
		hasXApiKey: Boolean(getRequestHeader(params.headers, 'x-api-key')),
		contentType: getRequestHeader(params.headers, 'Content-Type'),
		accept: getRequestHeader(params.headers, 'Accept'),
		acceptEncoding: getRequestHeader(params.headers, 'Accept-Encoding'),
		anthropicVersion: getRequestHeader(params.headers, 'Anthropic-Version'),
		anthropicBetaIncludesClaudeCode: anthropicBeta.includes('claude-code-20250219'),
		anthropicBetaIncludesOAuth: anthropicBeta.includes('oauth-2025-04-20'),
		xApp: getRequestHeader(params.headers, 'X-App') || getRequestHeader(params.headers, 'x-app'),
		hasClaudeCodeSessionId: Boolean(getRequestHeader(params.headers, 'X-Claude-Code-Session-Id')),
		hasClientRequestId: Boolean(getRequestHeader(params.headers, 'x-client-request-id')),
		stainlessRuntime: getRequestHeader(params.headers, 'X-Stainless-Runtime'),
		stainlessLang: getRequestHeader(params.headers, 'X-Stainless-Lang'),
		stainlessTimeout: getRequestHeader(params.headers, 'X-Stainless-Timeout'),
		stainlessPackageVersion: getRequestHeader(params.headers, 'X-Stainless-Package-Version'),
		stainlessRuntimeVersion: getRequestHeader(params.headers, 'X-Stainless-Runtime-Version'),
		stainlessOs: getRequestHeader(params.headers, 'X-Stainless-OS'),
		stainlessArch: getRequestHeader(params.headers, 'X-Stainless-Arch'),
		userAgent: getRequestHeader(params.headers, 'User-Agent'),
		connection: getRequestHeader(params.headers, 'Connection'),
		...summarizeAnthropicBody(params.body),
	};
	console.log(`[AnthropicWireDebug] ${JSON.stringify(summary)}`);
}

class ClaudeCodeOAuthAnthropicClient extends Anthropic {
	protected override async prepareRequest(request: any, context: any): Promise<void> {
		await super.prepareRequest(request, context);
		const authToken = typeof this.authToken === 'string' ? this.authToken.trim() : '';
		if (!authToken) {
			return;
		}
		const headers = ensureMutableRequestHeaders(request);
		deleteRequestHeader(headers, 'x-api-key');
		deleteRequestHeader(headers, 'X-Api-Key');
		deleteRequestHeader(headers, 'anthropic-dangerous-direct-browser-access');
		setRequestHeader(headers, 'Authorization', `Bearer ${authToken}`);
		setRequestHeader(headers, 'Content-Type', 'application/json');
		setRequestHeader(headers, 'Anthropic-Beta', CLAUDE_CODE_ANTHROPIC_BETA);
		setRequestHeader(headers, 'Anthropic-Version', '2023-06-01');
		setRequestHeader(headers, 'X-App', 'cli');
		setRequestHeader(headers, 'X-Stainless-Retry-Count', '0');
		setRequestHeader(headers, 'X-Stainless-Runtime', 'node');
		setRequestHeader(headers, 'X-Stainless-Lang', 'js');
		setRequestHeader(headers, 'X-Stainless-Timeout', '600');
		setRequestHeader(headers, 'X-Stainless-Package-Version', '0.74.0');
		setRequestHeader(headers, 'X-Stainless-Runtime-Version', 'v24.3.0');
		setRequestHeader(headers, 'X-Stainless-OS', 'MacOS');
		setRequestHeader(headers, 'X-Stainless-Arch', 'arm64');
		setRequestHeader(headers, 'X-Claude-Code-Session-Id', RUNTIME_PROVIDER_SESSION_ID);
		setRequestHeader(headers, 'x-client-request-id', randomUUID());
		setRequestHeader(headers, 'Connection', 'keep-alive');
		setRequestHeader(headers, 'User-Agent', `claude-cli/${CLAUDE_CODE_EMULATED_VERSION} (external, cli)`);
		if (context?.options?.stream === true) {
			setRequestHeader(headers, 'Accept', 'text/event-stream');
			setRequestHeader(headers, 'Accept-Encoding', 'identity');
		} else {
			setRequestHeader(headers, 'Accept', 'application/json');
			setRequestHeader(headers, 'Accept-Encoding', 'gzip, deflate, br, zstd');
		}
		logAnthropicWireDebug({
			url: String(context?.url ?? ''),
			method: typeof request.method === 'string' ? request.method : undefined,
			stream: context?.options?.stream === true,
			headers,
			body: request.body,
		});
	}
}

export function createAnthropicClient(options: AnthropicClientOptions): Anthropic {
	if (isClaudeOAuthClientOptions(options)) {
		return new ClaudeCodeOAuthAnthropicClient(withClaudeOAuthBaseURL(options));
	}
	return new Anthropic(options);
}

function safeOrigin(raw: string | undefined): string {
	const value = raw?.trim() || 'https://api.anthropic.com';
	try {
		const parsed = new URL(value);
		return `${parsed.protocol}//${parsed.host}`;
	} catch {
		return '<invalid-base-url>';
	}
}

function isoTime(ms: number | undefined): string | undefined {
	if (ms == null || !Number.isFinite(ms)) {
		return undefined;
	}
	try {
		return new Date(ms).toISOString();
	} catch {
		return undefined;
	}
}

export function logAnthropicAuthDebug(params: {
	source: string;
	providerId?: string;
	model?: string;
	baseURL?: string;
	authOptions: Pick<AnthropicClientOptions, 'apiKey' | 'authToken' | 'defaultQuery'>;
	oauthAuth?: Pick<ProviderOAuthAuthRecord, 'provider' | 'accessToken' | 'refreshToken' | 'expiresAt' | 'lastRefreshAt'>;
	providerIdentity?: ProviderIdentitySettings | null;
}): void {
	const authToken = typeof params.authOptions.authToken === 'string' ? params.authOptions.authToken : '';
	const apiKey = typeof params.authOptions.apiKey === 'string' ? params.authOptions.apiKey : '';
	const tokenForKind = authToken || apiKey;
	const isClaudeOAuth = params.oauthAuth?.provider === 'claude' || isClaudeOAuthAccessToken(tokenForKind);
	if (!isClaudeOAuth) {
		return;
	}
	const defaultQuery =
		params.authOptions.defaultQuery && typeof params.authOptions.defaultQuery === 'object'
			? (params.authOptions.defaultQuery as Record<string, unknown>)
			: {};
	const summary = {
		source: params.source,
		providerId: params.providerId ?? '',
		model: params.model ?? '',
		baseOrigin: safeOrigin(params.baseURL),
		authMode: authToken ? 'bearer' : apiKey ? 'x-api-key' : 'none',
		tokenKind: isClaudeOAuthAccessToken(tokenForKind) ? 'claude-oauth' : tokenForKind ? 'other' : 'none',
		hasOAuthAuth: Boolean(params.oauthAuth),
		oauthProvider: params.oauthAuth?.provider ?? '',
		hasRefreshToken: Boolean(params.oauthAuth?.refreshToken?.trim()),
		expiresAt: isoTime(params.oauthAuth?.expiresAt),
		lastRefreshAt: isoTime(params.oauthAuth?.lastRefreshAt),
		betaQuery: defaultQuery.beta === 'true' ? 'true' : String(defaultQuery.beta ?? ''),
		providerIdentityPreset: params.providerIdentity?.preset ?? '',
		expectedPath: defaultQuery.beta === 'true' ? '/v1/messages?beta=true' : '/v1/messages',
	};
	console.log(`[AnthropicAuthDebug] ${JSON.stringify(summary)}`);
}

function mergeDefaultHeaders(
	existing: OpenAIClientOptions['defaultHeaders'] | AnthropicClientOptions['defaultHeaders'],
	identityHeaders: Record<string, string>
): Record<string, string> {
	const base =
		existing && typeof existing === 'object'
			? (existing as Record<string, string>)
			: {};
	return {
		...identityHeaders,
		...base,
	};
}

export function buildProviderIdentityHeaders(
	settings: ShellSettings,
	override?: ProviderIdentitySettings | null
): Record<string, string> {
	const identity = providerIdentityFromSettings(settings, override);
	const userAgent =
		identity.userAgentMode === 'codex'
			? buildCodexUserAgent(CODEX_EMULATED_VERSION)
			: identity.userAgentMode === 'antigravity'
				? ANTIGRAVITY_USER_AGENT
			: formatResolvedProviderIdentityUserAgent(identity, getAppVersion());
	const headers: Record<string, string> = {
		'User-Agent': userAgent,
	};
	if (identity.appHeaderValue.trim()) {
		headers['x-app'] = identity.appHeaderValue;
	}
	if (identity.clientAppValue.trim()) {
		headers['x-client-app'] = identity.clientAppValue;
	}
	if (identity.originatorHeaderValue) {
		headers['originator'] = identity.originatorHeaderValue;
	}
	if (identity.sessionHeaderName.trim()) {
		headers[identity.sessionHeaderName] = RUNTIME_PROVIDER_SESSION_ID;
	}
	return headers;
}

function buildAnthropicSpecificIdentityHeaders(
	settings: ShellSettings,
	override?: ProviderIdentitySettings | null
): Record<string, string> {
	const identity = providerIdentityFromSettings(settings, override);
	if (identity.preset !== 'claude-code') {
		return {};
	}
	return {
		'Anthropic-Beta': CLAUDE_CODE_ANTHROPIC_BETA,
		'Anthropic-Version': '2023-06-01',
		'X-Stainless-Retry-Count': '0',
		'X-Stainless-Runtime': 'node',
		'X-Stainless-Lang': 'js',
		'X-Stainless-Timeout': '600',
		'X-Stainless-Package-Version': '0.74.0',
		'X-Stainless-Runtime-Version': 'v24.3.0',
		'X-Stainless-Os': 'MacOS',
		'X-Stainless-Arch': 'arm64',
		'x-client-request-id': randomUUID(),
		Connection: 'keep-alive',
		'User-Agent': `claude-cli/${CLAUDE_CODE_EMULATED_VERSION} (external, cli)`,
	};
}

export function applyOpenAIProviderIdentity(
	settings: ShellSettings,
	options: OpenAIClientOptions,
	override?: ProviderIdentitySettings | null
): OpenAIClientOptions {
	const identityHeaders = buildProviderIdentityHeaders(settings, override);
	if (Object.keys(identityHeaders).length === 0) {
		return options;
	}
	return {
		...options,
		defaultHeaders: mergeDefaultHeaders(options.defaultHeaders, identityHeaders),
	};
}

export function applyAnthropicProviderIdentity(
	settings: ShellSettings,
	options: AnthropicClientOptions,
	override?: ProviderIdentitySettings | null
): AnthropicClientOptions {
	const identityHeaders = {
		...buildProviderIdentityHeaders(settings, override),
		...buildAnthropicSpecificIdentityHeaders(settings, override),
	};
	if (Object.keys(identityHeaders).length === 0) {
		return options;
	}
	return {
		...options,
		defaultHeaders: mergeDefaultHeaders(options.defaultHeaders, identityHeaders),
	};
}

export function prependProviderIdentitySystemPrompt(
	settings: ShellSettings,
	systemText: string | undefined,
	override?: ProviderIdentitySettings | null
): string {
	const identity = providerIdentityFromSettings(settings, override);
	const base = systemText?.trim() ?? '';
	const prefix = identity.systemPromptPrefix.trim();
	if (!prefix) {
		return base;
	}
	if (!base) {
		return prefix;
	}
	if (base.startsWith(prefix)) {
		return base;
	}
	return `${prefix}\n\n${base}`;
}

function getStableProviderDeviceId(): string {
	if (CACHED_PROVIDER_DEVICE_ID) {
		return CACHED_PROVIDER_DEVICE_ID;
	}
	try {
		const userDataDir = app.getPath('userData');
		const fp = join(userDataDir, 'provider-identity-device-id.txt');
		if (existsSync(fp)) {
			const raw = readFileSync(fp, 'utf8').trim();
			if (raw) {
				CACHED_PROVIDER_DEVICE_ID = raw;
				return raw;
			}
		}
		mkdirSync(userDataDir, { recursive: true });
		const next = randomUUID();
		writeFileSync(fp, next, 'utf8');
		CACHED_PROVIDER_DEVICE_ID = next;
		return next;
	} catch {
		const next = randomUUID();
		CACHED_PROVIDER_DEVICE_ID = next;
		return next;
	}
}

export function buildAnthropicProviderIdentityMetadata(
	settings: ShellSettings,
	override?: ProviderIdentitySettings | null
): { user_id: string } | undefined {
	const identity = providerIdentityFromSettings(settings, override);
	if (identity.anthropicMetadataMode === 'claude-code') {
		return {
			user_id: JSON.stringify({
				device_id: getStableProviderDeviceId(),
				account_uuid: '',
				session_id: RUNTIME_PROVIDER_SESSION_ID,
			}),
		};
	}
	return {
		user_id: JSON.stringify({
			client_app: identity.clientAppValue,
			entrypoint: identity.entrypoint,
			session_id: RUNTIME_PROVIDER_SESSION_ID,
			version: getAppVersion(),
		}),
	};
}
