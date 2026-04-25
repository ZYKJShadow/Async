import * as lark from '@larksuiteoapi/node-sdk';
import type { BotIntegrationConfig } from '../../../botSettingsTypes.js';
import { createJsonHttpInstance, resolveIntegrationProxyUrl } from '../common.js';

/** Mutable token holder so refresh propagates to in-flight closures. */
type TokenHolder = {
	userAccessToken: string;
	userRefreshToken: string;
	expiresAtMs: number;
};

/**
 * Called whenever the user_access_token is silently refreshed. The bot
 * controller wires this to settingsStore.updateBotIntegrationFeishuTokens so
 * the new token survives a restart.
 */
export type FeishuTokenRefreshCallback = (next: {
	userAccessToken: string;
	userRefreshToken: string;
	userAccessTokenExpiresAt: number;
}) => void;

export type FeishuApiClient = {
	readonly lark: lark.Client;
	/** Read lazily — refresh updates the holder, not this snapshot. */
	readonly userAccessToken: string;
	/** True iff the integration carries a non-empty user_access_token at construction. */
	readonly hasUserToken: boolean;
	/** Whether a refresh_token is also configured (silent refresh available). */
	readonly canRefresh: boolean;
	request<T = unknown>(payload: {
		method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
		url: string;
		params?: Record<string, unknown>;
		data?: unknown;
		userToken?: boolean;
	}): Promise<T>;
};

const REFRESH_LEEWAY_MS = 60_000;
// Feishu error codes that mean "user_access_token expired/invalid".
const TOKEN_EXPIRED_CODES = new Set([99991663, 99991661, 99991664]);

function extractFeishuErrorCode(err: unknown): number | null {
	if (!err || typeof err !== 'object') return null;
	const candidates = [
		(err as { code?: unknown }).code,
		(err as { response?: { data?: { code?: unknown } } }).response?.data?.code,
	];
	for (const c of candidates) {
		if (typeof c === 'number') return c;
		if (typeof c === 'string' && /^\d+$/.test(c)) return Number(c);
	}
	return null;
}

export function buildFeishuApiClient(
	integration: BotIntegrationConfig,
	onTokensRefreshed?: FeishuTokenRefreshCallback
): FeishuApiClient | null {
	if (integration.platform !== 'feishu') {
		return null;
	}
	const appId = integration.feishu?.appId?.trim() ?? '';
	const appSecret = integration.feishu?.appSecret?.trim() ?? '';
	if (!appId || !appSecret) {
		return null;
	}
	const proxyUrl = resolveIntegrationProxyUrl(integration);
	const httpInstance = createJsonHttpInstance(proxyUrl);
	const client = new lark.Client({ appId, appSecret, httpInstance });

	const holder: TokenHolder = {
		userAccessToken: integration.feishu?.userAccessToken?.trim() ?? '',
		userRefreshToken: integration.feishu?.userRefreshToken?.trim() ?? '',
		expiresAtMs: Number(integration.feishu?.userAccessTokenExpiresAt ?? 0) || 0,
	};
	const hasUserToken = holder.userAccessToken.length > 0;
	const canRefresh = holder.userRefreshToken.length > 0;

	let inFlightRefresh: Promise<void> | null = null;

	const performRefresh = async (): Promise<void> => {
		if (!holder.userRefreshToken) {
			throw new Error('Cannot refresh user_access_token: no refresh_token saved.');
		}
		const res = await client.authen.oidcRefreshAccessToken.create({
			data: { grant_type: 'refresh_token', refresh_token: holder.userRefreshToken },
		});
		if (!res?.data?.access_token) {
			throw new Error(`Feishu refresh_token exchange returned no access_token (code=${res?.code} msg=${res?.msg}).`);
		}
		holder.userAccessToken = res.data.access_token;
		if (res.data.refresh_token) {
			holder.userRefreshToken = res.data.refresh_token;
		}
		const expiresIn = res.data.expires_in ?? 0;
		holder.expiresAtMs = expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0;
		onTokensRefreshed?.({
			userAccessToken: holder.userAccessToken,
			userRefreshToken: holder.userRefreshToken,
			userAccessTokenExpiresAt: holder.expiresAtMs,
		});
	};

	const ensureFreshUserToken = async (): Promise<void> => {
		if (!holder.userAccessToken) return;
		if (!canRefresh) return;
		if (holder.expiresAtMs && holder.expiresAtMs - Date.now() > REFRESH_LEEWAY_MS) {
			return;
		}
		if (!inFlightRefresh) {
			inFlightRefresh = performRefresh().finally(() => {
				inFlightRefresh = null;
			});
		}
		await inFlightRefresh;
	};

	const issueRequest = async <T>(
		payload: {
			method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
			url: string;
			params?: Record<string, unknown>;
			data?: unknown;
			userToken?: boolean;
		}
	): Promise<T> => {
		if (payload.userToken && holder.userAccessToken) {
			await ensureFreshUserToken();
		}
		const options =
			payload.userToken && holder.userAccessToken
				? lark.withUserAccessToken(holder.userAccessToken)
				: undefined;
		const axiosPayload = {
			method: payload.method,
			url: payload.url,
			params: payload.params,
			data: payload.data,
		};
		return (await client.request(axiosPayload, options)) as T;
	};

	return {
		lark: client,
		get userAccessToken() {
			return holder.userAccessToken;
		},
		hasUserToken,
		canRefresh,
		async request<T = unknown>(payload: {
			method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
			url: string;
			params?: Record<string, unknown>;
			data?: unknown;
			userToken?: boolean;
		}): Promise<T> {
			try {
				return await issueRequest<T>(payload);
			} catch (err) {
				const code = extractFeishuErrorCode(err);
				if (
					payload.userToken &&
					code != null &&
					TOKEN_EXPIRED_CODES.has(code) &&
					holder.userRefreshToken
				) {
					try {
						holder.expiresAtMs = 0; // force refresh path
						await ensureFreshUserToken();
					} catch {
						throw err;
					}
					return await issueRequest<T>(payload);
				}
				throw err;
			}
		},
	};
}

/** Strip secrets so they never make it into a tool result string. */
export function redactFeishuError(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	return raw
		.replace(/"app_secret"\s*:\s*"[^"]+"/g, '"app_secret":"[redacted]"')
		.replace(/Bearer\s+[A-Za-z0-9_\-.]+/g, 'Bearer [redacted]');
}

export function makeJsonResult(toolCallId: string, name: string, payload: unknown): {
	toolCallId: string;
	name: string;
	content: string;
	isError: boolean;
} {
	return {
		toolCallId,
		name,
		content: JSON.stringify(payload, null, 2),
		isError: false,
	};
}

export function makeErrorResult(toolCallId: string, name: string, error: unknown): {
	toolCallId: string;
	name: string;
	content: string;
	isError: boolean;
} {
	return {
		toolCallId,
		name,
		content: redactFeishuError(error),
		isError: true,
	};
}
