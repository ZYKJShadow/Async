import type { ComposerMode } from './ComposerPlusMenu';
import type { AgentSessionSnapshot, AgentUserInputRequest } from './agentSessionTypes';

/** 与 main-src/llm/types.ts TurnTokenUsage 保持一致（渲染端独立定义，避免跨进程 import） */
export type TurnTokenUsage = {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
};

/** 与 main-src/settingsStore 一致 */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export const THINKING_EFFORT_IDS: Exclude<ThinkingLevel, 'off'>[] = ['low', 'medium', 'high', 'max'];

const ALL_THINKING: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'max'];

export function coerceThinkingLevel(v: unknown): ThinkingLevel {
	const s = typeof v === 'string' ? v.toLowerCase().trim() : 'off';
	if (s === 'minimal') return 'low';
	return ALL_THINKING.includes(s as ThinkingLevel) ? (s as ThinkingLevel) : 'off';
}

export function coerceThinkingByModelId(raw: unknown): Record<string, ThinkingLevel> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {};
	}
	const out: Record<string, ThinkingLevel> = {};
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		out[k] = coerceThinkingLevel(v);
	}
	return out;
}

/** Agent 审阅：主进程解析出的待应用 unified diff 块 */
export type AgentPendingPatch = {
	id: string;
	chunk: string;
	relPath: string | null;
};

/** 子 Agent 嵌套流：与主线程事件共用 type，凭 parentToolCallId 区分 */
export type ChatStreamNest = { parentToolCallId?: string; nestingDepth?: number };

/** 与渲染端 ipcStreamNonceRef 对齐，丢弃被 abort 的前一轮迟到 done/error */
export type ChatStreamNonce = { streamNonce?: number };

export type TeamRoleScope = {
	teamTaskId: string;
	teamExpertId: string;
	teamRoleKind: 'specialist' | 'reviewer' | 'lead';
	teamExpertName: string;
	teamRoleType: 'team_lead' | 'frontend' | 'backend' | 'qa' | 'reviewer' | 'custom';
};

type ChatStreamPayloadCore =
	| ({ threadId: string; type: 'delta'; text: string; teamRoleScope?: TeamRoleScope } & ChatStreamNest)
	| {
			threadId: string;
			type: 'done';
			text: string;
			pendingAgentPatches?: AgentPendingPatch[];
			usage?: TurnTokenUsage;
			teamRoleScope?: TeamRoleScope;
	  }
	| { threadId: string; type: 'error'; message: string; teamRoleScope?: TeamRoleScope }
	| ({ threadId: string; type: 'tool_call'; name: string; args: string; toolCallId: string; teamRoleScope?: TeamRoleScope } & ChatStreamNest)
	| ({
			threadId: string;
			type: 'tool_result';
			name: string;
			result: string;
			success: boolean;
			toolCallId: string;
			teamRoleScope?: TeamRoleScope;
	  } & ChatStreamNest)
	| ({
			threadId: string;
			type: 'tool_input_delta';
			name: string;
			partialJson: string;
			index: number;
			teamRoleScope?: TeamRoleScope;
	  } & ChatStreamNest)
	| ({ threadId: string; type: 'thinking_delta'; text: string; teamRoleScope?: TeamRoleScope } & ChatStreamNest)
	| ({
			threadId: string;
			type: 'tool_progress';
			name: string;
			phase: string;
			detail?: string;
			teamRoleScope?: TeamRoleScope;
	  } & ChatStreamNest)
	| {
			threadId: string;
			type: 'tool_approval_request';
			approvalId: string;
			toolName: string;
			command?: string;
			path?: string;
	  }
	| {
			threadId: string;
			type: 'plan_question_request';
			requestId: string;
			question: { text: string; options: { id: string; label: string }[]; freeform?: boolean };
			teamRoleScope?: TeamRoleScope;
	  }
	| {
			threadId: string;
			type: 'user_input_request';
			request: AgentUserInputRequest;
			teamRoleScope?: TeamRoleScope;
	  }
	| {
			threadId: string;
			type: 'agent_mistake_limit';
			recoveryId: string;
			consecutiveFailures: number;
			threshold: number;
	  }
	| {
			threadId: string;
			type: 'sub_agent_background_done';
			parentToolCallId: string;
			agentId: string;
			result: string;
			success: boolean;
	  }
	| {
			threadId: string;
			type: 'agent_session_sync';
			session: AgentSessionSnapshot;
	  }
	| {
			threadId: string;
			type: 'team_phase';
			phase: 'researching' | 'planning' | 'preflight' | 'proposing' | 'executing' | 'reviewing' | 'delivering' | 'cancelled';
	  }
	| {
			threadId: string;
			type: 'team_task_created';
			task: {
				id: string;
				expertId: string;
				expertAssignmentKey?: string;
				expertName: string;
				roleType: 'team_lead' | 'frontend' | 'backend' | 'qa' | 'reviewer' | 'custom';
				description: string;
				status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'revision';
				dependencies?: string[];
				acceptanceCriteria?: string[];
			};
	  }
	| {
			threadId: string;
			type: 'team_expert_started';
			taskId: string;
			expertId: string;
	  }
	| {
			threadId: string;
			type: 'team_expert_progress';
			taskId: string;
			expertId: string;
			message?: string;
			delta?: string;
	  }
	| {
			threadId: string;
			type: 'team_expert_done';
			taskId: string;
			expertId: string;
			success: boolean;
			result: string;
	  }
	| {
			threadId: string;
			type: 'team_review';
			verdict: 'approved' | 'revision_needed';
			summary: string;
	  }
	| {
			threadId: string;
			type: 'team_plan_summary';
			summary: string;
	  }
	| {
			threadId: string;
			type: 'team_preflight_review';
			verdict: 'ok' | 'needs_clarification';
			summary: string;
	  }
	| {
			threadId: string;
			type: 'team_plan_proposed';
			proposalId: string;
			summary: string;
			tasks: Array<{
				expert: string;
				expertName: string;
				roleType: 'team_lead' | 'frontend' | 'backend' | 'qa' | 'reviewer' | 'custom';
				task: string;
				dependencies?: string[];
				acceptanceCriteria?: string[];
			}>;
			preflightSummary?: string;
			preflightVerdict?: 'ok' | 'needs_clarification';
	  }
	| {
			threadId: string;
			type: 'team_plan_decision';
			proposalId: string;
			approved: boolean;
	  }
	| {
			threadId: string;
			type: 'team_plan_revised';
			revisionId: string;
			summary: string;
			reason: string;
			tasks: Array<{
				id: string;
				expertId: string;
				expert: string;
				expertAssignmentKey?: string;
				expertName: string;
				roleType: 'team_lead' | 'frontend' | 'backend' | 'qa' | 'reviewer' | 'custom';
				task: string;
				dependencies?: string[];
				acceptanceCriteria?: string[];
			}>;
			addedTaskIds: string[];
			removedTaskIds: string[];
			keptTaskIds: string[];
	  };

