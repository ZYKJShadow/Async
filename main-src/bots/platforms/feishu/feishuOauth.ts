import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { shell } from 'electron';
import * as lark from '@larksuiteoapi/node-sdk';
import type { BotIntegrationConfig } from '../../../botSettingsTypes.js';
import { createJsonHttpInstance, resolveIntegrationProxyUrl } from '../common.js';

/**
 * Required Feishu app scopes for the user-token tools we expose. The user
 * must enable these in the app's "Permissions & Scopes" tab BEFORE OAuth:
 *   - task:task                         (list / create / update / delete tasks)
 *   - task:task:write                   (create / update / delete)
 *   - contact:user.base:readonly        (search users by name, batch get)
 *   - contact:user.id:readonly          (resolve open_id ↔ user_id)
 * If a scope is not granted, the user_access_token still issues but the
 * affected tool calls will fail with code 99991672 / 99991668.
 */

/**
 * Fixed callback ports we try in order. The redirect_uri must be
 * pre-registered in the Feishu app config, so we cannot use an OS-assigned
 * ephemeral port — but we keep three options in case the first is busy on
 * the user's machine. ALL THREE URLs must be added to the app's allowlist.
 */
export const FEISHU_OAUTH_PORTS = [53782, 53783, 53784] as const;
export const FEISHU_OAUTH_PATH = '/feishu/callback';

export const FEISHU_OAUTH_CALLBACK_URLS = FEISHU_OAUTH_PORTS.map(
	(port) => `http://127.0.0.1:${port}${FEISHU_OAUTH_PATH}`
);

const FEISHU_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

export type FeishuOauthErrorCode =
	| 'no-integration'
	| 'missing-app-credentials'
	| 'port-in-use'
	| 'timeout'
	| 'state-mismatch'
	| 'cancelled'
	| 'feishu-error'
	| 'exchange-failed';

export type FeishuOauthResult =
	| {
			ok: true;
			tokens: {
				userAccessToken: string;
				userRefreshToken: string;
				userAccessTokenExpiresAt: number;
				userAuthorizedOpenId?: string;
				userAuthorizedName?: string;
			};
	  }
	| { ok: false; error: FeishuOauthErrorCode; message?: string };

type PendingFlow = {
	state: string;
	abort: AbortController;
};

const pending = new Map<string, PendingFlow>();

export function cancelFeishuOauth(integrationId: string): void {
	const flow = pending.get(integrationId);
	if (flow) {
		flow.abort.abort();
		pending.delete(integrationId);
	}
}

function bindServerWithFallback(
	handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; port: number; redirectUri: string } | null> {
	const ports = [...FEISHU_OAUTH_PORTS];
	const tryNext = (i: number): Promise<{ server: http.Server; port: number; redirectUri: string } | null> => {
		if (i >= ports.length) return Promise.resolve(null);
		const port = ports[i]!;
		return new Promise((resolve) => {
			const server = http.createServer(handler);
			let resolved = false;
			server.once('error', () => {
				if (resolved) return;
				resolved = true;
				try {
					server.close();
				} catch {
					/* ignore */
				}
				resolve(tryNext(i + 1));
			});
			server.listen(port, '127.0.0.1', () => {
				if (resolved) return;
				resolved = true;
				resolve({
					server,
					port,
					redirectUri: `http://127.0.0.1:${port}${FEISHU_OAUTH_PATH}`,
				});
			});
		});
	};
	return tryNext(0);
}

const SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authorized</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}main{text-align:center;padding:32px}</style>
</head><body><main><h1>✓ Authorization complete</h1><p>You can close this window and return to Async.</p></main></body></html>`;

function errorHtml(reason: string): string {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authorization failed</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#fecaca}main{text-align:center;padding:32px;max-width:600px}</style>
</head><body><main><h1>Authorization failed</h1><p>${reason.replace(/[<>&]/g, '')}</p><p>You can close this window and try again from Async.</p></main></body></html>`;
}

