export type ProviderIdentityPreset =
	| 'async-default'
	| 'antigravity'
	| 'claude-code'
	| 'codex'
	| 'custom'
	| 'inherit';

export type ProviderIdentitySettings = {
	preset?: ProviderIdentityPreset;
	userAgentProduct?: string;
	entrypoint?: string;
	appHeaderValue?: string;
	clientAppValue?: string;
	systemPromptPrefix?: string;
};

export type ResolvedProviderIdentitySettings = {
	preset: ProviderIdentityPreset;
	userAgentMode: 'generic' | 'antigravity' | 'claude-code' | 'codex';
	userAgentProduct: string;
	entrypoint: string;
	appHeaderValue: string;
	clientAppValue: string;
	sessionHeaderName: string;
	systemPromptPrefix: string;
	anthropicMetadataMode: 'async' | 'claude-code';
	/** Optional value for the upstream `originator` header (used by Codex). */
	originatorHeaderValue?: string;
};

export const PROVIDER_IDENTITY_VERSION_PREVIEW = '<version>';
export const PROVIDER_IDENTITY_SESSION_PREVIEW = '<runtime-session-id>';
export const PROVIDER_IDENTITY_DEVICE_ID_PREVIEW = '<device-id>';

export const CLAUDE_CODE_EMULATED_VERSION = '2.1.63';
export const CODEX_EMULATED_VERSION = '0.118.0';
export const ANTIGRAVITY_EMULATED_VERSION = '1.21.9';
/**
 * CLIProxyAPI's Codex executor defaults to the Codex TUI fingerprint:
 * `codex-tui/0.118.0 (...)` plus `Originator: codex-tui`.
 */
export const CODEX_ORIGINATOR = 'codex-tui';
export const ANTIGRAVITY_USER_AGENT = `antigravity/${ANTIGRAVITY_EMULATED_VERSION} darwin/arm64`;

const ASYNC_DEFAULT_IDENTITY: ResolvedProviderIdentitySettings = {
	preset: 'async-default',
	userAgentMode: 'generic',
	userAgentProduct: 'async-ide',
	entrypoint: 'desktop',
	appHeaderValue: 'desktop',
	clientAppValue: 'async-ide',
	sessionHeaderName: 'X-Async-Session-Id',
	systemPromptPrefix: 'You are Async, the AI coding assistant running inside Async IDE.',
	anthropicMetadataMode: 'async',
};

const CLAUDE_CODE_IDENTITY: ResolvedProviderIdentitySettings = {
	preset: 'claude-code',
	userAgentMode: 'claude-code',
	userAgentProduct: 'claude-cli',
	entrypoint: 'cli',
	appHeaderValue: 'cli',
	clientAppValue: '',
	sessionHeaderName: 'X-Claude-Code-Session-Id',
	systemPromptPrefix: "You are Claude Code, Anthropic's official CLI for Claude.",
	anthropicMetadataMode: 'claude-code',
};

const CODEX_IDENTITY: ResolvedProviderIdentitySettings = {
	preset: 'codex',
	userAgentMode: 'codex',
	userAgentProduct: CODEX_ORIGINATOR,
	entrypoint: 'cli',
	// CLIProxyAPI's Codex executor doesn't send `x-app` / `x-client-app`. We keep these fields
	// because they're required by the shared shape, but leave them blank so
	// the identity-headers builder skips them.
	appHeaderValue: '',
	clientAppValue: '',
	// CLIProxyAPI sets Session_id on Mac-like Codex-TUI requests at runtime;
	// this shared preset leaves the generic session header empty.
	sessionHeaderName: '',
	systemPromptPrefix:
		'You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful.',
	anthropicMetadataMode: 'async',
	originatorHeaderValue: CODEX_ORIGINATOR,
};

const ANTIGRAVITY_IDENTITY: ResolvedProviderIdentitySettings = {
	preset: 'antigravity',
	userAgentMode: 'antigravity',
	userAgentProduct: 'antigravity',
	entrypoint: 'desktop',
	appHeaderValue: '',
	clientAppValue: '',
	sessionHeaderName: '',
	systemPromptPrefix:
		'You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.',
	anthropicMetadataMode: 'async',
};

function cleanToken(value: unknown, fallback: string): string {
	const raw = typeof value === 'string' ? value.trim() : '';
	return raw || fallback;
}

function isPreset(value: unknown): value is ProviderIdentityPreset {
	return (
		value === 'async-default' ||
		value === 'antigravity' ||
		value === 'claude-code' ||
		value === 'codex' ||
		value === 'custom' ||
		value === 'inherit'
	);
}

