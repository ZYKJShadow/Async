import { shell } from 'electron';
import * as crypto from 'node:crypto';
import * as http from 'node:http';

import type { CodexAuthRecord } from '../settingsStore.js';
import { CODEX_EMULATED_VERSION, CODEX_ORIGINATOR } from '../../src/providerIdentitySettings.js';
import { buildCodexUserAgent } from './codexUserAgent.js';

const DEFAULT_ISSUER = 'https://auth.openai.com';
const DEFAULT_PORT = 1455;
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_SCOPE = 'openid profile email offline_access api.connectors.read api.connectors.invoke';
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ID_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token';

type PkceCodes = {
	codeVerifier: string;
	codeChallenge: string;
};

type OAuthTokens = {
	id_token: string;
	access_token: string;
	refresh_token: string;
};

type ApiKeyExchangeResponse = {
	access_token?: string;
};

type RefreshResponse = {
	id_token?: string;
	access_token?: string;
	refresh_token?: string;
};

export type CodexBrowserLoginResult = CodexAuthRecord & {
	issuer: string;
};

type ActiveCodexLoginCancel = (message?: string) => boolean;

let activeCodexLoginCancel: ActiveCodexLoginCancel | undefined;

function base64Url(bytes: Buffer): string {
	return bytes.toString('base64url');
}

function generatePkce(): PkceCodes {
	const codeVerifier = base64Url(crypto.randomBytes(64));
	const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
	return { codeVerifier, codeChallenge };
}

function generateState(): string {
	return base64Url(crypto.randomBytes(32));
}

function formBody(fields: Record<string, string>): string {
	const body = new URLSearchParams();
	for (const [key, value] of Object.entries(fields)) {
		body.set(key, value);
	}
	return body.toString();
}

function buildAuthorizeUrl(params: {
	issuer: string;
	clientId: string;
	redirectUri: string;
	pkce: PkceCodes;
	state: string;
	workspaceId?: string;
}): string {
	const query = new URLSearchParams({
		response_type: 'code',
		client_id: params.clientId,
		redirect_uri: params.redirectUri,
		scope: AUTHORIZE_SCOPE,
		code_challenge: params.pkce.codeChallenge,
		code_challenge_method: 'S256',
		id_token_add_organizations: 'true',
		codex_cli_simplified_flow: 'true',
		state: params.state,
		originator: CODEX_ORIGINATOR,
	});
	if (params.workspaceId?.trim()) {
		query.set('allowed_workspace_id', params.workspaceId.trim());
	}
	return `${params.issuer.replace(/\/$/, '')}/oauth/authorize?${query.toString()}`;
}

function parseTokenEndpointError(body: string): string {
	const trimmed = body.trim();
	if (!trimmed) {
		return 'unknown error';
	}
	try {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>;
		const description = parsed.error_description;
		if (typeof description === 'string' && description.trim()) {
			return description.trim();
		}
		const error = parsed.error;
		if (typeof error === 'string' && error.trim()) {
			return error.trim();
		}
		if (error && typeof error === 'object') {
			const message = (error as Record<string, unknown>).message;
			if (typeof message === 'string' && message.trim()) {
				return message.trim();
			}
			const code = (error as Record<string, unknown>).code;
			if (typeof code === 'string' && code.trim()) {
				return code.trim();
			}
		}
	} catch {
		/* fall through to raw trimmed body */
	}
	return trimmed;
}

async function postFormJson<T>(url: string, fields: Record<string, string>): Promise<T> {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: formBody(fields),
	});
	if (!response.ok) {
		const detail = parseTokenEndpointError(await response.text().catch(() => ''));
		throw new Error(`token endpoint returned ${response.status}: ${detail}`);
	}
	return (await response.json()) as T;
}

async function exchangeCodeForTokens(params: {
	issuer: string;
	clientId: string;
	redirectUri: string;
	codeVerifier: string;
	code: string;
}): Promise<OAuthTokens> {
	return await postFormJson<OAuthTokens>(`${params.issuer.replace(/\/$/, '')}/oauth/token`, {
		grant_type: 'authorization_code',
		code: params.code,
		redirect_uri: params.redirectUri,
		client_id: params.clientId,
		code_verifier: params.codeVerifier,
	});
}

