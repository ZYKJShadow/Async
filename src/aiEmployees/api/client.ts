import type { AgentJson, IssueJson, RuntimeJson, SkillJson } from './types';

export type AiEmployeesConnection = {
	apiBaseUrl: string;
	wsBaseUrl: string;
	token: string;
};

function trimSlash(s: string): string {
	return s.replace(/\/+$/, '');
}

export function buildHttpUrl(base: string, path: string): string {
	const b = trimSlash(base);
	const p = path.startsWith('/') ? path : `/${path}`;
	return `${b}${p}`;
}

export function buildWsUrl(base: string, token: string, workspaceId: string): string {
	let raw = base.trim();
	if (!raw.includes('://')) {
		raw = `ws://${raw}`;
	} else if (raw.startsWith('http://')) {
		raw = `ws://${raw.slice('http://'.length)}`;
	} else if (raw.startsWith('https://')) {
		raw = `wss://${raw.slice('https://'.length)}`;
	}
	const u = new URL(raw);
	u.searchParams.set('token', token);
	u.searchParams.set('workspace_id', workspaceId);
	return u.toString();
}

export class AiEmployeesApiError extends Error {
	status: number;
	body: string;
	constructor(status: number, body: string) {
		super(`HTTP ${status}: ${body.slice(0, 200)}`);
		this.status = status;
		this.body = body;
	}
}

export async function apiFetch(
	conn: AiEmployeesConnection,
	path: string,
	init: RequestInit & { workspaceId?: string } = {}
): Promise<Response> {
	const { workspaceId, ...rest } = init;
	const url = buildHttpUrl(conn.apiBaseUrl, path);
	const headers = new Headers(rest.headers);
	if (conn.token.trim()) {
		headers.set('Authorization', `Bearer ${conn.token.trim()}`);
	}
	if (workspaceId) {
		headers.set('X-Workspace-ID', workspaceId);
	}
	return fetch(url, { ...rest, headers });
}

export async function apiGetMe(conn: AiEmployeesConnection): Promise<{ id?: string; email?: string; name?: string }> {
	const r = await apiFetch(conn, '/api/me');
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	return (await r.json()) as { id?: string; email?: string; name?: string };
}

export async function apiListWorkspaces(conn: AiEmployeesConnection): Promise<{ workspaces?: unknown[] } | unknown[]> {
	const r = await apiFetch(conn, '/api/workspaces/');
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	return (await r.json()) as { workspaces?: unknown[] } | unknown[];
}

export async function apiListIssues(conn: AiEmployeesConnection, workspaceId: string): Promise<IssueJson[]> {
	const r = await apiFetch(conn, '/api/issues/', { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { issues?: IssueJson[] } | IssueJson[];
	if (Array.isArray(j)) {
		return j;
	}
	return j.issues ?? [];
}

export async function apiListAgents(conn: AiEmployeesConnection, workspaceId: string): Promise<AgentJson[]> {
	const r = await apiFetch(conn, '/api/agents/', { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { agents?: AgentJson[] } | AgentJson[];
	if (Array.isArray(j)) {
		return j;
	}
	return j.agents ?? [];
}

export async function apiListSkills(conn: AiEmployeesConnection, workspaceId: string): Promise<SkillJson[]> {
	const r = await apiFetch(conn, '/api/skills/', { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { skills?: SkillJson[] } | SkillJson[];
	if (Array.isArray(j)) {
		return j;
	}
	return j.skills ?? [];
}

export async function apiListRuntimes(conn: AiEmployeesConnection, workspaceId: string): Promise<RuntimeJson[]> {
	const r = await apiFetch(conn, '/api/runtimes/', { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { runtimes?: RuntimeJson[] } | RuntimeJson[];
	if (Array.isArray(j)) {
		return j;
	}
	return j.runtimes ?? [];
}
