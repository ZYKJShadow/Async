import { shell } from 'electron';
import * as crypto from 'node:crypto';
import * as http from 'node:http';

import {
	getSettings,
	patchSettings,
	type OAuthProviderKind,
	type ProviderOAuthAuthRecord,
} from '../settingsStore.js';
import {
	CODEX_EMULATED_VERSION,
	CODEX_ORIGINATOR,
} from '../../src/providerIdentitySettings.js';
import { buildCodexUserAgent } from './codexUserAgent.js';
import { electronNetFetch } from './electronNetFetch.js';

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_SCOPE = 'openid email profile offline_access';

const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_AUTH_URL = 'https://claude.ai/oauth/authorize';
const CLAUDE_TOKEN_URL = 'https://api.anthropic.com/v1/oauth/token';
const CLAUDE_SCOPE = 'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload';

const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const ANTIGRAVITY_CLIENT_SECRET = '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';
const ANTIGRAVITY_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const ANTIGRAVITY_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ANTIGRAVITY_USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json';
const ANTIGRAVITY_API_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const ANTIGRAVITY_API_VERSION = 'v1internal';
const ANTIGRAVITY_API_CLIENT = 'google-cloud-sdk vscode_cloudshelleditor/0.1';
const ANTIGRAVITY_CLIENT_METADATA = '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}';
const ANTIGRAVITY_SCOPES = [
	'https://www.googleapis.com/auth/cloud-platform',
	'https://www.googleapis.com/auth/userinfo.email',
	'https://www.googleapis.com/auth/userinfo.profile',
	'https://www.googleapis.com/auth/cclog',
	'https://www.googleapis.com/auth/experimentsandconfigs',
];

type PkceCodes = {
	codeVerifier: string;
	codeChallenge: string;
};

type LoginConfig = {
	provider: OAuthProviderKind;
	label: string;
	port: number;
	callbackPath: string;
	windowTitle: string;
	usesPkce: boolean;
	buildAuthorizeUrl: (params: {
		redirectUri: string;
		state: string;
		pkce?: PkceCodes;
	}) => string;
	exchangeCode: (params: {
		code: string;
		redirectUri: string;
		state: string;
		pkce?: PkceCodes;
	}) => Promise<ProviderOAuthAuthRecord>;
};

type ActiveLoginCancel = (message?: string) => boolean;

let activeLoginCancel: ActiveLoginCancel | undefined;

function base64Url(bytes: Buffer): string {
	return bytes.toString('base64url');
}

function generatePkce(): PkceCodes {
	const codeVerifier = base64Url(crypto.randomBytes(96));
	const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
	return { codeVerifier, codeChallenge };
}

function generateState(): string {
	return crypto.randomBytes(16).toString('hex');
}

function formBody(fields: Record<string, string>): string {
	const body = new URLSearchParams();
	for (const [key, value] of Object.entries(fields)) {
		body.set(key, value);
	}
	return body.toString();
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
		}
	} catch {
		/* fall through */
	}
	return trimmed;
}

async function postFormJson<T>(
	url: string,
	fields: Record<string, string>,
	headers?: Record<string, string>
): Promise<T> {
	const response = await electronNetFetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
			...(headers ?? {}),
		},
		body: formBody(fields),
	});
	if (!response.ok) {
		const detail = parseTokenEndpointError(await response.text().catch(() => ''));
		throw new Error(`token endpoint returned ${response.status}: ${detail}`);
	}
	return (await response.json()) as T;
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
	const response = await electronNetFetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const detail = parseTokenEndpointError(await response.text().catch(() => ''));
		throw new Error(`token endpoint returned ${response.status}: ${detail}`);
	}
	return (await response.json()) as T;
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

function codexAccountIdFromIdToken(idToken: string): string | undefined {
	const claims = decodeJwtPayload(idToken);
	const authClaims = claims['https://api.openai.com/auth'];
	if (!authClaims || typeof authClaims !== 'object') {
		return undefined;
	}
	const accountId = (authClaims as Record<string, unknown>).chatgpt_account_id;
	return typeof accountId === 'string' && accountId.trim() ? accountId.trim() : undefined;
}

