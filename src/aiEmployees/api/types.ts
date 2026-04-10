/** Shared frontend JSON contracts for async-agent-proxy. */
import type { AiEmployeesWsEventName } from './wsEventNames';

export type WSEventType = AiEmployeesWsEventName;

export type WSMessage<T = unknown> = {
	type: WSEventType | string;
	payload: T;
	actor_id?: string;
};

export type IssueAssigneeType = 'member' | 'agent';

export type IssueJson = {
	id: string;
	workspace_id?: string;
	number?: number;
	identifier?: string;
	title: string;
	description?: string | null;
	status: string;
	priority?: string;
	assignee_type?: IssueAssigneeType | string | null;
	assignee_id?: string | null;
	creator_type?: string;
	creator_id?: string;
	parent_issue_id?: string | null;
	project_id?: string | null;
	position?: number;
	due_date?: string | null;
	created_at?: string;
	updated_at?: string;
};

export type WorkspaceMemberJson = {
	user_id: string;
	name: string;
	email: string;
};

export type CreateIssuePayload = {
	title: string;
	description?: string;
	parent_issue_id?: string;
	assignee_type?: IssueAssigneeType;
	assignee_id?: string;
	status?: string;
	priority?: string;
};

export type AgentJson = {
	id: string;
	name: string;
	status?: string;
	workspace_id?: string;
};

export type SkillJson = {
	id: string;
	name: string;
	workspace_id?: string;
};

export type RuntimeJson = {
	id: string;
	name?: string;
	status?: string;
	owner_id?: string;
	provider?: string;
	runtime_mode?: string;
	last_seen_at?: string;
	device_info?: string;
	daemon_id?: string;
	created_at?: string;
	updated_at?: string;
	metadata?: Record<string, unknown>;
};

export type TaskJson = {
	id: string;
	workspace_id?: string;
	issue_id?: string | null;
	agent_id: string;
	status: string;
	priority?: number;
	dispatched_at?: string | null;
	started_at?: string | null;
	completed_at?: string | null;
	created_at?: string;
	summary?: string;
	result?: Record<string, unknown> | null;
	error?: string | null;
};

export type TaskMessageJson = {
	id: string;
	task_id: string;
	seq: number;
	type: string;
	tool?: string | null;
	content?: string | null;
	input?: Record<string, unknown> | null;
	output?: string | null;
	created_at: string;
	summary?: string;
};
