import type {
	AgentJson,
	AgentTaskJson,
	AgentTaskStatus,
	ChatBindingJson,
	ChatBindingProvider,
	ChatMessageJson,
	ChatSessionJson,
	CreateIssuePayload,
	InboxItemJson,
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

// ── Inbox API ─────────────────────────────────────────────────────────────────

export type ListInboxOptions = {
	read?: boolean;
	archived?: boolean;
};

export async function apiListInboxItems(
	conn: AiEmployeesConnection,
	workspaceId: string,
	options?: ListInboxOptions
): Promise<InboxItemJson[]> {
	const params = new URLSearchParams();
	if (options?.read !== undefined) {
		params.set('read', String(options.read));
	}
	if (options?.archived !== undefined) {
		params.set('archived', String(options.archived));
	}
	const qs = params.toString();
	const path = qs ? `/api/inbox/?${qs}` : '/api/inbox/';
	const r = await apiFetch(conn, path, { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { items?: InboxItemJson[] };
	return j.items ?? [];
}

export async function apiPatchInboxItem(
	conn: AiEmployeesConnection,
	workspaceId: string,
	itemId: string,
	patch: { read?: boolean; archived?: boolean }
): Promise<void> {
	const r = await apiFetch(conn, `/api/inbox/${itemId}`, {
		method: 'PATCH',
		workspaceId,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch),
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
}

export async function apiBatchInbox(
	conn: AiEmployeesConnection,
	workspaceId: string,
	itemIds: string[],
	action: 'read' | 'archived'
): Promise<number> {
	const r = await apiFetch(conn, '/api/inbox/batch', {
		method: 'POST',
		workspaceId,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ item_ids: itemIds, action }),
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { updated?: number };
	return j.updated ?? 0;
}

// ── Chat Session API ───────────────────────────────────────────────────────────

export async function apiCreateChatSession(
	conn: AiEmployeesConnection,
	workspaceId: string,
	body: { agent_id: string; title?: string; session_id?: string; work_dir?: string }
): Promise<ChatSessionJson> {
	const r = await apiFetch(conn, '/api/chat/sessions', {
		method: 'POST',
		workspaceId,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { session?: ChatSessionJson };
	if (!j.session) {
		throw new AiEmployeesApiError(r.status, 'missing session in response');
	}
	return j.session;
}

export async function apiListChatSessions(
	conn: AiEmployeesConnection,
	workspaceId: string
): Promise<ChatSessionJson[]> {
	const r = await apiFetch(conn, '/api/chat/sessions', { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { sessions?: ChatSessionJson[] };
	return j.sessions ?? [];
}

export async function apiListChatMessages(
	conn: AiEmployeesConnection,
	workspaceId: string,
	sessionId: string
): Promise<ChatMessageJson[]> {
	const r = await apiFetch(conn, `/api/chat/sessions/${sessionId}/messages`, { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { messages?: ChatMessageJson[] };
	return j.messages ?? [];
}

export async function apiCreateChatMessage(
	conn: AiEmployeesConnection,
	workspaceId: string,
	sessionId: string,
	body: { role: 'user' | 'assistant'; content: string; task_id?: string }
): Promise<ChatMessageJson> {
	const r = await apiFetch(conn, `/api/chat/sessions/${sessionId}/messages`, {
		method: 'POST',
		workspaceId,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { message?: ChatMessageJson };
	if (!j.message) {
		throw new AiEmployeesApiError(r.status, 'missing message in response');
	}
	return j.message;
}

export async function apiDoneChatSession(
	conn: AiEmployeesConnection,
	workspaceId: string,
	sessionId: string
): Promise<void> {
	const r = await apiFetch(conn, `/api/chat/sessions/${sessionId}/done`, {
		method: 'POST',
		workspaceId,
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
}

// ── Employee Chat Binding API ──────────────────────────────────────────────────

export async function apiListChatBindings(
	conn: AiEmployeesConnection,
	workspaceId: string,
	employeeId: string
): Promise<ChatBindingJson[]> {
	const r = await apiFetch(conn, `/api/employees/${employeeId}/chat-bindings`, { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { bindings?: ChatBindingJson[] };
	return j.bindings ?? [];
}

export async function apiCreateChatBinding(
	conn: AiEmployeesConnection,
	workspaceId: string,
	employeeId: string,
	body: {
		provider: ChatBindingProvider;
		external_user_id: string;
		external_handle?: string;
		channel_id?: string;
		config?: Record<string, unknown>;
	}
): Promise<ChatBindingJson> {
	const r = await apiFetch(conn, `/api/employees/${employeeId}/chat-bindings`, {
		method: 'POST',
		workspaceId,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { binding?: ChatBindingJson };
	if (!j.binding) {
		throw new AiEmployeesApiError(r.status, 'missing binding in response');
	}
	return j.binding;
}

export async function apiDeleteChatBinding(
	conn: AiEmployeesConnection,
	workspaceId: string,
	employeeId: string,
	bindingId: string
): Promise<void> {
	const r = await apiFetch(conn, `/api/employees/${employeeId}/chat-bindings/${bindingId}`, {
		method: 'DELETE',
		workspaceId,
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
}

export async function apiPostImReply(
	conn: AiEmployeesConnection,
	workspaceId: string,
	employeeId: string,
	body: {
		im_provider: string;
		im_chat_id: string;
		content: string;
		session_id?: string;
	}
): Promise<void> {
	const r = await apiFetch(conn, `/api/employees/${employeeId}/im-reply`, {
		method: 'POST',
		workspaceId,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
}

// Phase 10: Task queue observability

export async function apiListWorkspaceTasks(
	conn: AiEmployeesConnection,
	workspaceId: string,
	options?: { status?: AgentTaskStatus; agentId?: string; limit?: number }
): Promise<AgentTaskJson[]> {
	const params = new URLSearchParams();
	if (options?.status) params.set('status', options.status);
	if (options?.agentId) params.set('agent_id', options.agentId);
	if (options?.limit) params.set('limit', String(options.limit));
	const qs = params.toString();
	const r = await apiFetch(conn, `/api/workspaces/${workspaceId}/tasks${qs ? `?${qs}` : ''}`, { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { items: AgentTaskJson[] };
	return j.items ?? [];
}

export async function apiGetTask(
	conn: AiEmployeesConnection,
	workspaceId: string,
	taskId: string
): Promise<AgentTaskJson> {
	const r = await apiFetch(conn, `/api/workspaces/${workspaceId}/tasks/${taskId}`, { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	return (await r.json()) as AgentTaskJson;
}