function emailFromIdToken(idToken: string): string | undefined {
	const claims = decodeJwtPayload(idToken);
	const email = claims.email;
	return typeof email === 'string' && email.trim() ? email.trim() : undefined;
}

function expiresAtFromSeconds(expiresIn: unknown): number | undefined {
	if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
		return undefined;
	}
	return Date.now() + Math.floor(expiresIn * 1000);
}

function oauthCallbackErrorMessage(providerLabel: string, errorCode: string, errorDescription: string | null): string {
	if (
		errorCode === 'access_denied' &&
		Boolean(errorDescription?.toLowerCase().includes('missing_codex_entitlement'))
	) {
		return 'Codex is not enabled for your workspace. Contact your workspace administrator to request access to Codex.';
	}
	if (errorDescription?.trim()) {
		return `${providerLabel} sign-in failed: ${errorDescription.trim()}`;
	}
	return `${providerLabel} sign-in failed: ${errorCode}`;
}

function parseClaudeCodeAndState(code: string): { code: string; state?: string } {
	const parts = code.split('#');
	return {
		code: parts[0]?.trim() ?? '',
		state: parts[1]?.trim() || undefined,
	};
}

async function fetchAntigravityEmail(accessToken: string): Promise<string | undefined> {
	const response = await electronNetFetch(ANTIGRAVITY_USERINFO_URL, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!response.ok) {
		const detail = parseTokenEndpointError(await response.text().catch(() => ''));
		throw new Error(`antigravity userinfo returned ${response.status}: ${detail}`);
	}
	const body = (await response.json()) as { email?: unknown };
	return typeof body.email === 'string' && body.email.trim() ? body.email.trim() : undefined;
}

async function onboardAntigravityUser(accessToken: string, tierId: string): Promise<string | undefined> {
	const requestBody = {
		tierId,
		metadata: {
			ideType: 'ANTIGRAVITY',
			platform: 'PLATFORM_UNSPECIFIED',
			pluginType: 'GEMINI',
		},
	};
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const response = await electronNetFetch(`${ANTIGRAVITY_API_ENDPOINT}/${ANTIGRAVITY_API_VERSION}:onboardUser`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				'User-Agent': 'google-api-nodejs-client/9.15.1',
				'X-Goog-Api-Client': ANTIGRAVITY_API_CLIENT,
				'Client-Metadata': ANTIGRAVITY_CLIENT_METADATA,
			},
			body: JSON.stringify(requestBody),
		});
		const raw = await response.text();
		if (!response.ok) {
			throw new Error(`antigravity onboardUser returned ${response.status}: ${raw.trim()}`);
		}
		const body = JSON.parse(raw) as Record<string, unknown>;
		if (body.done === true && body.response && typeof body.response === 'object') {
			const project = (body.response as Record<string, unknown>).cloudaicompanionProject;
			if (typeof project === 'string' && project.trim()) {
				return project.trim();
			}
			if (project && typeof project === 'object') {
				const id = (project as Record<string, unknown>).id;
				if (typeof id === 'string' && id.trim()) {
					return id.trim();
				}
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	return undefined;
}

async function fetchAntigravityProjectId(accessToken: string): Promise<string | undefined> {
	const response = await electronNetFetch(`${ANTIGRAVITY_API_ENDPOINT}/${ANTIGRAVITY_API_VERSION}:loadCodeAssist`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
			'User-Agent': 'google-api-nodejs-client/9.15.1',
			'X-Goog-Api-Client': ANTIGRAVITY_API_CLIENT,
			'Client-Metadata': ANTIGRAVITY_CLIENT_METADATA,
		},
		body: JSON.stringify({
			metadata: {
				ideType: 'ANTIGRAVITY',
				platform: 'PLATFORM_UNSPECIFIED',
				pluginType: 'GEMINI',
			},
		}),
	});
	const raw = await response.text();
	if (!response.ok) {
		throw new Error(`antigravity loadCodeAssist returned ${response.status}: ${raw.trim()}`);
	}
	const body = JSON.parse(raw) as Record<string, unknown>;
	const project = body.cloudaicompanionProject;
	if (typeof project === 'string' && project.trim()) {
		return project.trim();
	}
	if (project && typeof project === 'object') {
		const id = (project as Record<string, unknown>).id;
		if (typeof id === 'string' && id.trim()) {
			return id.trim();
		}
	}
	let tierId = 'legacy-tier';
	if (Array.isArray(body.allowedTiers)) {
		for (const rawTier of body.allowedTiers) {
			if (!rawTier || typeof rawTier !== 'object') {
				continue;
			}
			const tier = rawTier as Record<string, unknown>;
			if (tier.isDefault === true && typeof tier.id === 'string' && tier.id.trim()) {
				tierId = tier.id.trim();
				break;
			}
		}
	}
	return await onboardAntigravityUser(accessToken, tierId);
}

