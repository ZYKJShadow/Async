import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const oidcRefreshMock = vi.hoisted(() => vi.fn());
const requestMock = vi.hoisted(() => vi.fn());
const withUserAccessTokenMock = vi.hoisted(() => vi.fn((token: string) => ({ __userToken: token })));

vi.mock('@larksuiteoapi/node-sdk', () => {
	return {
		Client: vi.fn().mockImplementation(() => ({
			authen: { oidcRefreshAccessToken: { create: oidcRefreshMock } },
			request: requestMock,
		})),
		withUserAccessToken: withUserAccessTokenMock,
	};
});

import { buildFeishuApiClient } from './feishuApiClient.js';
import type { BotIntegrationConfig } from '../../../botSettingsTypes.js';

function integration(overrides: Partial<NonNullable<BotIntegrationConfig['feishu']>> = {}): BotIntegrationConfig {
	return {
		id: 'i',
		name: 'feishu',
		platform: 'feishu',
		feishu: {
			appId: 'cli_x',
			appSecret: 'sec',
			...overrides,
		},
	};
}

beforeEach(() => {
	oidcRefreshMock.mockReset();
	requestMock.mockReset();
	withUserAccessTokenMock.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('feishuApiClient refresh & retry', () => {
	it('returns null when integration is not feishu or app credentials are missing', () => {
		expect(buildFeishuApiClient({ id: 'i', name: 't', platform: 'telegram' } as BotIntegrationConfig)).toBeNull();
		expect(buildFeishuApiClient(integration({ appId: '' }))).toBeNull();
		expect(buildFeishuApiClient(integration({ appSecret: '' }))).toBeNull();
	});

	it('hasUserToken / canRefresh flags reflect the integration config', () => {
		const noToken = buildFeishuApiClient(integration())!;
		expect(noToken.hasUserToken).toBe(false);
		expect(noToken.canRefresh).toBe(false);

		const tokenOnly = buildFeishuApiClient(integration({ userAccessToken: 'u' }))!;
		expect(tokenOnly.hasUserToken).toBe(true);
		expect(tokenOnly.canRefresh).toBe(false);

		const both = buildFeishuApiClient(integration({ userAccessToken: 'u', userRefreshToken: 'r' }))!;
		expect(both.hasUserToken).toBe(true);
		expect(both.canRefresh).toBe(true);
	});

	it('does not refresh when token is comfortably non-expired', async () => {
		const client = buildFeishuApiClient(
			integration({
				userAccessToken: 'u',
				userRefreshToken: 'r',
				userAccessTokenExpiresAt: Date.now() + 30 * 60 * 1000,
			})
		)!;
		requestMock.mockResolvedValue({ data: { ok: true } });
		await client.request({ method: 'GET', url: '/x', userToken: true });
		expect(oidcRefreshMock).not.toHaveBeenCalled();
		expect(withUserAccessTokenMock).toHaveBeenCalledWith('u');
	});

	it('refreshes when token is within the 60s leeway and updates the holder + persists', async () => {
		oidcRefreshMock.mockResolvedValue({
			data: { access_token: 'u2', refresh_token: 'r2', expires_in: 7200 },
		});
		requestMock.mockResolvedValue({ data: { ok: true } });
		const persisted = vi.fn();
		const client = buildFeishuApiClient(
			integration({
				userAccessToken: 'u1',
				userRefreshToken: 'r1',
				userAccessTokenExpiresAt: Date.now() + 30 * 1000, // < 60s leeway
			}),
			persisted
		)!;
		await client.request({ method: 'GET', url: '/x', userToken: true });
		expect(oidcRefreshMock).toHaveBeenCalledTimes(1);
		expect(persisted).toHaveBeenCalledWith(
			expect.objectContaining({ userAccessToken: 'u2', userRefreshToken: 'r2' })
		);
		// withUserAccessToken should now have been called with the NEW token
		const lastCall = withUserAccessTokenMock.mock.calls.at(-1)!;
		expect(lastCall[0]).toBe('u2');
	});

	it('serializes concurrent refreshes with a single in-flight promise', async () => {
		let resolveRefresh: (v: unknown) => void = () => {};
		oidcRefreshMock.mockImplementation(
			() =>
				new Promise((res) => {
					resolveRefresh = res;
				})
		);
		requestMock.mockResolvedValue({ data: { ok: true } });
		const client = buildFeishuApiClient(
			integration({
				userAccessToken: 'u',
				userRefreshToken: 'r',
				userAccessTokenExpiresAt: 1, // expired
			})
		)!;
		const p1 = client.request({ method: 'GET', url: '/a', userToken: true });
		const p2 = client.request({ method: 'GET', url: '/b', userToken: true });
		// Yield to allow both to enter ensureFreshUserToken.
		await Promise.resolve();
		expect(oidcRefreshMock).toHaveBeenCalledTimes(1);
		resolveRefresh({ data: { access_token: 'u2', refresh_token: 'r2', expires_in: 3600 } });
		await Promise.all([p1, p2]);
		expect(oidcRefreshMock).toHaveBeenCalledTimes(1);
	});

	it('on 99991663 it refreshes and retries the original request once', async () => {
		const tokenError = Object.assign(new Error('expired'), { code: 99991663 });
		requestMock
			.mockRejectedValueOnce(tokenError)
			.mockResolvedValueOnce({ data: { ok: true } });
		oidcRefreshMock.mockResolvedValue({
			data: { access_token: 'u2', refresh_token: 'r2', expires_in: 3600 },
		});
		const client = buildFeishuApiClient(
			integration({
				userAccessToken: 'u1',
				userRefreshToken: 'r1',
				userAccessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
			})
		)!;
		const res = await client.request<{ data: { ok: boolean } }>({
			method: 'GET',
			url: '/x',
			userToken: true,
		});
		expect(res.data.ok).toBe(true);
		expect(requestMock).toHaveBeenCalledTimes(2);
		expect(oidcRefreshMock).toHaveBeenCalledTimes(1);
	});

	it('rethrows token error if refresh itself fails', async () => {
		const tokenError = Object.assign(new Error('expired'), { code: 99991663 });
		requestMock.mockRejectedValueOnce(tokenError);
		oidcRefreshMock.mockRejectedValueOnce(new Error('refresh boom'));
		const client = buildFeishuApiClient(
			integration({
				userAccessToken: 'u1',
				userRefreshToken: 'r1',
				userAccessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
			})
		)!;
		await expect(client.request({ method: 'GET', url: '/x', userToken: true })).rejects.toThrow('expired');
	});

	it('does not retry on non-token errors', async () => {
		requestMock.mockRejectedValueOnce(new Error('network blew up'));
		const client = buildFeishuApiClient(
			integration({
				userAccessToken: 'u',
				userRefreshToken: 'r',
				userAccessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
			})
		)!;
		await expect(client.request({ method: 'GET', url: '/x', userToken: true })).rejects.toThrow('network blew up');
		expect(oidcRefreshMock).not.toHaveBeenCalled();
	});

	it('skips ensureFreshUserToken when the call does not need a user token', async () => {
		requestMock.mockResolvedValue({ data: { ok: true } });
		const client = buildFeishuApiClient(
			integration({
				userAccessToken: 'u',
				userRefreshToken: 'r',
				userAccessTokenExpiresAt: 1, // would be expired
			})
		)!;
		await client.request({ method: 'GET', url: '/y', userToken: false });
		expect(oidcRefreshMock).not.toHaveBeenCalled();
		expect(withUserAccessTokenMock).not.toHaveBeenCalled();
	});
});