function inferPreset(raw?: ProviderIdentitySettings | null): ProviderIdentityPreset {
	if (isPreset(raw?.preset)) {
		return raw.preset;
	}
	const legacyValues = {
		userAgentProduct: cleanToken(raw?.userAgentProduct, ASYNC_DEFAULT_IDENTITY.userAgentProduct),
		entrypoint: cleanToken(raw?.entrypoint, ASYNC_DEFAULT_IDENTITY.entrypoint),
		appHeaderValue: cleanToken(raw?.appHeaderValue, ASYNC_DEFAULT_IDENTITY.appHeaderValue),
		clientAppValue: cleanToken(raw?.clientAppValue, ASYNC_DEFAULT_IDENTITY.clientAppValue),
		systemPromptPrefix: cleanToken(raw?.systemPromptPrefix, ASYNC_DEFAULT_IDENTITY.systemPromptPrefix),
	};
	const matchesAsyncDefault =
		legacyValues.userAgentProduct === ASYNC_DEFAULT_IDENTITY.userAgentProduct &&
		legacyValues.entrypoint === ASYNC_DEFAULT_IDENTITY.entrypoint &&
		legacyValues.appHeaderValue === ASYNC_DEFAULT_IDENTITY.appHeaderValue &&
		legacyValues.clientAppValue === ASYNC_DEFAULT_IDENTITY.clientAppValue &&
		legacyValues.systemPromptPrefix === ASYNC_DEFAULT_IDENTITY.systemPromptPrefix;
	if (matchesAsyncDefault) {
		return 'async-default';
	}
	const matchesClaudeCode =
		legacyValues.userAgentProduct === CLAUDE_CODE_IDENTITY.userAgentProduct &&
		legacyValues.entrypoint === CLAUDE_CODE_IDENTITY.entrypoint &&
		legacyValues.appHeaderValue === CLAUDE_CODE_IDENTITY.appHeaderValue &&
		legacyValues.clientAppValue === CLAUDE_CODE_IDENTITY.clientAppValue &&
		legacyValues.systemPromptPrefix === CLAUDE_CODE_IDENTITY.systemPromptPrefix;
	if (matchesClaudeCode) {
		return 'claude-code';
	}
	const matchesAntigravity =
		legacyValues.userAgentProduct === ANTIGRAVITY_IDENTITY.userAgentProduct &&
		legacyValues.entrypoint === ANTIGRAVITY_IDENTITY.entrypoint &&
		legacyValues.appHeaderValue === ANTIGRAVITY_IDENTITY.appHeaderValue &&
		legacyValues.clientAppValue === ANTIGRAVITY_IDENTITY.clientAppValue &&
		legacyValues.systemPromptPrefix === ANTIGRAVITY_IDENTITY.systemPromptPrefix;
	if (matchesAntigravity) {
		return 'antigravity';
	}
	const matchesCodex =
		legacyValues.userAgentProduct === CODEX_IDENTITY.userAgentProduct &&
		legacyValues.entrypoint === CODEX_IDENTITY.entrypoint &&
		legacyValues.appHeaderValue === CODEX_IDENTITY.appHeaderValue &&
		legacyValues.clientAppValue === CODEX_IDENTITY.clientAppValue &&
		legacyValues.systemPromptPrefix === CODEX_IDENTITY.systemPromptPrefix;
	if (matchesCodex) {
		return 'codex';
	}
	return 'custom';
}

export function defaultProviderIdentitySettings(): ProviderIdentitySettings {
	return {
		preset: 'claude-code',
		userAgentProduct: CLAUDE_CODE_IDENTITY.userAgentProduct,
		entrypoint: CLAUDE_CODE_IDENTITY.entrypoint,
		appHeaderValue: CLAUDE_CODE_IDENTITY.appHeaderValue,
		clientAppValue: CLAUDE_CODE_IDENTITY.clientAppValue,
		systemPromptPrefix: CLAUDE_CODE_IDENTITY.systemPromptPrefix,
	};
}

export function resolveProviderIdentitySettings(
	raw?: ProviderIdentitySettings | null
): ResolvedProviderIdentitySettings {
	const preset = inferPreset(raw);
	if (preset === 'claude-code') {
		return { ...CLAUDE_CODE_IDENTITY };
	}
	if (preset === 'antigravity') {
		return { ...ANTIGRAVITY_IDENTITY };
	}
	if (preset === 'codex') {
		return { ...CODEX_IDENTITY };
	}
	if (preset === 'custom') {
		return {
			preset,
			userAgentMode: 'generic',
			userAgentProduct: cleanToken(raw?.userAgentProduct, ASYNC_DEFAULT_IDENTITY.userAgentProduct),
			entrypoint: cleanToken(raw?.entrypoint, ASYNC_DEFAULT_IDENTITY.entrypoint),
			appHeaderValue: cleanToken(raw?.appHeaderValue, ASYNC_DEFAULT_IDENTITY.appHeaderValue),
			clientAppValue: cleanToken(raw?.clientAppValue, ASYNC_DEFAULT_IDENTITY.clientAppValue),
			sessionHeaderName: ASYNC_DEFAULT_IDENTITY.sessionHeaderName,
			systemPromptPrefix: cleanToken(raw?.systemPromptPrefix, ASYNC_DEFAULT_IDENTITY.systemPromptPrefix),
			anthropicMetadataMode: 'async',
		};
	}
	return { ...ASYNC_DEFAULT_IDENTITY };
}