export async function runFeishuOauth(integration: BotIntegrationConfig): Promise<FeishuOauthResult> {
	if (integration.platform !== 'feishu') {
		return { ok: false, error: 'no-integration' };
	}
	const appId = integration.feishu?.appId?.trim() ?? '';
	const appSecret = integration.feishu?.appSecret?.trim() ?? '';
	if (!appId || !appSecret) {
		return { ok: false, error: 'missing-app-credentials' };
	}

	cancelFeishuOauth(integration.id);

	const state = crypto.randomUUID();
	const abort = new AbortController();
	pending.set(integration.id, { state, abort });

	type CallbackPayload =
		| { ok: true; code: string }
		| { ok: false; error: FeishuOauthErrorCode; message?: string };

	let resolveCallback: (payload: CallbackPayload) => void = () => {};
	const callbackPromise = new Promise<CallbackPayload>((res) => {
		resolveCallback = res;
	});

	const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		if (url.pathname !== FEISHU_OAUTH_PATH) {
			res.writeHead(404).end('Not found');
			return;
		}
		const code = url.searchParams.get('code') ?? '';
		const stateParam = url.searchParams.get('state') ?? '';
		const errorParam = url.searchParams.get('error') ?? '';
		if (errorParam) {
			res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(errorHtml(`Feishu error: ${errorParam}`));
			resolveCallback({ ok: false, error: 'feishu-error', message: errorParam });
			return;
		}
		if (stateParam !== state) {
			res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(errorHtml('state mismatch'));
			resolveCallback({ ok: false, error: 'state-mismatch' });
			return;
		}
		if (!code) {
			res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(errorHtml('missing code'));
			resolveCallback({ ok: false, error: 'feishu-error', message: 'missing code' });
			return;
		}
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(SUCCESS_HTML);
		resolveCallback({ ok: true, code });
	};

	const bound = await bindServerWithFallback(requestHandler);
	if (!bound) {
		pending.delete(integration.id);
		return { ok: false, error: 'port-in-use' };
	}
	const { server, redirectUri } = bound;

	const finish = async (payload: CallbackPayload): Promise<FeishuOauthResult> => {
		try {
			server.close();
		} catch {
			/* ignore */
		}
		pending.delete(integration.id);
		if (!payload.ok) {
			return { ok: false, error: payload.error, message: payload.message };
		}
		try {
			const proxyUrl = resolveIntegrationProxyUrl(integration);
			const httpInstance = createJsonHttpInstance(proxyUrl);
			const client = new lark.Client({ appId, appSecret, httpInstance });
			const exchange = await client.authen.oidcAccessToken.create({
				data: { grant_type: 'authorization_code', code: payload.code },
			});
			const data = exchange?.data;
			if (!data?.access_token) {
				return {
					ok: false,
					error: 'exchange-failed',
					message: `code=${exchange?.code} msg=${exchange?.msg}`,
				};
			}
			const expiresIn = data.expires_in ?? 0;
			const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0;
			let openId: string | undefined;
			let displayName: string | undefined;
			try {
				const userInfo = await client.authen.userInfo.get(undefined, lark.withUserAccessToken(data.access_token));
				if (userInfo?.data) {
					const u = userInfo.data as { open_id?: string; name?: string };
					openId = u.open_id;
					displayName = u.name;
				}
			} catch {
				/* user_info is optional; OAuth still succeeds */
			}
			return {
				ok: true,
				tokens: {
					userAccessToken: data.access_token,
					userRefreshToken: data.refresh_token ?? '',
					userAccessTokenExpiresAt: expiresAt,
					userAuthorizedOpenId: openId,
					userAuthorizedName: displayName,
				},
			};
		} catch (e) {
			return {
				ok: false,
				error: 'exchange-failed',
				message: e instanceof Error ? e.message : String(e),
			};
		}
	};

	const authParams = new URLSearchParams({
		app_id: appId,
		redirect_uri: redirectUri,
		state,
		response_type: 'code',
	});
	const authUrl = `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${authParams.toString()}`;
	void shell.openExternal(authUrl);

	const timeoutPromise = new Promise<CallbackPayload>((res) => {
		const t = setTimeout(() => {
			res({ ok: false, error: 'timeout' });
		}, FEISHU_OAUTH_TIMEOUT_MS);
		abort.signal.addEventListener('abort', () => {
			clearTimeout(t);
			res({ ok: false, error: 'cancelled' });
		});
	});

	const payload = await Promise.race([callbackPromise, timeoutPromise]);
	return await finish(payload);
}
