/**
 * Persisted AI Employees settings stored under settings.json.aiEmployees.
 * Shared between the desktop shell and renderer.
 */

export type AiEmployeeChatAccountRef = {
	provider: 'feishu' | 'telegram' | 'discord';
	handle: string;
	note?: string;
};

export type AiEmployeeCatalogEntry = {
	id: string;
	displayName: string;
	role: string;
	description?: string;
	modelSource: 'local_model' | 'remote_runtime' | 'hybrid';
	linkedRemoteAgentId?: string;
	managerEmployeeId?: string;
	capabilities?: string[];
	chatAccounts?: AiEmployeeChatAccountRef[];
};

export type AiOrchestrationHandoffStatus = 'pending' | 'in_progress' | 'blocked' | 'done';

export type AiOrchestrationApprovalState = 'none' | 'pending_git' | 'pending_handoff' | 'rejected' | 'approved';

export type AiCollabMessageType =
	| 'text'
	| 'task_assignment'
	| 'handoff_request'
	| 'status_update'
	| 'blocker'
	| 'approval_request'
	| 'approval_response'
	| 'result';

export type AiCollabCardStatus =
	| 'pending'
	| 'in_progress'
	| 'done'
	| 'blocked'
	| 'approved'
	| 'rejected';

export type AiCollabCardAction = {
	label: string;
	action: string;
};

export type AiCollabCardMeta = {
	issueId?: string;
	issueTitle?: string;
	handoffId?: string;
	status?: AiCollabCardStatus;
	actionable?: boolean;
	actions?: AiCollabCardAction[];
};

export type AiCollabMessage = {
	id: string;
	runId: string;
	type: AiCollabMessageType;
	fromEmployeeId?: string;
	toEmployeeId?: string;
	summary: string;
	body: string;
	taskId?: string;
	createdAtIso: string;
	readAtIso?: string;
	cardMeta?: AiCollabCardMeta;
};

export type AiOrchestrationTimelineEventType =
	| 'run_created'
	| 'handoff_added'
	| 'handoff_status'
	| 'status_update'
	| 'message'
	| 'result'
	| 'approval_requested'
	| 'approval_response'
	| 'task_event';

export type AiOrchestrationTimelineEvent = {
	id: string;
	runId: string;
	type: AiOrchestrationTimelineEventType;
	label: string;
	description?: string;
	createdAtIso: string;
	handoffId?: string;
	taskId?: string;
	employeeId?: string;
	status?: string;
	sourceEventType?: string;
	source?: 'local' | 'remote' | 'history';
};

export type AiOrchestrationHandoff = {
	id: string;
	fromEmployeeId?: string;
	toEmployeeId: string;
	status: AiOrchestrationHandoffStatus;
	note?: string;
	atIso: string;
	taskId?: string;
	messageId?: string;
	resultSummary?: string;
	blockedReason?: string;
};

export type AiOrchestrationRunStatus =
	| 'draft'
	| 'running'
	| 'awaiting_approval'
	| 'completed'
	| 'cancelled';

export type AiOrchestrationRun = {
	id: string;
	goal: string;
	targetBranch?: string;
	status: AiOrchestrationRunStatus;
	createdAtIso: string;
	handoffs: AiOrchestrationHandoff[];
	gitApproved?: boolean;
	ownerEmployeeId?: string;
	currentAssigneeEmployeeId?: string;
	statusSummary?: string;
	lastEventAtIso?: string;
	approvalState?: AiOrchestrationApprovalState;
	issueId?: string;
};

export type AiEmployeesOrchestrationState = {
	activeRunId?: string;
	runs: AiOrchestrationRun[];
	timelineEvents: AiOrchestrationTimelineEvent[];
	collabMessages: AiCollabMessage[];
};

/**
 * Tools available to each AI employee for autonomous collaboration.
 * These map to function calls the LLM can invoke during task execution.
 */
export type AiCollabToolName =
	| 'assign_task'
	| 'request_help'
	| 'submit_result'
	| 'request_approval'
	| 'report_blocker'
	| 'send_message';

export type AiCollabToolCall = {
	tool: AiCollabToolName;
	args: Record<string, unknown>;
};

export type AiCollabToolDefinition = {
	name: AiCollabToolName;
	description: string;
	parameters: Record<string, { type: string; description: string; required?: boolean }>;
};

export type AiEmployeesSettings = {
	apiBaseUrl?: string;
	wsBaseUrl?: string;
	token?: string;
	workspaceMap?: Record<string, string>;
	lastRemoteWorkspaceId?: string;
	agentLocalModelIdByRemoteAgentId?: Record<string, string>;
	employeeLocalModelIdByEmployeeId?: Record<string, string>;
	employeeCatalog?: AiEmployeeCatalogEntry[];
	orchestration?: AiEmployeesOrchestrationState;
};