/**
 * Resolve the effective identity for a per-provider override falling back to global.
 *
 * - If `override` is undefined or its `preset` is `'inherit'`, return the global resolution.
 * - Otherwise, resolve the override directly.
 */
export function resolveProviderIdentityWithOverride(
	global: ProviderIdentitySettings | null | undefined,
	override: ProviderIdentitySettings | null | undefined
): ResolvedProviderIdentitySettings {
	if (!override || override.preset === 'inherit' || override.preset === undefined) {
		return resolveProviderIdentitySettings(global);
	}
	return resolveProviderIdentitySettings(override);
}

export function providerIdentityPresetOptions(): Array<{
	id: ProviderIdentityPreset;
	userAgentMode: 'generic' | 'antigravity' | 'claude-code' | 'codex';
	label: string;
}> {
	return [
		{ id: 'async-default', userAgentMode: 'generic', label: 'Async' },
		{ id: 'claude-code', userAgentMode: 'claude-code', label: 'Claude Code' },
		{ id: 'codex', userAgentMode: 'codex', label: 'Codex CLI' },
		{ id: 'antigravity', userAgentMode: 'antigravity', label: 'Antigravity' },
		{ id: 'custom', userAgentMode: 'generic', label: 'Custom' },
	];
}

export function formatResolvedProviderIdentityUserAgent(
	settings: ResolvedProviderIdentitySettings,
	version = PROVIDER_IDENTITY_VERSION_PREVIEW,
	_opts?: { claudeCodeUserType?: string }
): string {
	if (settings.userAgentMode === 'claude-code') {
		// CLIProxyAPI default Claude Code fingerprint.
		return `claude-cli/${CLAUDE_CODE_EMULATED_VERSION} (external, cli)`;
	}
	if (settings.userAgentMode === 'codex') {
		return `${CODEX_ORIGINATOR}/${version} (Mac OS 26.3.1; arm64) iTerm.app/3.6.9 (${CODEX_ORIGINATOR}; ${version})`;
	}
	if (settings.userAgentMode === 'antigravity') {
		return ANTIGRAVITY_USER_AGENT;
	}
	const parts = [settings.entrypoint];
	if (settings.clientAppValue.trim()) {
		parts.push(`client-app/${settings.clientAppValue}`);
	}
	return `${settings.userAgentProduct}/${version} (${parts.join(', ')})`;
}

export function buildProviderIdentityPreview(raw?: ProviderIdentitySettings | null): {
	preset: ProviderIdentityPreset;
	userAgent: string;
	headers: Array<[string, string]>;
	anthropicUserId: string;
	systemPromptPrefix: string;
} {
	const settings = resolveProviderIdentitySettings(raw);
	const headers: Array<[string, string]> = [
		['User-Agent', formatResolvedProviderIdentityUserAgent(settings)],
	];
	if (settings.appHeaderValue.trim()) {
		headers.push(['x-app', settings.appHeaderValue]);
	}
	if (settings.clientAppValue.trim()) {
		headers.push(['x-client-app', settings.clientAppValue]);
	}
	if (settings.originatorHeaderValue) {
		headers.push(['originator', settings.originatorHeaderValue]);
	}
	if (settings.sessionHeaderName.trim()) {
		headers.push([settings.sessionHeaderName, PROVIDER_IDENTITY_SESSION_PREVIEW]);
	}
	return {
		preset: settings.preset,
		userAgent: formatResolvedProviderIdentityUserAgent(settings),
		headers,
		anthropicUserId:
			settings.anthropicMetadataMode === 'claude-code'
				? JSON.stringify({
						device_id: PROVIDER_IDENTITY_DEVICE_ID_PREVIEW,
						account_uuid: '',
						session_id: PROVIDER_IDENTITY_SESSION_PREVIEW,
				  })
				: JSON.stringify({
						client_app: settings.clientAppValue,
						entrypoint: settings.entrypoint,
						session_id: PROVIDER_IDENTITY_SESSION_PREVIEW,
						version: PROVIDER_IDENTITY_VERSION_PREVIEW,
				  }),
		systemPromptPrefix: settings.systemPromptPrefix,
	};
}
