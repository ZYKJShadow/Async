export type ProviderIdentityPreset = 'async-default' | 'claude-code' | 'custom';

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
	userAgentMode: 'generic' | 'claude-code';
	userAgentProduct: string;
	entrypoint: string;
	appHeaderValue: string;
	clientAppValue: string;
	sessionHeaderName: string;
	systemPromptPrefix: string;
	anthropicMetadataMode: 'async' | 'claude-code';
};

export const PROVIDER_IDENTITY_VERSION_PREVIEW = '<version>';
export const PROVIDER_IDENTITY_SESSION_PREVIEW = '<runtime-session-id>';
export const PROVIDER_IDENTITY_DEVICE_ID_PREVIEW = '<device-id>';

export const CLAUDE_CODE_EMULATED_VERSION = '2.1.112';

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

function cleanToken(value: unknown, fallback: string): string {
	const raw = typeof value === 'string' ? value.trim() : '';
	return raw || fallback;
}

function isPreset(value: unknown): value is ProviderIdentityPreset {
	return value === 'async-default' || value === 'claude-code' || value === 'custom';
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

export function providerIdentityPresetOptions(): Array<{
	id: ProviderIdentityPreset;
	userAgentMode: 'generic' | 'claude-code';
	label: string;
}> {
	return [
		{ id: 'async-default', userAgentMode: 'generic', label: 'Async' },
		{ id: 'claude-code', userAgentMode: 'claude-code', label: 'Claude Code' },
		{ id: 'custom', userAgentMode: 'generic', label: 'Custom' },
	];
}

export function formatResolvedProviderIdentityUserAgent(
	settings: ResolvedProviderIdentitySettings,
	version = PROVIDER_IDENTITY_VERSION_PREVIEW,
	_opts?: { claudeCodeUserType?: string }
): string {
	if (settings.userAgentMode === 'claude-code') {
		// 与 `claude-code/src/utils/userAgent.ts` 一致：`claude-code/${MACRO.VERSION}`
		return `claude-code/${CLAUDE_CODE_EMULATED_VERSION}`;
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
		['x-app', settings.appHeaderValue],
	];
	if (settings.clientAppValue.trim()) {
		headers.push(['x-client-app', settings.clientAppValue]);
	}
	headers.push([settings.sessionHeaderName, PROVIDER_IDENTITY_SESSION_PREVIEW]);
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