export type ChatStreamPayload = ChatStreamPayloadCore & ChatStreamNonce;

/** Skill 创建向导：用户输入在 `userNote`；主进程注入内置系统提示并写入简短可见气泡 */
export type ChatSkillCreatorPayload = {
	userNote: string;
	scope: 'user' | 'project';
};

/** Rule 创建向导 */
export type ChatRuleCreatorPayload = {
	userNote: string;
	ruleScope: 'always' | 'glob' | 'manual';
	globPattern?: string;
};

/** Subagent 创建向导 */
export type ChatSubagentCreatorPayload = {
	userNote: string;
	scope: 'user' | 'project';
};

/** Plan Build：主进程将计划全文注入系统上下文（优先读磁盘），短文本仅作用户可见气泡 */
export type ChatPlanExecutePayload = {
	fromAbsPath?: string;
	inlineMarkdown?: string;
	planTitle?: string;
};

/** `chat:send` IPC 载荷（与主进程一致） */
export type ChatSendPayload = {
	threadId: string;
	text: string;
	mode?: ComposerMode;
	/** `auto` 或用户模型条目 id */
	modelId?: string;
	/** 与 `text` 二选一：走 Skill Creator 分支时传此项，`text` 可为空字符串 */
	skillCreator?: ChatSkillCreatorPayload;
	ruleCreator?: ChatRuleCreatorPayload;
	subagentCreator?: ChatSubagentCreatorPayload;
	planExecute?: ChatPlanExecutePayload;
	/** 与 beginStream 同步递增，防止快速连发时前一轮迟到的 done 清空新一轮流 */
	streamNonce?: number;
};

/** `plan:save` IPC 载荷 */
export type PlanSavePayload = {
	filename: string;
	content: string;
};

/** `plan:save` IPC 返回值 */
export type PlanSaveResult = {
	ok: boolean;
	path?: string;
	/** 工作区内相对路径（`.async/plans/...`），便于在编辑器中打开 */
	relPath?: string;
	error?: string;
};

/** 与 `usageStats:get` 主进程返回一致 */
export type UsageStatsAgentDay = { add: number; del: number };

export type UsageStatsTokenEvent = {
	at: number;
	modelId: string;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	mode?: string;
};

export type UsageStatsGetResponse =
	| { ok: true; dataDir: string; agentLineByDay: Record<string, UsageStatsAgentDay>; tokenEvents: UsageStatsTokenEvent[] }
	| { ok: false; reason: 'disabled' }
	| { ok: false; reason: 'no-directory' };

/** 自动更新状态（与 main-src/autoUpdate.ts 保持一致） */
export type AutoUpdateStatus =
	| { state: 'idle' }
	| { state: 'checking' }
	| { state: 'available'; info: { version: string; releaseDate?: string; releaseNotes?: string } }
	| { state: 'not-available' }
	| { state: 'downloading'; progress: { percent: number; bytesPerSecond: number; total: number; transferred: number } }
	| { state: 'downloaded' }
	| { state: 'error'; message: string };
