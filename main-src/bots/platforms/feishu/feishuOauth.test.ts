import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';

const oidcAccessTokenMock = vi.hoisted(() => vi.fn());
const userInfoGetMock = vi.hoisted(() => vi.fn());
const openExternalMock = vi.hoisted(() => vi.fn());

vi.mock('@larksuiteoapi/node-sdk', () => {
	return {
		Client: vi.fn().mockImplementation(() => ({
			authen: {
				oidcAccessToken: { create: oidcAccessTokenMock },
				userInfo: { get: userInfoGetMock },
			},
			request: vi.fn(),
		})),
		withUserAccessToken: vi.fn(),
	};
});

vi.mock('electron', () => ({
	shell: { openExternal: openExternalMock },
}));

import { runFeishuOauth, cancelFeishuOauth, FEISHU_OAUTH_PORTS, FEISHU_OAUTH_PATH, FEISHU_OAUTH_CALLBACK_URLS } from './feishuOauth.js';
import type { BotIntegrationConfig } from '../../../botSettingsTypes.js';

function integration(): BotIntegrationConfig {
	return {
		id: 'i-1',
		name: 't',
		platform: 'feishu',
		feishu: { appId: 'cli_x', appSecret: 'sec' },
	};
}

/** Simulate the user finishing the Feishu authorize flow by hitting the callback URL. */
async function hitCallback(url: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const req = http.get(url, (res) => {
			res.on('data', () => {
				/* drain */
			});
			res.on('end', () => resolve());
		});
		req.on('error', reject);
	});
}

beforeEach(() => {
	oidcAccessTokenMock.mockReset();
	userInfoGetMock.mockReset();
	openExternalMock.mockReset();
});

afterEach(() => {
	cancelFeishuOauth('i-1');
});

describe('runFeishuOauth', () => {
	it('returns no-integration error for non-feishu platform', async () => {
		const r = await runFeishuOauth({ id: 'x', name: 'y', platform: 'telegram' } as BotIntegrationConfig);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toBe('no-integration');
	});

	it('returns missing-app-credentials when appId or appSecret is empty', async () => {
		const r = await runFeishuOauth({
			id: 'i',
			name: 't',
			platform: 'feishu',
			feishu: { appId: '', appSecret: 'x' },
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toBe('missing-app-credentials');
	});

	it('exposes a stable list of callback URLs (one per fallback port)', () => {
		expect(FEISHU_OAUTH_CALLBACK_URLS).toHaveLength(FEISHU_OAUTH_PORTS.length);
		expect(FEISHU_OAUTH_CALLBACK_URLS[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/feishu\/callback$/);
	});

	it('successful flow: opens browser, awaits callback, exchanges code, returns tokens', async () => {
		oidcAccessTokenMock.mockResolvedValue({
			data: { access_token: 'u_acc', refresh_token: 'u_ref', expires_in: 7200 },
		});
		userInfoGetMock.mockResolvedValue({ data: { open_id: 'ou_1', name: 'Alice' } });

		const flowPromise = runFeishuOauth(integration());

		// Wait for shell.openExternal to be called so we can read out the redirect URI / state.
		await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
		const authUrl = String(openExternalMock.mock.calls[0]![0]);
		const params = new URL(authUrl).searchParams;
		const redirectUri = params.get('redirect_uri')!;
		const state = params.get('state')!;
		expect(redirectUri).toMatch(new RegExp(`${FEISHU_OAUTH_PATH}$`));

		await hitCallback(`${redirectUri}?code=fake_code&state=${state}`);

		const result = await flowPromise;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.tokens.userAccessToken).toBe('u_acc');
			expect(result.tokens.userRefreshToken).toBe('u_ref');
			expect(result.tokens.userAccessTokenExpiresAt).toBeGreaterThan(Date.now());
			expect(result.tokens.userAuthorizedName).toBe('Alice');
		}
	});

	it('state mismatch: rejects callback and returns state-mismatch', async () => {
		const flowPromise = runFeishuOauth(integration());
		await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
		const redirectUri = new URL(String(openExternalMock.mock.calls[0]![0])).searchParams.get('redirect_uri')!;
		await hitCallback(`${redirectUri}?code=fake_code&state=WRONG_STATE`);
		const result = await flowPromise;
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe('state-mismatch');
	});

	it('feishu error parameter: returns feishu-error', async () => {
		const flowPromise = runFeishuOauth(integration());
		await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
		const redirectUri = new URL(String(openExternalMock.mock.calls[0]![0])).searchParams.get('redirect_uri')!;
		await hitCallback(`${redirectUri}?error=access_denied`);
		const result = await flowPromise;
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe('feishu-error');
			expect(result.message).toBe('access_denied');
		}
	});

	it('cancelFeishuOauth aborts an in-flight flow', async () => {
		const flowPromise = runFeishuOauth(integration());
		await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
		cancelFeishuOauth('i-1');
		const result = await flowPromise;
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe('cancelled');
	});

	it('exchange failure: returns exchange-failed when SDK gives no access_token', async () => {
		oidcAccessTokenMock.mockResolvedValue({ code: 99991668, msg: 'invalid code', data: null });
		const flowPromise = runFeishuOauth(integration());
		await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
		const url = new URL(String(openExternalMock.mock.calls[0]![0]));
		const redirectUri = url.searchParams.get('redirect_uri')!;
		const state = url.searchParams.get('state')!;
		await hitCallback(`${redirectUri}?code=fake&state=${state}`);
		const result = await flowPromise;
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe('exchange-failed');
		}
	});

	it('user_info fetch failure does not abort: tokens still returned without name', async () => {
		oidcAccessTokenMock.mockResolvedValue({
			data: { access_token: 'u_acc', refresh_token: 'u_ref', expires_in: 3600 },
		});
		userInfoGetMock.mockRejectedValue(new Error('userinfo unauthorized'));

		const flowPromise = runFeishuOauth(integration());
		await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
		const url = new URL(String(openExternalMock.mock.calls[0]![0]));
		const redirectUri = url.searchParams.get('redirect_uri')!;
		const state = url.searchParams.get('state')!;
		await hitCallback(`${redirectUri}?code=fake&state=${state}`);

		const result = await flowPromise;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.tokens.userAccessToken).toBe('u_acc');
			expect(result.tokens.userAuthorizedName).toBeUndefined();
		}
	});
});
