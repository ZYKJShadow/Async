import type {
	AgentJson,
	CreateIssuePayload,
	IssueJson,
	RuntimeJson,
	SkillJson,
	TaskJson,
	TaskMessageJson,
	WorkspaceMemberJson,
} from './types';

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

export type ListIssuesQueryOptions = {
	assigneeMemberId?: string;
	assigneeAgentIds?: string[];
	creatorId?: string;
};

export async function apiListIssues(
	conn: AiEmployeesConnection,
	workspaceId: string,
	query?: ListIssuesQueryOptions
): Promise<IssueJson[]> {
	const params = new URLSearchParams();
	if (query?.assigneeMemberId) {
		params.set('assignee_member_id', query.assigneeMemberId);
	}
	if (query?.assigneeAgentIds?.length) {
		params.set('assignee_agent_ids', query.assigneeAgentIds.join(','));
	}
	if (query?.creatorId) {
		params.set('creator_id', query.creatorId);
	}
	const qs = params.toString();
	const path = qs ? `/api/issues/?${qs}` : '/api/issues/';
	const r = await apiFetch(conn, path, { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { issues?: IssueJson[] } | IssueJson[];
	return Array.isArray(j) ? j : (j.issues ?? []);
}

export async function apiListMembers(conn: AiEmployeesConnection, workspaceId: string): Promise<WorkspaceMemberJson[]> {
	const r = await apiFetch(conn, '/api/members/', { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { members?: WorkspaceMemberJson[] };
	return j.members ?? [];
}

export async function apiPatchIssue(
	conn: AiEmployeesConnection,
	workspaceId: string,
	issueId: string,
	patch: Record<string, unknown>
): Promise<IssueJson> {
	const r = await apiFetch(conn, `/api/issues/${issueId}`, {
		method: 'PATCH',
		workspaceId,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch),
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { issue?: IssueJson };
	if (!j.issue) {
		throw new AiEmployeesApiError(r.status, 'missing issue in response');
	}
	return j.issue;
}

export async function apiCreateIssue(
	conn: AiEmployeesConnection,
	workspaceId: string,
	body: CreateIssuePayload
): Promise<IssueJson> {
	const r = await apiFetch(conn, '/api/issues/', {
		method: 'POST',
		workspaceId,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { issue?: IssueJson };
	if (!j.issue) {
		throw new AiEmployeesApiError(r.status, 'missing issue in response');
	}
	return j.issue;
}

export async function apiListAgents(conn: AiEmployeesConnection, workspaceId: string): Promise<AgentJson[]> {
	const r = await apiFetch(conn, '/api/agents/', { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { agents?: AgentJson[] } | AgentJson[];
	return Array.isArray(j) ? j : (j.agents ?? []);
}

export async function apiListSkills(conn: AiEmployeesConnection, workspaceId: string): Promise<SkillJson[]> {
	const r = await apiFetch(conn, '/api/skills/', { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { skills?: SkillJson[] } | SkillJson[];
	return Array.isArray(j) ? j : (j.skills ?? []);
}

export async function apiListRuntimes(conn: AiEmployeesConnection, workspaceId: string): Promise<RuntimeJson[]> {
	const r = await apiFetch(conn, '/api/runtimes/', { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { runtimes?: RuntimeJson[] } | RuntimeJson[];
	return Array.isArray(j) ? j : (j.runtimes ?? []);
}

export async function apiListTasks(
	conn: AiEmployeesConnection,
	workspaceId: string,
	query: { issueId?: string; agentId?: string; taskId?: string }
): Promise<TaskJson[]> {
	const params = new URLSearchParams();
	if (query.issueId) {
		params.set('issue_id', query.issueId);
	}
	if (query.agentId) {
		params.set('agent_id', query.agentId);
	}
	if (query.taskId) {
		params.set('task_id', query.taskId);
	}
	const path = params.size ? `/api/tasks?${params.toString()}` : '/api/tasks';
	const r = await apiFetch(conn, path, { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { tasks?: TaskJson[] } | TaskJson[];
	return Array.isArray(j) ? j : (j.tasks ?? []);
}

export async function apiListTaskMessages(
	conn: AiEmployeesConnection,
	workspaceId: string,
	taskId: string
): Promise<TaskMessageJson[]> {
	const r = await apiFetch(conn, `/api/tasks/${taskId}/messages`, { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { messages?: TaskMessageJson[] } | TaskMessageJson[];
	return Array.isArray(j) ? j : (j.messages ?? []);
}
