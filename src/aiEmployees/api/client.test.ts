import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	AiEmployeesApiError,
	apiGetMe,
	apiListIssues,
	apiListWorkspaces,
	buildHttpUrl,
	buildWsUrl,
} from './client';

describe('buildHttpUrl', () => {
	it('strips trailing slashes on base and joins path', () => {
		expect(buildHttpUrl('http://127.0.0.1:8080/', '/api/me')).toBe('http://127.0.0.1:8080/api/me');
		expect(buildHttpUrl('http://127.0.0.1:8080', 'api/me')).toBe('http://127.0.0.1:8080/api/me');
	});
});

describe('buildWsUrl', () => {
	it('adds ws scheme and query token + workspace_id', () => {
		const u = new URL(buildWsUrl('127.0.0.1:8080/ws', 'tok', 'b0000001-0001-4000-8000-000000000001'));
		expect(u.protocol).toBe('ws:');
		expect(u.host).toBe('127.0.0.1:8080');
		expect(u.pathname).toBe('/ws');
		expect(u.searchParams.get('token')).toBe('tok');
		expect(u.searchParams.get('workspace_id')).toBe('b0000001-0001-4000-8000-000000000001');
	});

	it('maps http base to ws', () => {
		const u = new URL(buildWsUrl('http://localhost:8080/ws', 'a', '00000000-0000-0000-0000-000000000001'));
		expect(u.protocol).toBe('ws:');
		expect(u.host).toBe('localhost:8080');
	});

	it('maps https base to wss', () => {
		const u = new URL(buildWsUrl('https://api.example.com/ws', 't', '00000000-0000-0000-0000-000000000001'));
		expect(u.protocol).toBe('wss:');
	});
});

describe('AiEmployeesApiError', () => {
	it('exposes status and body', () => {
		const e = new AiEmployeesApiError(401, 'unauthorized');
		expect(e.status).toBe(401);
		expect(e.body).toBe('unauthorized');
		expect(e.message).toContain('401');
	});
});

describe('api* with mocked fetch', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	const conn = { apiBaseUrl: 'http://127.0.0.1:9', wsBaseUrl: 'ws://127.0.0.1:9/ws', token: 'dev' };

	it('apiGetMe throws AiEmployeesApiError on non-OK', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 401,
				text: async () => 'nope',
			})
		);
		await expect(apiGetMe(conn)).rejects.toMatchObject({ status: 401, body: 'nope' });
		expect(fetch).toHaveBeenCalledWith(
			'http://127.0.0.1:9/api/me',
			expect.objectContaining({
				headers: expect.any(Headers),
			})
		);
		const h = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers as Headers;
		expect(h.get('Authorization')).toBe('Bearer dev');
	});

	it('apiGetMe returns JSON on OK', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ id: 'u1', email: 'a@b.c' }),
			})
		);
		await expect(apiGetMe(conn)).resolves.toEqual({ id: 'u1', email: 'a@b.c' });
	});

	it('apiListWorkspaces uses trailing slash path', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => [{ id: 'w1' }],
			})
		);
		await apiListWorkspaces(conn);
		expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:9/api/workspaces/', expect.any(Object));
	});

	it('apiListIssues sets X-Workspace-ID', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ issues: [{ id: 'i1', title: 't', status: 'open' }], total: 1 }),
			})
		);
		const issues = await apiListIssues(conn, 'ws-uuid');
		expect(issues).toHaveLength(1);
		const opts = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
		expect((opts.headers as Headers).get('X-Workspace-ID')).toBe('ws-uuid');
	});

	it('apiListIssues accepts bare array response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => [{ id: 'x', title: 'y', status: 'z' }],
			})
		);
		const issues = await apiListIssues(conn, 'w');
		expect(issues).toHaveLength(1);
	});

	it('apiListIssues appends assignee query params for server-side My Issues', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ issues: [], total: 0 }),
			})
		);
		await apiListIssues(conn, 'ws-1', {
			assigneeMemberId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
			assigneeAgentIds: ['11111111-2222-3333-4444-555555555555'],
		});
		const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(url).toContain('/api/issues/?');
		expect(url).toContain('assignee_member_id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
		expect(url).toContain('assignee_agent_ids=');
		expect(decodeURIComponent(url)).toContain('11111111-2222-3333-4444-555555555555');
	});
});