type CodexTokenResponse = {
	access_token: string;
	refresh_token: string;
	id_token: string;
	token_type?: string;
	expires_in?: number;
};

type ClaudeTokenResponse = {
	access_token: string;
	refresh_token: string;
	token_type?: string;
	expires_in?: number;
	account?: { email_address?: string };
};

type AntigravityTokenResponse = {
	access_token: string;
	refresh_token?: string;
	token_type?: string;
	expires_in?: number;
};

const LOGIN_CONFIGS: Record<OAuthProviderKind, LoginConfig> = {
	codex: {
		provider: 'codex',
		label: 'Codex',
		port: 1455,
		callbackPath: '/auth/callback',
		windowTitle: 'Codex Login',
		usesPkce: true,
		buildAuthorizeUrl: ({ redirectUri, state, pkce }) => {
			if (!pkce) {
				throw new Error('Codex login requires PKCE.');
			}
			const query = new URLSearchParams({
				client_id: CODEX_CLIENT_ID,
				response_type: 'code',
				redirect_uri: redirectUri,
				scope: CODEX_SCOPE,
				state,
				code_challenge: pkce.codeChallenge,
				code_challenge_method: 'S256',
				prompt: 'login',
				id_token_add_organizations: 'true',
				codex_cli_simplified_flow: 'true',
			});
			return `${CODEX_AUTH_URL}?${query.toString()}`;
		},
		exchangeCode: async ({ code, redirectUri, pkce }) => {
			if (!pkce) {
				throw new Error('Codex token exchange requires PKCE.');
			}
			const body = await postFormJson<CodexTokenResponse>(CODEX_TOKEN_URL, {
				grant_type: 'authorization_code',
				client_id: CODEX_CLIENT_ID,
				code,
				redirect_uri: redirectUri,
				code_verifier: pkce.codeVerifier,
			});
			const accountId = codexAccountIdFromIdToken(body.id_token);
			const email = emailFromIdToken(body.id_token);
			return {
				provider: 'codex',
				accessToken: body.access_token,
				refreshToken: body.refresh_token,
				idToken: body.id_token,
				tokenType: body.token_type,
				expiresAt: expiresAtFromSeconds(body.expires_in),
				lastRefreshAt: Date.now(),
				...(accountId ? { accountId } : {}),
				...(email ? { email } : {}),
			};
		},
	},
	claude: {
		provider: 'claude',
		label: 'Claude Code',
		port: 54545,
		callbackPath: '/callback',
		windowTitle: 'Claude Code Login',
		usesPkce: true,
		buildAuthorizeUrl: ({ redirectUri, state, pkce }) => {
			if (!pkce) {
				throw new Error('Claude Code login requires PKCE.');
			}
			const query = new URLSearchParams({
				code: 'true',
				client_id: CLAUDE_CLIENT_ID,
				response_type: 'code',
				redirect_uri: redirectUri,
				scope: CLAUDE_SCOPE,
				code_challenge: pkce.codeChallenge,
				code_challenge_method: 'S256',
				state,
			});
			return `${CLAUDE_AUTH_URL}?${query.toString()}`;
		},
		exchangeCode: async ({ code, state, pkce }) => {
			if (!pkce) {
				throw new Error('Claude Code token exchange requires PKCE.');
			}
			const parsed = parseClaudeCodeAndState(code);
			const body = await postJson<ClaudeTokenResponse>(CLAUDE_TOKEN_URL, {
				code: parsed.code,
				state: parsed.state || state,
				grant_type: 'authorization_code',
				client_id: CLAUDE_CLIENT_ID,
				redirect_uri: 'http://localhost:54545/callback',
				code_verifier: pkce.codeVerifier,
			});
			const email = body.account?.email_address?.trim();
			return {
				provider: 'claude',
				accessToken: body.access_token,
				refreshToken: body.refresh_token,
				tokenType: body.token_type,
				expiresAt: expiresAtFromSeconds(body.expires_in),
				lastRefreshAt: Date.now(),
				...(email ? { email } : {}),
			};
		},
	},
	antigravity: {
		provider: 'antigravity',
		label: 'Antigravity',
		port: 51121,
		callbackPath: '/oauth-callback',
		windowTitle: 'Antigravity Login',
		usesPkce: false,
		buildAuthorizeUrl: ({ redirectUri, state }) => {
			const query = new URLSearchParams({
				access_type: 'offline',
				client_id: ANTIGRAVITY_CLIENT_ID,
				prompt: 'consent',
				redirect_uri: redirectUri,
				response_type: 'code',
				scope: ANTIGRAVITY_SCOPES.join(' '),
				state,
			});
			return `${ANTIGRAVITY_AUTH_URL}?${query.toString()}`;
		},
		exchangeCode: async ({ code, redirectUri }) => {
			const body = await postFormJson<AntigravityTokenResponse>(ANTIGRAVITY_TOKEN_URL, {
				code,
				client_id: ANTIGRAVITY_CLIENT_ID,
				client_secret: ANTIGRAVITY_CLIENT_SECRET,
				redirect_uri: redirectUri,
				grant_type: 'authorization_code',
			});
			const accessToken = body.access_token.trim();
			if (!accessToken) {
				throw new Error('Antigravity token exchange returned an empty access token.');
			}
			const email = await fetchAntigravityEmail(accessToken);
			const projectId = await fetchAntigravityProjectId(accessToken).catch(() => undefined);
			return {
				provider: 'antigravity',
				accessToken,
				refreshToken: body.refresh_token ?? '',
				tokenType: body.token_type,
				expiresAt: expiresAtFromSeconds(body.expires_in),
				lastRefreshAt: Date.now(),
				...(email ? { email } : {}),
				...(projectId ? { projectId } : {}),
			};
		},
	},
};

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

