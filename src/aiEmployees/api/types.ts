/** 与 async-agent-proxy 广播事件名一致；以 `wsEventNames` 为单一事实来源。 */
import type { AiEmployeesWsEventName } from './wsEventNames';

export type WSEventType = AiEmployeesWsEventName;

export type WSMessage<T = unknown> = {
	type: WSEventType | string;
	payload: T;
	actor_id?: string;
};

export type IssueJson = {
	id: string;
	workspace_id?: string;
	title: string;
	description?: string | null;
	status: string;
	priority?: string;
	created_at?: string;
	updated_at?: string;
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
