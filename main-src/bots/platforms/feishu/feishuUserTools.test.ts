import { describe, expect, it, vi } from 'vitest';
import type { ToolCall } from '../../../agent/agentTools.js';
import type { FeishuApiClient } from './feishuApiClient.js';
import { buildFeishuUserHandlers } from './feishuUserTools.js';

function mockClient(opts: { hasUserToken?: boolean; request?: ReturnType<typeof vi.fn> }): FeishuApiClient {
	return {
		lark: null as unknown as FeishuApiClient['lark'],
		userAccessToken: opts.hasUserToken === false ? '' : 'u-token',
		hasUserToken: opts.hasUserToken !== false,
		canRefresh: false,
		request: opts.request ?? vi.fn(),
	};
}

const c = (args: Record<string, unknown> = {}): ToolCall => ({
	id: 'id-u',
	name: 'get_feishu_users',
	arguments: args,
});

describe('feishu user tool', () => {
	it('rejects when user_access_token is missing', async () => {
		const client = mockClient({ hasUserToken: false });
		const res = await buildFeishuUserHandlers(client).get_feishu_users!(c({ queries: [{ query: 'a' }] }));
		expect(res.isError).toBe(true);
	});

	it('rejects when neither queries nor userIdsParam are provided', async () => {
		const client = mockClient({});
		const res = await buildFeishuUserHandlers(client).get_feishu_users!(c({}));
		expect(res.isError).toBe(true);
		expect(res.content).toMatch(/queries.+userIdsParam/);
	});

	it('search path: hits /search/v1/user with the query', async () => {
		const request = vi.fn().mockResolvedValue({
			data: { users: [{ open_id: 'ou_1', name: 'Alice' }], page_token: 'p1', has_more: false },
		});
		const client = mockClient({ request });
		const res = await buildFeishuUserHandlers(client).get_feishu_users!(
			c({ queries: [{ query: 'Alice' }] })
		);
		expect(res.isError).toBe(false);
		const parsed = JSON.parse(res.content);
		expect(parsed.searches[0].query).toBe('Alice');
		expect(parsed.searches[0].users[0].open_id).toBe('ou_1');
		expect(request.mock.calls[0]![0].url).toBe('/open-apis/search/v1/user');
		expect(request.mock.calls[0]![0].userToken).toBe(true);
	});

	it('batch path: groups ids by idType and calls /contact/v3/users/batch per group', async () => {
		const request = vi.fn().mockResolvedValue({ data: { items: [{ name: 'Bob' }] } });
		const client = mockClient({ request });
		const res = await buildFeishuUserHandlers(client).get_feishu_users!(
			c({
				userIdsParam: [
					{ id: 'ou_1', idType: 'open_id' },
					{ id: 'ou_2', idType: 'open_id' },
					{ id: 'union_x', idType: 'union_id' },
				],
			})
		);
		const parsed = JSON.parse(res.content);
		expect(parsed.batches).toHaveLength(2);
		const openCall = request.mock.calls.find(
			(c2) => c2[0].url.includes('user_id_type=open_id')
		);
		const unionCall = request.mock.calls.find(
			(c2) => c2[0].url.includes('user_id_type=union_id')
		);
		expect(openCall).toBeDefined();
		expect(unionCall).toBeDefined();
		// open_id group should contain both ou_ ids in the URL.
		expect(openCall![0].url).toMatch(/user_ids=ou_1.*user_ids=ou_2/);
	});

	it('rejects when queries exceed 20 or userIdsParam exceeds 50', async () => {
		const client = mockClient({});
		const tooManyQ = await buildFeishuUserHandlers(client).get_feishu_users!(
			c({ queries: Array.from({ length: 21 }, (_, i) => ({ query: `q${i}` })) })
		);
		expect(tooManyQ.isError).toBe(true);
		const tooManyIds = await buildFeishuUserHandlers(client).get_feishu_users!(
			c({ userIdsParam: Array.from({ length: 51 }, (_, i) => ({ id: `i${i}` })) })
		);
		expect(tooManyIds.isError).toBe(true);
	});

	it('records per-query error without aborting the whole call', async () => {
		const request = vi
			.fn()
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValueOnce({ data: { users: [{ name: 'C' }], has_more: false } });
		const client = mockClient({ request });
		const res = await buildFeishuUserHandlers(client).get_feishu_users!(
			c({ queries: [{ query: 'a' }, { query: 'b' }] })
		);
		const parsed = JSON.parse(res.content);
		expect(parsed.searches).toHaveLength(2);
		expect(parsed.searches[0].error).toBe('boom');
		expect(parsed.searches[1].users[0].name).toBe('C');
	});
});