async function obtainApiKey(issuer: string, clientId: string, idToken: string): Promise<string | undefined> {
	const response = await postFormJson<ApiKeyExchangeResponse>(`${issuer.replace(/\/$/, '')}/oauth/token`, {
		grant_type: TOKEN_EXCHANGE_GRANT,
		client_id: clientId,
		requested_token: 'openai-api-key',
		subject_token: idToken,
		subject_token_type: ID_TOKEN_TYPE,
	});
	return typeof response.access_token === 'string' && response.access_token.trim()
		? response.access_token
		: undefined;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
	const parts = token.split('.');
	const payload = parts[1];
	if (!payload) {
		return {};
	}
	try {
		return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function accountIdFromIdToken(idToken: string): string | undefined {
	const claims = decodeJwtPayload(idToken);
	const authClaims = claims['https://api.openai.com/auth'];
	if (!authClaims || typeof authClaims !== 'object') {
		return undefined;
	}
	const accountId = (authClaims as Record<string, unknown>).chatgpt_account_id;
	return typeof accountId === 'string' && accountId.trim() ? accountId.trim() : undefined;
}

function isMissingCodexEntitlementError(errorCode: string, errorDescription: string | null): boolean {
	return (
		errorCode === 'access_denied' &&
		Boolean(errorDescription?.toLowerCase().includes('missing_codex_entitlement'))
	);
}

function oauthCallbackErrorMessage(errorCode: string, errorDescription: string | null): string {
	if (isMissingCodexEntitlementError(errorCode, errorDescription)) {
		return 'Codex is not enabled for your workspace. Contact your workspace administrator to request access to Codex.';
	}
	if (errorDescription?.trim()) {
		return `Sign-in failed: ${errorDescription.trim()}`;
	}
	return `Sign-in failed: ${errorCode}`;
}

function ensureWorkspaceAllowed(expectedWorkspaceId: string | undefined, idToken: string): string | undefined {
	const expected = expectedWorkspaceId?.trim();
	if (!expected) {
		return undefined;
	}
	const actual = accountIdFromIdToken(idToken);
	if (!actual) {
		return 'Login is restricted to a specific workspace, but the token did not include an chatgpt_account_id claim.';
	}
	if (actual !== expected) {
		return `Login is restricted to workspace id ${expected}.`;
	}
	return undefined;
}

function htmlPage(title: string, body: string): string {
	const escape = (value: string) =>
		value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	return [
		'<!doctype html>',
		'<html><head><meta charset="utf-8" />',
		'<meta name="viewport" content="width=device-width, initial-scale=1" />',
		`<title>${escape(title)}</title>`,
		'<style>',
		'body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d12;color:#f8fafc}',
		'main{max-width:520px;padding:32px}h1{font-size:22px;margin:0 0 10px}p{color:#cbd5e1;margin:0}',
		'</style></head><body><main>',
		`<h1>${escape(title)}</h1>`,
		`<p>${escape(body)}</p>`,
		'</main></body></html>',
	].join('');
}

function sendHtml(res: http.ServerResponse, status: number, title: string, body: string): void {
	const html = htmlPage(title, body);
	res.writeHead(status, {
		'Content-Type': 'text/html; charset=utf-8',
		'Content-Length': Buffer.byteLength(html),
		Connection: 'close',
	});
	res.end(html);
}

function closeServer(server: http.Server): void {
	try {
		server.close();
	} catch {
		/* ignore */
	}
}

export function cancelActiveCodexBrowserLogin(message = 'Codex login cancelled.'): boolean {
	const cancel = activeCodexLoginCancel;
	if (!cancel) {
		return false;
	}
	return cancel(message);
}

function sendCancelRequest(port: number): Promise<void> {
	return new Promise((resolve) => {
		const req = http.request(
			{
				host: '127.0.0.1',
				port,
				path: '/cancel',
				method: 'GET',
				timeout: 2_000,
				headers: { Connection: 'close' },
			},
			(res) => {
				res.resume();
				res.on('end', resolve);
			}
		);
		req.on('timeout', () => {
			req.destroy();
			resolve();
		});
		req.on('error', () => resolve());
		req.end();
	});
}

async function listenServer(server: http.Server, port: number): Promise<number> {
	const bind = () =>
		new Promise<number>((resolve, reject) => {
			const onError = (error: NodeJS.ErrnoException) => {
				server.off('listening', onListening);
				reject(error);
			};
			const onListening = () => {
				server.off('error', onError);
				const address = server.address();
				if (address && typeof address === 'object') {
					resolve(address.port);
					return;
				}
				reject(new Error('Unable to determine login callback port.'));
			};
			server.once('error', onError);
			server.once('listening', onListening);
			server.listen(port, '127.0.0.1');
		});

	let cancelAttempted = false;
	for (let attempt = 0; attempt < 10; attempt += 1) {
		try {
			return await bind();
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== 'EADDRINUSE' || cancelAttempted) {
				throw error;
			}
			cancelAttempted = true;
			await sendCancelRequest(port);
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
	throw new Error(`Port 127.0.0.1:${port} is already in use.`);
}

export async function runCodexBrowserLogin(options?: {
	workspaceId?: string;
	issuer?: string;
	port?: number;
	timeoutMs?: number;
}): Promise<CodexBrowserLoginResult> {
	const issuer = options?.issuer?.trim() || DEFAULT_ISSUER;
	const requestedPort = options?.port ?? DEFAULT_PORT;
	const timeoutMs = Math.max(30_000, options?.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS);
	const pkce = generatePkce();
	const state = generateState();
	let actualPort = requestedPort;
	let settled = false;
	let loginTimeout: ReturnType<typeof setTimeout> | undefined;
	let server!: http.Server;

	let finish!: (value: CodexBrowserLoginResult) => void;
	let fail!: (error: Error) => void;
	const completed = new Promise<CodexBrowserLoginResult>((resolve, reject) => {
		finish = resolve;
		fail = reject;
	});

	const settleOk = (server: http.Server, value: CodexBrowserLoginResult) => {
		if (settled) {
			return;
		}
		settled = true;
		if (activeCodexLoginCancel === cancelCurrentLogin) {
			activeCodexLoginCancel = undefined;
		}
		if (loginTimeout) {
			clearTimeout(loginTimeout);
			loginTimeout = undefined;
		}
		setImmediate(() => closeServer(server));
		finish(value);
	};
	const settleErr = (server: http.Server, error: Error) => {
		if (settled) {
			return;
		}
		settled = true;
		if (activeCodexLoginCancel === cancelCurrentLogin) {
			activeCodexLoginCancel = undefined;
		}
		if (loginTimeout) {
			clearTimeout(loginTimeout);
			loginTimeout = undefined;
		}
		setImmediate(() => closeServer(server));
		fail(error);
	};

	const cancelCurrentLogin: ActiveCodexLoginCancel = (message = 'Codex login cancelled.') => {
		if (settled) {
			return false;
		}
		settleErr(server, new Error(message));
		return true;
	};

	server = http.createServer((req, res) => {
		void (async () => {
			const parsed = new URL(req.url ?? '/', `http://localhost:${actualPort}`);
			if (parsed.pathname === '/cancel') {
				sendHtml(res, 200, 'Codex login cancelled', 'You can close this tab and return to Async IDE.');
				settleErr(server, new Error('Login cancelled.'));
				return;
			}
			if (parsed.pathname !== '/auth/callback') {
				sendHtml(res, 404, 'Not found', 'This local callback URL is only used for Codex login.');
				return;
			}

			if (parsed.searchParams.get('state') !== state) {
				sendHtml(res, 400, 'Codex login failed', 'State mismatch. Please retry Codex login from Async IDE.');
				settleErr(server, new Error('OAuth state mismatch.'));
				return;
			}
			const oauthError = parsed.searchParams.get('error');
			if (oauthError) {
				const description = parsed.searchParams.get('error_description');
				const message = oauthCallbackErrorMessage(oauthError, description);
				sendHtml(res, 400, 'Codex login failed', message);
				settleErr(server, new Error(message));
				return;
			}
			const code = parsed.searchParams.get('code')?.trim();
			if (!code) {
				sendHtml(res, 400, 'Codex login failed', 'Missing authorization code.');
				settleErr(server, new Error('Missing authorization code.'));
				return;
			}

			try {
				const redirectUri = `http://localhost:${actualPort}/auth/callback`;
				const tokens = await exchangeCodeForTokens({
					issuer,
					clientId: CLIENT_ID,
					redirectUri,
					codeVerifier: pkce.codeVerifier,
					code,
				});
				const workspaceError = ensureWorkspaceAllowed(options?.workspaceId, tokens.id_token);
				if (workspaceError) {
					sendHtml(res, 400, 'Codex login failed', workspaceError);
					settleErr(server, new Error(workspaceError));
					return;
				}
				const apiKey = await obtainApiKey(issuer, CLIENT_ID, tokens.id_token).catch(() => undefined);
				const accountId = accountIdFromIdToken(tokens.id_token);
				const result: CodexBrowserLoginResult = {
					idToken: tokens.id_token,
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token,
					...(apiKey ? { apiKey } : {}),
					lastRefreshAt: Date.now(),
					...(accountId ? { accountId } : {}),
					issuer,
				};
				sendHtml(res, 200, 'Codex login complete', 'You can close this tab and return to Async IDE.');
				settleOk(server, result);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				sendHtml(res, 500, 'Codex login failed', message);
				settleErr(server, new Error(message));
			}
		})();
	});

	activeCodexLoginCancel?.('Another Codex login was started.');
	activeCodexLoginCancel = cancelCurrentLogin;

	try {
		actualPort = await listenServer(server, requestedPort);
	} catch (error) {
		if (activeCodexLoginCancel === cancelCurrentLogin) {
			activeCodexLoginCancel = undefined;
		}
		closeServer(server);
		throw error;
	}
	loginTimeout = setTimeout(() => {
		settleErr(server, new Error('Codex login timed out. Please retry.'));
	}, timeoutMs);
	loginTimeout.unref?.();
	const redirectUri = `http://localhost:${actualPort}/auth/callback`;
	const authUrl = buildAuthorizeUrl({
		issuer,
		clientId: CLIENT_ID,
		redirectUri,
		pkce,
		state,
		workspaceId: options?.workspaceId,
	});

	try {
		await shell.openExternal(authUrl);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		settleErr(server, new Error(`Unable to open browser for Codex login: ${message}`));
	}
	return completed;
}

export async function refreshCodexAuth(auth: CodexAuthRecord, issuer = DEFAULT_ISSUER): Promise<CodexAuthRecord> {
	const response = await fetch(`${issuer.replace(/\/$/, '')}/oauth/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'User-Agent': buildCodexUserAgent(CODEX_EMULATED_VERSION),
			originator: CODEX_ORIGINATOR,
		},
		body: JSON.stringify({
			client_id: CLIENT_ID,
			grant_type: 'refresh_token',
			refresh_token: auth.refreshToken,
		}),
	});
	if (!response.ok) {
		const detail = parseTokenEndpointError(await response.text().catch(() => ''));
		throw new Error(`refresh token failed with ${response.status}: ${detail}`);
	}
	const body = (await response.json()) as RefreshResponse;
	const idToken = body.id_token ?? auth.idToken;
	const accessToken = body.access_token ?? auth.accessToken;
	const refreshToken = body.refresh_token ?? auth.refreshToken;
	const apiKey = await obtainApiKey(issuer, CLIENT_ID, idToken).catch(() => auth.apiKey);
	const accountId = accountIdFromIdToken(idToken);
	return {
		idToken,
		accessToken,
		refreshToken,
		...(apiKey ? { apiKey } : {}),
		lastRefreshAt: Date.now(),
		...(accountId ? { accountId } : {}),
	};
}
