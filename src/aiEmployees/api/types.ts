/** 与 async-agent-proxy 广播事件名一致；以 `wsEventNames` 为单一事实来源。 */
import type { AiEmployeesWsEventName } from './wsEventNames';

export type WSEventType = AiEmployeesWsEventName;

export type WSMessage<T = unknown> = {
	type: WSEventType | string;
	payload: T;
	actor_id?: string;
};

/** 与 async-agent-proxy `issue` 列表/详情 JSON 对齐 */
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
