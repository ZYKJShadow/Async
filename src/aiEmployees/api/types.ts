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
	due_date?: string | null;
};

export type AgentJson = {
	id: string;
	name: string;
	status?: string;
	workspace_id?: string;
};

export type SkillFileJson = {
	id: string;
	skill_id: string;
	path: string;
	content: string;
	created_at?: string;
};

export type SkillJson = {
	id: string;
	name: string;
	workspace_id?: string;
	description?: string;
	content?: string;
	config?: Record<string, unknown>;
	files?: SkillFileJson[];
	created_at?: string;
	updated_at?: string;
};

export type CreateSkillPayload = {
	name: string;
	description?: string;
	content?: string;
	config?: Record<string, unknown>;
	files?: { path: string; content: string }[];
};

export type UpdateSkillPayload = Partial<CreateSkillPayload>;

export type SetAgentSkillsPayload = {
	skill_ids: string[];
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

export type InboxItemSeverity = 'action_required' | 'attention' | 'info';

export type InboxItemJson = {
	id: string;
	workspace_id: string;
	recipient_type: 'member' | 'agent';
	recipient_id: string;
	type: string;
	severity: InboxItemSeverity;
	issue_id?: string | null;
	title: string;
	body?: string | null;
	read: boolean;
	archived: boolean;
	created_at: string;
};

export type ChatSessionStatus = 'active' | 'archived';

export type ChatSessionJson = {
	id: string;
	workspace_id: string;
	agent_id: string;
	creator_id: string;
	title: string;
	session_id?: string | null;
	work_dir?: string | null;
	status: ChatSessionStatus;
	created_at: string;
	updated_at: string;
};

export type ChatMessageRole = 'user' | 'assistant';

export type ChatMessageJson = {
	id: string;
	chat_session_id: string;
	role: ChatMessageRole;
	content: string;
	task_id?: string | null;
	created_at: string;
};

export type ChatBindingProvider = 'telegram' | 'feishu' | 'discord';
export type ChatBindingStatus = 'active' | 'disabled';

export type ChatBindingJson = {
	id: string;
	employee_id: string;
	provider: ChatBindingProvider;
	external_user_id: string;
	external_handle?: string | null;
	channel_id?: string | null;
	status: ChatBindingStatus;
	config: Record<string, unknown>;
	created_at: string;
};

// Phase 10: Task queue observability
export type AgentTaskStatus = 'queued' | 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled';

export type AgentTaskJson = {
	id: string;
	agent_id: string;
	issue_id?: string | null;
	chat_session_id?: string | null;
	status: AgentTaskStatus;
	priority: number;
	error?: string | null;
	result?: Record<string, unknown> | null;
	handoff_from_task_id?: string | null;
	created_at: string;
	dispatched_at?: string | null;
	started_at?: string | null;
	completed_at?: string | null;
};
