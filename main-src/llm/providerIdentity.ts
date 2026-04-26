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