export function cancelActiveProviderOAuthLogin(message = 'Login cancelled.'): boolean {
	const cancel = activeLoginCancel;
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

export async function runProviderOAuthLogin(options: {
	provider: OAuthProviderKind;
	timeoutMs?: number;
}): Promise<ProviderOAuthAuthRecord> {
	const config = LOGIN_CONFIGS[options.provider];
	const timeoutMs = Math.max(30_000, options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS);
	const pkce = config.usesPkce ? generatePkce() : undefined;
	const state = generateState();
	let actualPort = config.port;
	let settled = false;
	let loginTimeout: ReturnType<typeof setTimeout> | undefined;
	let server!: http.Server;

	let finish!: (value: ProviderOAuthAuthRecord) => void;
	let fail!: (error: Error) => void;
	const completed = new Promise<ProviderOAuthAuthRecord>((resolve, reject) => {
		finish = resolve;
		fail = reject;
	});

	const settleOk = (value: ProviderOAuthAuthRecord) => {
		if (settled) {
			return;
		}
		settled = true;
		if (activeLoginCancel === cancelCurrentLogin) {
			activeLoginCancel = undefined;
		}
		if (loginTimeout) {
			clearTimeout(loginTimeout);
			loginTimeout = undefined;
		}
		setImmediate(() => closeServer(server));
		finish(value);
	};
	const settleErr = (error: Error) => {
		if (settled) {
			return;
		}
		settled = true;
		if (activeLoginCancel === cancelCurrentLogin) {
			activeLoginCancel = undefined;
		}
		if (loginTimeout) {
			clearTimeout(loginTimeout);
			loginTimeout = undefined;
		}
		setImmediate(() => closeServer(server));
		fail(error);
	};

	const cancelCurrentLogin: ActiveLoginCancel = (message = `${config.label} login cancelled.`) => {
		if (settled) {
			return false;
		}
		settleErr(new Error(message));
		return true;
	};

	server = http.createServer((req, res) => {
		void (async () => {
			const parsed = new URL(req.url ?? '/', `http://localhost:${actualPort}`);
			if (parsed.pathname === '/cancel') {
				sendHtml(res, 200, `${config.label} login cancelled`, 'You can close this tab and return to Async IDE.');
				settleErr(new Error(`${config.label} login cancelled.`));
				return;
			}
			if (parsed.pathname !== config.callbackPath) {
				sendHtml(res, 404, 'Not found', `This local callback URL is only used for ${config.label} login.`);
				return;
			}
			if (parsed.searchParams.get('state') !== state) {
				sendHtml(res, 400, `${config.label} login failed`, 'State mismatch. Please retry login from Async IDE.');
				settleErr(new Error('OAuth state mismatch.'));
				return;
			}
			const oauthError = parsed.searchParams.get('error');
			if (oauthError) {
				const description = parsed.searchParams.get('error_description');
				const message = oauthCallbackErrorMessage(config.label, oauthError, description);
				sendHtml(res, 400, `${config.label} login failed`, message);
				settleErr(new Error(message));
				return;
			}
			const code = parsed.searchParams.get('code')?.trim();
			if (!code) {
				sendHtml(res, 400, `${config.label} login failed`, 'Missing authorization code.');
				settleErr(new Error('Missing authorization code.'));
				return;
			}
			try {
				const redirectUri = `http://localhost:${actualPort}${config.callbackPath}`;
				const auth = await config.exchangeCode({
					code,
					redirectUri,
					state,
					pkce,
				});
				sendHtml(res, 200, `${config.label} login complete`, 'You can close this tab and return to Async IDE.');
				settleOk(auth);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				sendHtml(res, 500, `${config.label} login failed`, message);
				settleErr(new Error(message));
			}
		})();
	});

	activeLoginCancel?.('Another provider login was started.');
	activeLoginCancel = cancelCurrentLogin;

	try {
		actualPort = await listenServer(server, config.port);
	} catch (error) {
		if (activeLoginCancel === cancelCurrentLogin) {
			activeLoginCancel = undefined;
		}
		closeServer(server);
		throw error;
	}

	loginTimeout = setTimeout(() => {
		settleErr(new Error(`${config.label} login timed out. Please retry.`));
	}, timeoutMs);
	loginTimeout.unref?.();

	const redirectUri = `http://localhost:${actualPort}${config.callbackPath}`;
	const authUrl = config.buildAuthorizeUrl({ redirectUri, state, pkce });

	try {
		await shell.openExternal(authUrl);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		settleErr(new Error(`Unable to open browser for ${config.label} login: ${message}`));
	}
	return completed;
}

export function providerOAuthLabel(provider: OAuthProviderKind): string {
	return LOGIN_CONFIGS[provider]?.label ?? provider;
}

async function refreshCodexOAuth(auth: ProviderOAuthAuthRecord): Promise<ProviderOAuthAuthRecord> {
	const body = await postFormJson<CodexTokenResponse>(
		CODEX_TOKEN_URL,
		{
			client_id: CODEX_CLIENT_ID,
			grant_type: 'refresh_token',
			refresh_token: auth.refreshToken,
			scope: 'openid profile email',
		},
		{
			'User-Agent': buildCodexUserAgent(CODEX_EMULATED_VERSION),
			Originator: CODEX_ORIGINATOR,
		}
	);
	const idToken = body.id_token || auth.idToken;
	const accountId = idToken ? codexAccountIdFromIdToken(idToken) : auth.accountId;
	const email = idToken ? emailFromIdToken(idToken) : auth.email;
	return {
		...auth,
		accessToken: body.access_token,
		refreshToken: body.refresh_token || auth.refreshToken,
		idToken,
		tokenType: body.token_type ?? auth.tokenType,
		expiresAt: expiresAtFromSeconds(body.expires_in),
		lastRefreshAt: Date.now(),
		...(accountId ? { accountId } : {}),
		...(email ? { email } : {}),
	};
}

async function refreshClaudeOAuth(auth: ProviderOAuthAuthRecord): Promise<ProviderOAuthAuthRecord> {
	const body = await postJson<ClaudeTokenResponse>(CLAUDE_TOKEN_URL, {
		client_id: CLAUDE_CLIENT_ID,
		grant_type: 'refresh_token',
		refresh_token: auth.refreshToken,
	});
	const email = body.account?.email_address?.trim() || auth.email;
	return {
		...auth,
		accessToken: body.access_token,
		refreshToken: body.refresh_token || auth.refreshToken,
		tokenType: body.token_type ?? auth.tokenType,
		expiresAt: expiresAtFromSeconds(body.expires_in),
		lastRefreshAt: Date.now(),
		...(email ? { email } : {}),
	};
}

async function refreshAntigravityOAuth(auth: ProviderOAuthAuthRecord): Promise<ProviderOAuthAuthRecord> {
	const body = await postFormJson<AntigravityTokenResponse>(
		ANTIGRAVITY_TOKEN_URL,
		{
			client_id: ANTIGRAVITY_CLIENT_ID,
			client_secret: ANTIGRAVITY_CLIENT_SECRET,
			grant_type: 'refresh_token',
			refresh_token: auth.refreshToken,
		},
		{ 'User-Agent': 'Go-http-client/2.0' }
	);
	const accessToken = body.access_token.trim();
	const projectId = accessToken
		? await fetchAntigravityProjectId(accessToken).catch(() => auth.projectId)
		: auth.projectId;
	return {
		...auth,
		accessToken,
		refreshToken: body.refresh_token || auth.refreshToken,
		tokenType: body.token_type ?? auth.tokenType,
		expiresAt: expiresAtFromSeconds(body.expires_in),
		lastRefreshAt: Date.now(),
		...(projectId ? { projectId } : {}),
	};
}

export async function refreshProviderOAuthAuth(auth: ProviderOAuthAuthRecord): Promise<ProviderOAuthAuthRecord> {
	if (auth.provider === 'codex') {
		return await refreshCodexOAuth(auth);
	}
	if (auth.provider === 'claude') {
		return await refreshClaudeOAuth(auth);
	}
	return await refreshAntigravityOAuth(auth);
}

function refreshLeadMs(provider: OAuthProviderKind): number {
	if (provider === 'codex') {
		return 5 * 24 * 60 * 60 * 1000;
	}
	if (provider === 'claude') {
		return 4 * 60 * 60 * 1000;
	}
	return 5 * 60 * 1000;
}

export async function ensureFreshOAuthAuthForRequest(
	providerId: string | undefined,
	auth: ProviderOAuthAuthRecord
): Promise<ProviderOAuthAuthRecord> {
	if (!auth.refreshToken.trim() || !auth.expiresAt) {
		return auth;
	}
	if (auth.expiresAt - Date.now() > refreshLeadMs(auth.provider)) {
		return auth;
	}
	const refreshed = await refreshProviderOAuthAuth(auth);
	if (providerId) {
		const settings = getSettings();
		const providers = (settings.models?.providers ?? []).map((provider) => {
			if (provider.id !== providerId) {
				return provider;
			}
			return {
				...provider,
				apiKey: refreshed.accessToken,
				oauthAuth: refreshed,
				...(refreshed.provider === 'codex'
					? {
							codexAuth: {
								idToken: refreshed.idToken ?? '',
								accessToken: refreshed.accessToken,
								refreshToken: refreshed.refreshToken,
								lastRefreshAt: refreshed.lastRefreshAt,
								...(refreshed.accountId ? { accountId: refreshed.accountId } : {}),
							},
						}
					: {}),
			};
		});
		patchSettings({
			models: {
				providers,
				entries: settings.models?.entries ?? [],
				enabledIds: settings.models?.enabledIds ?? [],
				thinkingByModelId: settings.models?.thinkingByModelId ?? {},
			},
		});
	}
	return refreshed;
}
