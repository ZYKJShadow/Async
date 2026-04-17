import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { ShellSettings } from '../settingsStore.js';
import {
	formatResolvedProviderIdentityUserAgent,
	resolveProviderIdentitySettings,
} from '../../src/providerIdentitySettings.js';

type OpenAIClientOptions = ConstructorParameters<typeof OpenAI>[0];
type AnthropicClientOptions = ConstructorParameters<typeof Anthropic>[0];

const RUNTIME_PROVIDER_SESSION_ID = randomUUID();
const DEFAULT_APP_VERSION = '0.0.0';
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

function providerIdentityFromSettings(settings: ShellSettings): ReturnType<typeof resolveProviderIdentitySettings> {
	return resolveProviderIdentitySettings(settings.providerIdentity);
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

export function buildProviderIdentityHeaders(settings: ShellSettings): Record<string, string> {
	const identity = providerIdentityFromSettings(settings);
	const headers: Record<string, string> = {
		'User-Agent': formatResolvedProviderIdentityUserAgent(identity, getAppVersion()),
		'x-app': identity.appHeaderValue,
	};
	if (identity.clientAppValue.trim()) {
		headers['x-client-app'] = identity.clientAppValue;
	}
	headers[identity.sessionHeaderName] = RUNTIME_PROVIDER_SESSION_ID;
	return headers;
}

export function applyOpenAIProviderIdentity(
	settings: ShellSettings,
	options: OpenAIClientOptions
): OpenAIClientOptions {
	const identityHeaders = buildProviderIdentityHeaders(settings);
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
	options: AnthropicClientOptions
): AnthropicClientOptions {
	const identityHeaders = buildProviderIdentityHeaders(settings);
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
	systemText: string | undefined
): string {
	const identity = providerIdentityFromSettings(settings);
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
	settings: ShellSettings
): { user_id: string } | undefined {
	const identity = providerIdentityFromSettings(settings);
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
