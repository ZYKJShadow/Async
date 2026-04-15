import { randomUUID } from 'node:crypto';
import type { ChatMessage, TeamSessionSnapshot } from '../threadStore.js';
import type { ShellSettings, TeamRoleType } from '../settingsStore.js';
import type { WorkspaceLspManager } from '../lsp/workspaceLspManager.js';
import { runAgentLoop, type AgentLoopHandlers, type AgentLoopOptions } from './agentLoop.js';
import { assembleAgentToolPool } from './agentToolPool.js';
import { AGENT_TOOLS, isReadOnlyAgentTool, type AgentToolDef } from './agentTools.js';
import { executeAskPlanQuestionTool } from './planQuestionTool.js';
import { resolveTeamExpertProfiles, type TeamExpertRuntimeProfile } from './teamExpertProfiles.js';
import { resolveModelRequest, type ResolvedModelRequest } from '../llm/modelResolve.js';
import { getTeamPreset, getTeamPresetDefaults } from '../../src/teamPresetCatalog.js';
import { buildAutoReplyLanguageRuleBlock } from '../../src/autoReplyLanguageRule.js';
import { flattenAssistantTextPartsForSearch } from '../../src/agentStructuredMessage.js';
import {
	buildTeamPlanProposalId,
	registerTeamPlanApprovalWaiter,
	unregisterTeamPlanApprovalWaiter,
	type TeamPlanApprovalPayload,
} from './teamPlanApprovalTool.js';
import type { ToolExecutionHooks } from './toolExecutor.js';
import {
	teamPlanDecideTool,
	type TeamPlanDecision,
	type TeamPlanDecideTask,
	setTeamPlanDecideRuntime,
} from './teamPlanDecideTool.js';
import {
	teamEscalateToLeadTool,
	type TeamEscalation,
	setTeamEscalationRuntime,
} from './teamEscalateTool.js';
import {
	teamRequestFromPeerTool,
	type TeamPeerRequest,
	setTeamPeerRequestRuntime,
} from './teamPeerRequestTool.js';
import {
	teamReplyToPeerTool,
	type TeamPeerReply,
	setTeamPeerReplyRuntime,
} from './teamReplyToPeerTool.js';

type TeamPhase =
	| 'researching'
	| 'planning'
	| 'preflight'
	| 'proposing'
	| 'executing'
	| 'reviewing'
	| 'delivering'
	| 'cancelled';
type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'revision';

type SpecialistRunResult = {
	success: boolean;
	text: string;
	escalation?: TeamEscalation;
};

type PeerMailboxRequest = {
	requestId: string;
	fromTaskId: string;
	fromExpertId: string;
	fromExpertName: string;
	fromRoleType: TeamRoleType;
	question: string;
	resolve: (answer: string) => void;
	deliveredCount: number;
	timer: ReturnType<typeof setTimeout> | null;
};

export type TeamTask = {
	id: string;
	expertId: string;
	expertAssignmentKey?: string;
	expertName: string;
	roleType: TeamRoleType;
	description: string;
	status: TeamTaskStatus;
	dependencies: string[];
	acceptanceCriteria: string[];
	result?: string;
};

type TeamEmit =
	| { threadId: string; type: 'team_phase'; phase: TeamPhase }
	| {
			threadId: string;
			type: 'delta';
			text: string;
			teamRoleScope: {
				teamTaskId: string;
				teamExpertId: string;
				teamRoleKind: 'specialist' | 'reviewer' | 'lead';
				teamExpertName: string;
				teamRoleType: TeamRoleType;
			};
	  }
	| {
			threadId: string;
			type: 'tool_input_delta';
			name: string;
			partialJson: string;
			index: number;
			teamRoleScope: {
				teamTaskId: string;
				teamExpertId: string;
				teamRoleKind: 'specialist' | 'reviewer' | 'lead';
				teamExpertName: string;
				teamRoleType: TeamRoleType;
			};
	  }
	| {
			threadId: string;
			type: 'thinking_delta';
			text: string;
			teamRoleScope: {
				teamTaskId: string;
				teamExpertId: string;
				teamRoleKind: 'specialist' | 'reviewer' | 'lead';
				teamExpertName: string;
				teamRoleType: TeamRoleType;
			};
	  }
	| {
			threadId: string;
			type: 'tool_progress';
			name: string;
			phase: string;
			detail?: string;
			teamRoleScope: {
				teamTaskId: string;
				teamExpertId: string;
				teamRoleKind: 'specialist' | 'reviewer' | 'lead';
				teamExpertName: string;
				teamRoleType: TeamRoleType;
			};
	  }
	| {
			threadId: string;
			type: 'tool_call';
			name: string;
			args: string;
			toolCallId: string;
			teamRoleScope: {
				teamTaskId: string;
				teamExpertId: string;
				teamRoleKind: 'specialist' | 'reviewer' | 'lead';
				teamExpertName: string;
				teamRoleType: TeamRoleType;
			};
	  }
	| {
			threadId: string;
			type: 'tool_result';
			name: string;
			result: string;
			success: boolean;
			toolCallId: string;
			teamRoleScope: {
				teamTaskId: string;
				teamExpertId: string;
				teamRoleKind: 'specialist' | 'reviewer' | 'lead';
				teamExpertName: string;
				teamRoleType: TeamRoleType;
			};
	  }
	| {
			threadId: string;
			type: 'done';
			text: string;
			usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
			teamRoleScope: {
				teamTaskId: string;
				teamExpertId: string;
				teamRoleKind: 'specialist' | 'reviewer' | 'lead';
				teamExpertName: string;
				teamRoleType: TeamRoleType;
			};
	  }
	| {
			threadId: string;
			type: 'error';
			message: string;
			teamRoleScope: {
				teamTaskId: string;
				teamExpertId: string;
				teamRoleKind: 'specialist' | 'reviewer';
				teamExpertName: string;
				teamRoleType: TeamRoleType;
			};
	  }
	| {
			threadId: string;
			type: 'team_task_created';
			task: {
				id: string;
				expertId: string;
				expertAssignmentKey?: string;
				expertName: string;
				roleType: TeamRoleType;
				description: string;
				status: TeamTaskStatus;
				dependencies?: string[];
				acceptanceCriteria?: string[];
			};
	  }
	| { threadId: string; type: 'team_expert_started'; taskId: string; expertId: string }
	| { threadId: string; type: 'team_expert_progress'; taskId: string; expertId: string; message?: string; delta?: string }
	| { threadId: string; type: 'team_expert_done'; taskId: string; expertId: string; success: boolean; result: string }
	| { threadId: string; type: 'team_review'; verdict: 'approved' | 'revision_needed'; summary: string }
	| { threadId: string; type: 'team_plan_summary'; summary: string }
	| { threadId: string; type: 'team_preflight_review'; verdict: 'ok' | 'needs_clarification'; summary: string }
	| {
			threadId: string;
			type: 'team_plan_proposed';
			proposalId: string;
			summary: string;
			tasks: Array<{
				expert: string;
				expertName: string;
				roleType: TeamRoleType;
				task: string;
				dependencies?: string[];
				acceptanceCriteria?: string[];
			}>;
			preflightSummary?: string;
			preflightVerdict?: 'ok' | 'needs_clarification';
	  }
	| { threadId: string; type: 'team_plan_decision'; proposalId: string; approved: boolean }
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
				roleType: TeamRoleType;
				task: string;
				dependencies?: string[];
				acceptanceCriteria?: string[];
			}>;
			addedTaskIds: string[];
			removedTaskIds: string[];
			keptTaskIds: string[];
	  };

function createTeamRoleScope(task: TeamTask, roleKind: 'specialist' | 'reviewer' | 'lead'): {
	teamTaskId: string;
	teamExpertId: string;
	teamRoleKind: 'specialist' | 'reviewer' | 'lead';
	teamExpertName: string;
	teamRoleType: TeamRoleType;
} {
	return {
		teamTaskId: task.id,
		teamExpertId: task.expertId,
		teamRoleKind: roleKind,
		teamExpertName: task.expertName,
		teamRoleType: task.roleType,
	};
}

function buildReviewerWorkflowTask(
	reviewer: TeamExpertRuntimeProfile,
	description: string,
	dependencies: string[],
	acceptanceCriteria: string[]
): TeamTask {
	return {
		id: `reviewer-${reviewer.assignmentKey || reviewer.id}`,
		expertId: reviewer.id,
		expertAssignmentKey: reviewer.assignmentKey,
		expertName: reviewer.name,
		roleType: reviewer.roleType,
		description,
		status: 'in_progress',
		dependencies,
		acceptanceCriteria,
	};
}

function normalizeTeamAgentSummary(raw: string, fallback: string): string {
	const flattened = flattenAssistantTextPartsForSearch(raw)
		.replace(/\n[ \t]+\n/g, '\n\n')
		.trim();
	if (flattened) {
		return flattened;
	}
	const trimmed = String(raw ?? '')
		.replace(/\n[ \t]+\n/g, '\n\n')
		.trim();
	return trimmed || fallback;
}

function appendTeamLanguageRule(settings: ShellSettings, prompt?: string): string {
	const lang = settings.language === 'en' ? 'en' : 'zh-CN';
	const ruleBlock = buildAutoReplyLanguageRuleBlock(lang, lang);
	const extra = String(prompt ?? '').trim();
	return extra ? `${ruleBlock}\n\n---\n\n${extra}` : ruleBlock;
}

export type TeamOrchestratorInput = {
	settings: ShellSettings;
	threadId: string;
	messages: ChatMessage[];
	modelSelection: string;
	resolvedModel: ResolvedModelRequest & { ok: true };
	agentSystemAppend?: string;
	signal: AbortSignal;
	thinkingLevel?: 'off' | 'low' | 'medium' | 'high' | 'max';
	workspaceRoot?: string | null;
	workspaceLspManager?: WorkspaceLspManager | null;
	hostWebContentsId?: number | null;
	toolHooks?: ToolExecutionHooks;
	emit: (evt: TeamEmit) => void;
	onDone: (fullText: string, usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }, teamSnapshot?: TeamSessionSnapshot) => void;
	onError: (message: string) => void;
};

// ── LLM-based task planning ──────────────────────────────────────────────

type LLMPlannedTask = {
	expert: string;
	task: string;
	dependencies?: string[];
	acceptanceCriteria?: string[];
};

type LeadPlanMode = 'ANSWER' | 'PLAN' | 'CLARIFY';

function toLlmPlannedTasks(tasks: TeamPlanDecideTask[]): LLMPlannedTask[] {
	return tasks.map((task) => ({
		expert: task.expert,
		task: task.task,
		dependencies: task.dependencies ?? [],
		acceptanceCriteria: task.acceptanceCriteria ?? [],
	}));
}

function matchExpert(
	expertKey: string,
	specialists: TeamExpertRuntimeProfile[]
): TeamExpertRuntimeProfile | undefined {
	const key = expertKey.toLowerCase().trim();
	return (
		specialists.find((s) => s.id.toLowerCase() === key) ??
		specialists.find((s) => s.assignmentKey.toLowerCase() === key) ??
		specialists.find((s) => s.roleType === key) ??
		specialists.find((s) => s.name.toLowerCase() === key) ??
		specialists.find((s) => s.roleType.includes(key) || key.includes(s.roleType)) ??
		specialists.find((s) => s.assignmentKey.includes(key) || key.includes(s.assignmentKey))
	);
}

const TEAM_PACKET_TEXT_LIMIT = 4000;
const TEAM_HANDOFF_TEXT_LIMIT = 2200;

function stripFencedBlocks(text: string): string {
	const closed = text.replace(/```[\s\S]*?```/g, '');
	// Also drop a trailing unclosed fence block that is still streaming in.
	const unclosed = closed.replace(/```[\s\S]*$/m, '');
	return unclosed.trim();
}

function stripTrailingRawJson(text: string): string {
	const normalized = text.trim();
	if (!normalized) {
		return '';
	}
	const lines = normalized.split('\n');
	const rawJsonStart = lines.findIndex((line, index) => index > 0 && /^[\s]*[\[{]/.test(line));
	if (rawJsonStart <= 0) {
		return normalized;
	}
	return lines.slice(0, rawJsonStart).join('\n').trim();
}

function extractTeamLeadNarrative(text: string): string {
	const raw = flattenAssistantTextPartsForSearch(String(text ?? ''));
	const normalized = raw.trim();
	if (!normalized) {
		return '';
	}
	const withoutFence = stripFencedBlocks(normalized);
	const withoutJson = stripTrailingRawJson(withoutFence || normalized);
	return (withoutJson || withoutFence || normalized).replace(/\n{3,}/g, '\n\n').trim();
}

function buildFallbackTeamLeadNarrative(hasCjk: boolean): string {
	return hasCjk
		? '我已开始逐个分派合适的成员处理任务，接下来会汇总他们的反馈再向你汇报。'
		: 'I have started assigning the right specialists one by one, and I will report back after collecting their findings.';
}

function buildClarificationNeededNarrative(hasCjk: boolean): string {
	return hasCjk
		? '当前需求还不够具体，我先不分派专家。请补充优化目标（如性能、代码质量、用户体验）、范围（模块 / 页面 / 流程）、限制条件，以及你希望得到的产出。'
		: 'The request is still too broad, so I am not dispatching specialists yet. Please clarify the goal (for example performance, code quality, or UX), the scope (module/page/workflow), any constraints, and the outcome you want.';
}

function buildPlannerToolPool(baseTools: AgentToolDef[]): AgentToolDef[] {
	const readOnly = baseTools.filter((tool) => isReadOnlyAgentTool(tool.name));
	const askPlanQuestion = AGENT_TOOLS.find((tool) => tool.name === 'ask_plan_question');
	return [
		...readOnly,
		...(askPlanQuestion ? [askPlanQuestion] : []),
		teamPlanDecideTool,
	];
}

function normalizeTeamTaskKey(value: string): string {
	return String(value ?? '').trim().toLowerCase();
}

function buildPlanTaskSignature(expertKey: string, task: string): string {
	return `${normalizeTeamTaskKey(expertKey)}::${String(task ?? '').trim()}`;
}

function buildPlanTaskSignatureFromTask(task: TeamTask): string {
	return buildPlanTaskSignature(task.expertAssignmentKey || task.expertId, task.description);
}

function materializePlannedTasks(
	planned: LLMPlannedTask[],
	specialists: TeamExpertRuntimeProfile[],
	existingPendingTasks: TeamTask[] = []
): TeamTask[] {
	const reusableBySignature = new Map<string, TeamTask>();
	for (const task of existingPendingTasks) {
		reusableBySignature.set(buildPlanTaskSignatureFromTask(task), task);
	}

	const prepared = planned.map((plannedTask) => {
		const expert = matchExpert(plannedTask.expert, specialists) ?? specialists[0]!;
		const signature = buildPlanTaskSignature(expert.assignmentKey, plannedTask.task);
		const reusable = reusableBySignature.get(signature);
		return {
			id: reusable?.id ?? `task-${randomUUID()}`,
			expert,
			plannedTask,
		};
	});

	const dependencyIdByKey = new Map<string, string>();
	for (const item of prepared) {
		const keys = [
			item.plannedTask.expert,
			item.expert.assignmentKey,
			item.expert.id,
			item.expert.name,
			item.expert.roleType,
		]
			.map(normalizeTeamTaskKey)
			.filter(Boolean);
		for (const key of keys) {
			if (!dependencyIdByKey.has(key)) {
				dependencyIdByKey.set(key, item.id);
			}
		}
	}

	return prepared.map((item) => ({
		id: item.id,
		expertId: item.expert.id,
		expertAssignmentKey: item.expert.assignmentKey,
		expertName: item.expert.name,
		roleType: item.expert.roleType,
		description: item.plannedTask.task,
		status: 'pending',
		dependencies: (item.plannedTask.dependencies ?? [])
			.map((value) => dependencyIdByKey.get(normalizeTeamTaskKey(value)) ?? '')
			.filter(Boolean),
		acceptanceCriteria: item.plannedTask.acceptanceCriteria ?? [],
	}));
}

function findPeerTask(allTasks: TeamTask[], targetExpertId: string): TeamTask | undefined {
	const key = normalizeTeamTaskKey(targetExpertId);
	return allTasks.find((task) =>
		[
			task.expertId,
			task.expertAssignmentKey,
			task.expertName,
			task.roleType,
		]
			.map(normalizeTeamTaskKey)
			.includes(key)
	);
}

function buildPeerResponse(
	request: TeamPeerRequest,
	completedTasksById: Map<string, TeamTask>,
	allTasks: TeamTask[]
): string {
	const targetTask = findPeerTask(allTasks, request.targetExpertId);
	if (!targetTask) {
		return `No peer specialist matched "${request.targetExpertId}".`;
	}
	const completedTask = completedTasksById.get(targetTask.id);
	if (!completedTask) {
		return `${targetTask.expertName} has not completed their task yet. Only completed peer handoffs are available right now.`;
	}
	return [
		`Peer: ${completedTask.expertName} (${completedTask.roleType})`,
		`Peer task: ${completedTask.description}`,
		`Your question: ${request.question}`,
		'Peer output:',
		clampTeamPacketText(completedTask.result, TEAM_HANDOFF_TEXT_LIMIT),
	].join('\n');
}

function buildPeerMailboxMessages(
	requests: PeerMailboxRequest[],
	task: TeamTask
): ChatMessage[] {
	if (requests.length === 0) {
		return [];
	}
	const body = requests.map((request) => [
		`### Request ${request.requestId}`,
		`From: ${request.fromExpertName} (${request.fromRoleType})`,
		`Question: ${request.question}`,
	].join('\n')).join('\n\n');
	return [
		{
			role: 'user',
			content: [
				'[TEAM PEER REQUESTS]',
				`While you continue ${task.description}, teammates need short answers from you.`,
				'Before continuing, call `team_reply_to_peer` for each requestId below with a concise answer based on your current findings.',
				'If you do not know yet, say what is missing or what assumption the teammate should use.',
				'',
				body,
			].join('\n'),
		},
	];
}

function appendTeamClarificationMessage(messages: ChatMessage[], answer: string): ChatMessage[] {
	return [
		...messages,
		{
			role: 'user',
			content: [
				'[TEAM CLARIFICATION ANSWER]',
				answer,
				'',
				'Continue Team planning using this answer. Do not ask the same clarification again.',
			].join('\n'),
		},
	];
}

function appendEffectiveTeamClarification(userText: string, answer: string): string {
	return [
		userText.trim(),
		'',
		'[TEAM CLARIFICATION ANSWER]',
		answer.trim(),
	].join('\n').trim();
}

function applyTeamClarificationAnswers(
	userText: string,
	messages: ChatMessage[],
	answers: string[]
): { userText: string; messages: ChatMessage[] } {
	let nextUserText = userText;
	let nextMessages = messages;
	for (const rawAnswer of answers) {
		const answer = rawAnswer.trim();
		if (!answer) {
			continue;
		}
		nextUserText = appendEffectiveTeamClarification(nextUserText, answer);
		nextMessages = appendTeamClarificationMessage(nextMessages, answer);
	}
	return { userText: nextUserText, messages: nextMessages };
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
	if (ms <= 0) {
		return;
	}
	if (signal.aborted) {
		throw new Error('Team session aborted by user.');
	}
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			cleanup();
			reject(new Error('Team session aborted by user.'));
		};
		const cleanup = () => signal.removeEventListener('abort', onAbort);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

function clampTeamPacketText(text: string | undefined, maxChars = TEAM_PACKET_TEXT_LIMIT): string {
	const normalized = String(text ?? '').trim();
	if (!normalized) {
		return '(none)';
	}
	if (normalized.length <= maxChars) {
		return normalized;
	}
	return `${normalized.slice(0, Math.max(0, maxChars - 32)).trimEnd()}\n\n[truncated for team context]`;
}

function formatAcceptanceCriteria(criteria: string[]): string {
	if (criteria.length === 0) {
		return '- (none provided)';
	}
	return criteria.map((item) => `- ${item}`).join('\n');
}

function buildDependencyHandoffSection(
	task: TeamTask,
	completedTasksById: Map<string, TeamTask>
): string {
	const items = task.dependencies
		.map((depId) => completedTasksById.get(depId))
		.filter((depTask): depTask is TeamTask => Boolean(depTask))
		.map((depTask) => [
			`### ${depTask.expertName} (${depTask.roleType})`,
			`Status: ${depTask.status}`,
			`Task: ${depTask.description}`,
			'Output:',
			clampTeamPacketText(depTask.result, TEAM_HANDOFF_TEXT_LIMIT),
		].join('\n'));
	return items.length > 0 ? items.join('\n\n') : 'None.';
}

function buildFullPlanBreakdown(task: TeamTask, allTasks: TeamTask[]): string {
	if (!allTasks || allTasks.length === 0) {
		return '(no other specialists assigned)';
	}
	return allTasks
		.map((other, index) => {
			const marker = other.id === task.id ? ' ← YOU' : '';
			const deps = other.dependencies?.length
				? ` (depends on: ${other.dependencies
						.map((depId) => allTasks.find((candidate) => candidate.id === depId)?.expertName ?? depId)
						.join(', ')})`
				: '';
			return `${index + 1}. ${other.expertName} (${other.roleType})${marker}${deps}\n   ${other.description}`;
		})
		.join('\n');
}

export function buildSpecialistTaskPacket(params: {
	task: TeamTask;
	expert: TeamExpertRuntimeProfile;
	userRequest: string;
	planSummary: string;
	completedTasksById: Map<string, TeamTask>;
	allTasks?: TeamTask[];
}): string {
	const { task, expert, userRequest, planSummary, completedTasksById, allTasks } = params;
	return [
		'You are a specialist working under a Team Lead.',
		'You are receiving a focused assignment packet instead of the full chat transcript.',
		'Use the dependency handoffs below as the authoritative outputs from your teammates.',
		'Stay within your assigned scope and produce a concrete deliverable.',
		'',
		'## Original User Request',
		clampTeamPacketText(userRequest),
		'',
		'## Team Lead Plan Summary',
		clampTeamPacketText(planSummary),
		'',
		'## Full Plan Breakdown',
		buildFullPlanBreakdown(task, allTasks ?? [task]),
		'',
		'## Your Role',
		`${expert.name} (${expert.roleType})`,
		'',
		'## Assigned Task',
		task.description,
		'',
		'## Acceptance Criteria',
		formatAcceptanceCriteria(task.acceptanceCriteria),
		'',
		'## Dependency Handoffs',
		buildDependencyHandoffSection(task, completedTasksById),
	].join('\n');
}

export function buildReviewerTaskPacket(params: {
	reviewer: TeamExpertRuntimeProfile;
	userRequest: string;
	planSummary: string;
	completedTasks: TeamTask[];
}): string {
	const { reviewer, userRequest, planSummary, completedTasks } = params;
	const taskSummary = completedTasks.map((task) => [
		`### ${task.expertName} (${task.roleType}) - ${task.status}`,
		`Task: ${task.description}`,
		`Acceptance Criteria:\n${formatAcceptanceCriteria(task.acceptanceCriteria)}`,
		'Output:',
		clampTeamPacketText(task.result, TEAM_HANDOFF_TEXT_LIMIT),
	].join('\n')).join('\n\n');
	return [
		`You are ${reviewer.name}, the reviewer for this team workflow.`,
		'Review the specialists outputs for correctness, regressions, and quality.',
		'Base your review on the task packets and completed outputs below.',
		'',
		'## Original User Request',
		clampTeamPacketText(userRequest),
		'',
		'## Team Lead Plan Summary',
		clampTeamPacketText(planSummary),
		'',
		'## Specialist Outputs',
		taskSummary || '(no specialist output)',
		'',
		'Respond with your review following your review checklist.',
		'Your verdict line MUST start with exactly "### Verdict: APPROVED" or "### Verdict: NEEDS_REVISION".',
	].join('\n');
}

async function llmPlanTasks(params: {
	settings: ShellSettings;
	threadId: string;
	teamLead: TeamExpertRuntimeProfile;
	specialists: TeamExpertRuntimeProfile[];
	plannerTools: AgentToolDef[];
	messages: ChatMessage[];
	modelSelection: string;
	resolvedModel: TeamOrchestratorInput['resolvedModel'];
	signal: AbortSignal;
	thinkingLevel?: TeamOrchestratorInput['thinkingLevel'];
	workspaceRoot?: string | null;
	workspaceLspManager?: WorkspaceLspManager | null;
	toolHooks?: ToolExecutionHooks;
	emit: (evt: TeamEmit) => void;
}): Promise<{ tasks: LLMPlannedTask[]; planSummary: string; mode: LeadPlanMode; clarificationAnswers: string[] }> {
	const {
		settings, threadId, teamLead, specialists, plannerTools, messages, modelSelection, resolvedModel,
		signal, thinkingLevel, workspaceRoot, workspaceLspManager, toolHooks, emit,
	} = params;
	const hasCjk = messages.some((message) => /[\u3400-\u9fff]/.test(String(message.content ?? '')));
	const availableRoles = specialists.map((s) => `- ${s.assignmentKey}: ${s.name}`).join('\n');
	const planMessages: ChatMessage[] = [
		...messages,
		{
			role: 'user',
			content: [
				'[SYSTEM] You are the Team Planner coordinating a specialist workflow.',
				'You may inspect the repository with read-only tools before planning, but you must not modify files yourself.',
				'Use read-only investigation to verify assumptions before assigning work.',
				'Use `ask_plan_question` only when a key user decision cannot be discovered from the code or existing context.',
				'You MUST call `team_plan_decide` exactly once before the turn ends.',
				'Do NOT put control markers, raw JSON plans, or tool protocol text in your plain-text reply.',
				'',
				'Decision rules:',
				'- Use mode ANSWER only for generic, repo-agnostic questions that do not need the team workflow.',
				'- Use mode CLARIFY when the request is about this project but still too ambiguous to route safely.',
				'- Use mode PLAN when you can assign concrete specialist work without guessing.',
				'- When mode is ANSWER or CLARIFY, include the final user-visible reply in `replyToUser`.',
				'- When mode is PLAN, include structured tasks in `team_plan_decide.tasks` and keep any plain-text reply as short narrative only.',
				'',
				'Available specialist assignment keys:',
				availableRoles,
				'',
				'If you call `ask_plan_question`, do not repeat the raw options or tool protocol in markdown.',
				'If the user answers an `ask_plan_question`, absorb that answer and continue planning in the same turn whenever possible.',
				'Never invent a generic frontend/backend/qa split just to keep the workflow moving.',
				'For PLAN tasks, include concrete acceptance criteria whenever possible and keep dependencies explicit.',
				'Respond in the same language as the user.',
			].join('\n'),
		},
	];

	let planningMessages = planMessages;
	const clarificationAnswers: string[] = [];
	const teamLeadScope = createTeamRoleScope(
		{
			id: 'team-lead',
			expertId: teamLead.id,
			expertAssignmentKey: teamLead.assignmentKey,
			expertName: teamLead.name,
			roleType: teamLead.roleType,
			description: 'Plan the team workflow and assign specialist tasks.',
			status: 'in_progress',
			dependencies: [],
			acceptanceCriteria: [],
		},
		'lead'
	);
	const options: AgentLoopOptions = {
		modelSelection: teamLead.preferredModelId?.trim() || modelSelection,
		requestModelId: resolvedModel.requestModelId,
		paradigm: resolvedModel.paradigm,
		requestApiKey: resolvedModel.apiKey,
		requestBaseURL: resolvedModel.baseURL,
		requestProxyUrl: resolvedModel.proxyUrl,
		maxOutputTokens: resolvedModel.maxOutputTokens,
		signal,
		composerMode: 'agent',
		toolPoolOverride: plannerTools,
		agentSystemAppend: appendTeamLanguageRule(settings, teamLead.systemPrompt),
		thinkingLevel,
		workspaceRoot: workspaceRoot ?? null,
		workspaceLspManager,
		hostWebContentsId: params.hostWebContentsId ?? null,
		threadId,
		toolHooks,
		teamToolRoleScope: teamLeadScope,
	};

	if (teamLead.preferredModelId?.trim() && teamLead.preferredModelId.trim() !== modelSelection) {
		const resolved = resolveModelRequest(settings, teamLead.preferredModelId.trim());
		if (resolved.ok) {
			options.modelSelection = teamLead.preferredModelId.trim();
			options.requestModelId = resolved.requestModelId;
			options.paradigm = resolved.paradigm;
			options.requestApiKey = resolved.apiKey;
			options.requestBaseURL = resolved.baseURL;
			options.requestProxyUrl = resolved.proxyUrl;
			options.maxOutputTokens = resolved.maxOutputTokens;
		}
	}

	for (let attempt = 0; attempt < 3; attempt++) {
		let planText = '';
		let visiblePlanText = '';
		let decision: TeamPlanDecision | null = null;
		const clarificationCountBeforeTurn = clarificationAnswers.length;
		const handlers: AgentLoopHandlers = {
			onTextDelta: (text) => {
				planText += text;
				const nextVisible = extractTeamLeadNarrative(planText);
				if (!nextVisible || nextVisible === visiblePlanText) {
					return;
				}
				const deltaText = nextVisible.startsWith(visiblePlanText)
					? nextVisible.slice(visiblePlanText.length)
					: nextVisible;
				visiblePlanText = nextVisible;
				if (deltaText) {
					emit({ threadId, type: 'delta', text: deltaText, teamRoleScope: teamLeadScope });
				}
			},
			onToolInputDelta: ({ name, partialJson, index }) => {
				emit({ threadId, type: 'tool_input_delta', name, partialJson, index, teamRoleScope: teamLeadScope });
			},
			onThinkingDelta: (text) => {
				emit({ threadId, type: 'thinking_delta', text, teamRoleScope: teamLeadScope });
			},
			onToolProgress: ({ name, phase, detail }) => {
				emit({ threadId, type: 'tool_progress', name, phase, detail, teamRoleScope: teamLeadScope });
			},
			onToolCall: (name, args, toolCallId) => {
				emit({
					threadId,
					type: 'tool_call',
					name,
					args: JSON.stringify(args),
					toolCallId,
					teamRoleScope: teamLeadScope,
				});
			},
			onToolResult: (name, result, success, toolCallId) => {
				if (name === 'ask_plan_question' && success) {
					const answer = String(result ?? '').trim();
					if (answer && !clarificationAnswers.includes(answer)) {
						clarificationAnswers.push(answer);
					}
				}
				emit({
					threadId,
					type: 'tool_result',
					name,
					result,
					success,
					toolCallId,
					teamRoleScope: teamLeadScope,
				});
			},
			onDone: (text, usage) => {
				planText = text;
				const finalVisible =
					extractTeamLeadNarrative(text) ||
					decision?.replyToUser?.trim() ||
					visiblePlanText ||
					(decision?.mode === 'PLAN'
						? buildFallbackTeamLeadNarrative(hasCjk)
						: buildClarificationNeededNarrative(hasCjk));
				visiblePlanText = finalVisible;
				emit({ threadId, type: 'done', text: finalVisible, usage, teamRoleScope: teamLeadScope });
			},
			onError: () => {},
		};

		setTeamPlanDecideRuntime(teamLeadScope.teamTaskId, {
			onDecision: (nextDecision) => {
				decision = nextDecision;
			},
		});
		try {
			await runAgentLoop(settings, planningMessages, options, handlers);
		} finally {
			setTeamPlanDecideRuntime(teamLeadScope.teamTaskId, null);
		}

		const usedClarificationTool = clarificationAnswers.length > clarificationCountBeforeTurn;
		const extractedNarrative = extractTeamLeadNarrative(planText);

		if (!decision) {
			const fallbackSummary = extractedNarrative || buildClarificationNeededNarrative(hasCjk);
			if (plannerTools.some((tool) => tool.name === 'ask_plan_question') && !usedClarificationTool && !signal.aborted) {
				const fallbackToolCallId = `team-fallback-clarify-${randomUUID()}`;
				const fallbackArgs = {
					question: fallbackSummary,
					freeform: true,
					options: [{ id: 'custom', label: hasCjk ? '请补充说明' : 'Please add more detail' }],
				};
				emit({
					threadId,
					type: 'tool_call',
					name: 'ask_plan_question',
					args: JSON.stringify(fallbackArgs),
					toolCallId: fallbackToolCallId,
					teamRoleScope: teamLeadScope,
				});
				const fallbackResult = await executeAskPlanQuestionTool(
					{
						id: fallbackToolCallId,
						name: 'ask_plan_question',
						arguments: fallbackArgs,
					},
					{ teamRoleScope: teamLeadScope }
				);
				emit({
					threadId,
					type: 'tool_result',
					name: 'ask_plan_question',
					result: String(fallbackResult.content ?? ''),
					success: !fallbackResult.isError,
					toolCallId: fallbackToolCallId,
					teamRoleScope: teamLeadScope,
				});
				const answer = String(fallbackResult.content ?? '').trim();
				if (!fallbackResult.isError && answer) {
					if (!clarificationAnswers.includes(answer)) {
						clarificationAnswers.push(answer);
					}
					planningMessages = appendTeamClarificationMessage(planningMessages, answer);
					continue;
				}
			}
			return {
				tasks: [],
				planSummary: fallbackSummary,
				mode: 'CLARIFY',
				clarificationAnswers,
			};
		}

		const planSummary =
			decision.replyToUser?.trim() ||
			extractedNarrative ||
			(decision.mode === 'PLAN' ? buildFallbackTeamLeadNarrative(hasCjk) : buildClarificationNeededNarrative(hasCjk));

		if (decision.mode === 'CLARIFY' && plannerTools.some((tool) => tool.name === 'ask_plan_question') && !usedClarificationTool && !signal.aborted) {
			const fallbackToolCallId = `team-fallback-clarify-${randomUUID()}`;
			const fallbackArgs = {
				question: planSummary || buildClarificationNeededNarrative(hasCjk),
				freeform: true,
				options: [{ id: 'custom', label: hasCjk ? '请补充说明' : 'Please add more detail' }],
			};
			emit({
				threadId,
				type: 'tool_call',
				name: 'ask_plan_question',
				args: JSON.stringify(fallbackArgs),
				toolCallId: fallbackToolCallId,
				teamRoleScope: teamLeadScope,
			});
			const fallbackResult = await executeAskPlanQuestionTool(
				{
					id: fallbackToolCallId,
					name: 'ask_plan_question',
					arguments: fallbackArgs,
				},
				{ teamRoleScope: teamLeadScope }
			);
			emit({
				threadId,
				type: 'tool_result',
				name: 'ask_plan_question',
				result: String(fallbackResult.content ?? ''),
				success: !fallbackResult.isError,
				toolCallId: fallbackToolCallId,
				teamRoleScope: teamLeadScope,
			});
			const answer = String(fallbackResult.content ?? '').trim();
			if (!fallbackResult.isError && answer) {
				if (!clarificationAnswers.includes(answer)) {
					clarificationAnswers.push(answer);
				}
				planningMessages = appendTeamClarificationMessage(planningMessages, answer);
				continue;
			}
		}

		return {
			tasks: decision.mode === 'PLAN' ? toLlmPlannedTasks(decision.tasks) : [],
			planSummary,
			mode: decision.mode,
			clarificationAnswers,
		};
	}

	return {
		tasks: [],
		planSummary: buildClarificationNeededNarrative(hasCjk),
		mode: 'CLARIFY',
		clarificationAnswers,
	};
}

// ── Preflight requirement review ─────────────────────────────────────────

function buildPreflightReviewerPacket(params: {
	reviewer: TeamExpertRuntimeProfile;
	userRequest: string;
	planSummary: string;
	plannedTasks: TeamTask[];
	specialists: TeamExpertRuntimeProfile[];
}): string {
	const { reviewer, userRequest, planSummary, plannedTasks, specialists } = params;
	const roster = specialists
		.map((s) => `- ${s.assignmentKey} (${s.name}, ${s.roleType})`)
		.join('\n');
	const taskLines = plannedTasks.map((task, idx) => [
		`### Task ${idx + 1} — ${task.expertName} (${task.roleType})`,
		`Assignment: ${task.description}`,
		`Acceptance Criteria:`,
		formatAcceptanceCriteria(task.acceptanceCriteria),
		`Dependencies: ${task.dependencies.length > 0 ? task.dependencies.join(', ') : 'none'}`,
	].join('\n')).join('\n\n');
	return [
		`You are ${reviewer.name}, acting as a preflight requirement reviewer.`,
		'This is BEFORE any specialist executes. Your job is to evaluate the USER REQUEST and the LEAD PROPOSAL for:',
		'- clarity of requirements (are there ambiguities or unstated assumptions?)',
		'- completeness of the plan (does it cover the user goal without gaps or unnecessary scope?)',
		'- role assignment sanity (do the chosen specialists fit the tasks?)',
		'- risks and blockers the user/lead should know before execution.',
		'',
		'Do NOT review implementation outputs (none exist yet). Keep your note concise.',
		'',
		'## User Request',
		clampTeamPacketText(userRequest),
		'',
		'## Lead Plan Summary',
		clampTeamPacketText(planSummary),
		'',
		'## Specialist Roster',
		roster,
		'',
		'## Proposed Tasks',
		taskLines || '(empty)',
		'',
		'## Output Format',
		'### Verdict: OK | NEEDS_CLARIFICATION',
		'### Concerns',
		'- bullet list (may be empty)',
		'### Suggestions',
		'- bullet list (may be empty)',
		'### Summary',
		'One concise paragraph addressed to the user.',
		'',
		'Your verdict line MUST start with exactly "### Verdict: OK" or "### Verdict: NEEDS_CLARIFICATION".',
	].join('\n');
}

async function runPreflightReviewerAgent(params: {
	settings: ShellSettings;
	threadId: string;
	reviewer: TeamExpertRuntimeProfile;
	plannedTasks: TeamTask[];
	userRequest: string;
	planSummary: string;
	specialists: TeamExpertRuntimeProfile[];
	modelSelection: string;
	resolvedModel: TeamOrchestratorInput['resolvedModel'];
	signal: AbortSignal;
	thinkingLevel?: TeamOrchestratorInput['thinkingLevel'];
	workspaceRoot?: string | null;
	workspaceLspManager?: WorkspaceLspManager | null;
	toolHooks?: ToolExecutionHooks;
	baseTools: AgentToolDef[];
	emit: (evt: TeamEmit) => void;
}): Promise<{ verdict: 'ok' | 'needs_clarification'; summary: string }> {
	const {
		settings, threadId, reviewer, plannedTasks, userRequest, planSummary, specialists,
		modelSelection, resolvedModel,
		signal, thinkingLevel, workspaceRoot, workspaceLspManager, toolHooks, baseTools, emit,
	} = params;

	const messages: ChatMessage[] = [
		{
			role: 'user',
			content: buildPreflightReviewerPacket({
				reviewer, userRequest, planSummary, plannedTasks, specialists,
			}),
		},
	];

	let reviewText = '';
	const reviewerTask = buildReviewerWorkflowTask(
		reviewer,
		'Review the user request and the lead proposal before execution begins.',
		plannedTasks.map((task) => task.id),
		[
			'Flag ambiguities or missing requirements before execution starts',
			'Assess whether the role assignments and task split are sensible',
		]
	);
	const teamRoleScope = createTeamRoleScope(reviewerTask, 'reviewer');
	const specializedTools = buildSpecialistToolPool(baseTools, reviewer);
	const options: AgentLoopOptions = {
		modelSelection: reviewer.preferredModelId?.trim() || modelSelection,
		requestModelId: resolvedModel.requestModelId,
		paradigm: resolvedModel.paradigm,
		requestApiKey: resolvedModel.apiKey,
		requestBaseURL: resolvedModel.baseURL,
		requestProxyUrl: resolvedModel.proxyUrl,
		maxOutputTokens: resolvedModel.maxOutputTokens,
		signal,
		composerMode: 'agent',
		toolPoolOverride: specializedTools,
		agentSystemAppend: appendTeamLanguageRule(settings, reviewer.systemPrompt),
		thinkingLevel,
		workspaceRoot,
		workspaceLspManager,
		hostWebContentsId: params.hostWebContentsId ?? null,
		threadId,
		toolHooks,
		teamToolRoleScope: teamRoleScope,
	};

	if (reviewer.preferredModelId?.trim() && reviewer.preferredModelId.trim() !== modelSelection) {
		const resolved = resolveModelRequest(settings, reviewer.preferredModelId.trim());
		if (resolved.ok) {
			options.modelSelection = reviewer.preferredModelId.trim();
			options.requestModelId = resolved.requestModelId;
			options.paradigm = resolved.paradigm;
			options.requestApiKey = resolved.apiKey;
			options.requestBaseURL = resolved.baseURL;
			options.requestProxyUrl = resolved.proxyUrl;
			options.maxOutputTokens = resolved.maxOutputTokens;
		}
	}

	const handlers: AgentLoopHandlers = {
		onTextDelta: (text) => {
			reviewText += text;
			emit({ threadId, type: 'delta', text, teamRoleScope });
		},
		onToolInputDelta: ({ name, partialJson, index }) => {
			emit({ threadId, type: 'tool_input_delta', name, partialJson, index, teamRoleScope });
		},
		onThinkingDelta: (text) => {
			emit({ threadId, type: 'thinking_delta', text, teamRoleScope });
		},
		onToolProgress: ({ name, phase, detail }) => {
			emit({ threadId, type: 'tool_progress', name, phase, detail, teamRoleScope });
		},
		onToolCall: (name, args, toolCallId) => {
			emit({
				threadId,
				type: 'tool_call',
				name,
				args: JSON.stringify(args),
				toolCallId,
				teamRoleScope,
			});
		},
		onToolResult: (name, result, success, toolCallId) => {
			emit({
				threadId,
				type: 'tool_result',
				name,
				result,
				success,
				toolCallId,
				teamRoleScope,
			});
		},
		onDone: (text, usage) => {
			reviewText = text;
			emit({ threadId, type: 'done', text, usage, teamRoleScope });
		},
		onError: (message) => {
			emit({ threadId, type: 'error', message, teamRoleScope });
		},
	};

	try {
		emit({
			threadId,
			type: 'tool_progress',
			name: reviewer.name,
			phase: 'starting',
			detail: 'Reviewing the request and lead proposal before execution.',
			teamRoleScope,
		});
		await runAgentLoop(settings, messages, options, handlers);
	} catch {
		// Degrade gracefully — caller will treat empty review as OK.
	}

	const needsClarification = /###\s*Verdict:\s*NEEDS_CLARIFICATION/i.test(reviewText);
	const summary = normalizeTeamAgentSummary(
		reviewText,
		'Preflight review not produced; proceeding as OK.'
	);
	return {
		verdict: needsClarification ? 'needs_clarification' : 'ok',
		summary,
	};
}

// ── LLM-based Reviewer Agent ─────────────────────────────────────────────

async function runReviewerAgent(params: {
	settings: ShellSettings;
	threadId: string;
	reviewer: TeamExpertRuntimeProfile;
	completedTasks: TeamTask[];
	userRequest: string;
	planSummary: string;
	modelSelection: string;
	resolvedModel: TeamOrchestratorInput['resolvedModel'];
	signal: AbortSignal;
	thinkingLevel?: TeamOrchestratorInput['thinkingLevel'];
	workspaceRoot?: string | null;
	workspaceLspManager?: WorkspaceLspManager | null;
	toolHooks?: ToolExecutionHooks;
	baseTools: AgentToolDef[];
	emit: (evt: TeamEmit) => void;
}): Promise<{ verdict: 'approved' | 'revision_needed'; summary: string }> {
	const {
		settings, threadId, reviewer, completedTasks, userRequest, planSummary, modelSelection, resolvedModel,
		signal, thinkingLevel, workspaceRoot, workspaceLspManager, toolHooks, baseTools, emit,
	} = params;

	const reviewMessages: ChatMessage[] = [
		{
			role: 'user',
			content: buildReviewerTaskPacket({ reviewer, userRequest, planSummary, completedTasks }),
		},
	];

	const reviewerTask = buildReviewerWorkflowTask(
		reviewer,
		'Review specialist results and provide the final verdict.',
		completedTasks.map((task) => task.id),
		['Review all specialist results', 'Provide a clear final verdict']
	);
	const teamRoleScope = createTeamRoleScope(reviewerTask, 'reviewer');

	let reviewText = '';
	const specializedTools = buildSpecialistToolPool(baseTools, reviewer);
	const options: AgentLoopOptions = {
		modelSelection: reviewer.preferredModelId?.trim() || modelSelection,
		requestModelId: resolvedModel.requestModelId,
		paradigm: resolvedModel.paradigm,
		requestApiKey: resolvedModel.apiKey,
		requestBaseURL: resolvedModel.baseURL,
		requestProxyUrl: resolvedModel.proxyUrl,
		maxOutputTokens: resolvedModel.maxOutputTokens,
		signal,
		composerMode: 'agent',
		toolPoolOverride: specializedTools,
		agentSystemAppend: appendTeamLanguageRule(settings, reviewer.systemPrompt),
		thinkingLevel,
		workspaceRoot,
		workspaceLspManager,
		hostWebContentsId: params.hostWebContentsId ?? null,
		threadId,
		toolHooks,
		teamToolRoleScope: teamRoleScope,
	};

	if (reviewer.preferredModelId?.trim() && reviewer.preferredModelId.trim() !== modelSelection) {
		const resolved = resolveModelRequest(settings, reviewer.preferredModelId.trim());
		if (resolved.ok) {
			options.modelSelection = reviewer.preferredModelId.trim();
			options.requestModelId = resolved.requestModelId;
			options.paradigm = resolved.paradigm;
			options.requestApiKey = resolved.apiKey;
			options.requestBaseURL = resolved.baseURL;
			options.requestProxyUrl = resolved.proxyUrl;
			options.maxOutputTokens = resolved.maxOutputTokens;
		}
	}

	const handlers: AgentLoopHandlers = {
		onTextDelta: (text) => {
			reviewText += text;
			emit({ threadId, type: 'delta', text, teamRoleScope });
		},
		onToolInputDelta: ({ name, partialJson, index }) => {
			emit({ threadId, type: 'tool_input_delta', name, partialJson, index, teamRoleScope });
		},
		onThinkingDelta: (text) => {
			emit({ threadId, type: 'thinking_delta', text, teamRoleScope });
		},
		onToolProgress: ({ name, phase, detail }) => {
			emit({ threadId, type: 'tool_progress', name, phase, detail, teamRoleScope });
		},
		onToolCall: (name, args, toolCallId) => {
			emit({
				threadId,
				type: 'tool_call',
				name,
				args: JSON.stringify(args),
				toolCallId,
				teamRoleScope,
			});
		},
		onToolResult: (name, result, success, toolCallId) => {
			emit({
				threadId,
				type: 'tool_result',
				name,
				result,
				success,
				toolCallId,
				teamRoleScope,
			});
		},
		onDone: (text, usage) => {
			reviewText = text;
			emit({ threadId, type: 'done', text, usage, teamRoleScope });
		},
		onError: (message) => {
			emit({ threadId, type: 'error', message, teamRoleScope });
		},
	};

	try {
		await runAgentLoop(settings, reviewMessages, options, handlers);
	} catch {
		// fall through to deterministic fallback
	}

	const hasRevisionVerdict = /###\s*Verdict:\s*NEEDS_REVISION/i.test(reviewText);
	const hasFailedTasks = completedTasks.some((t) => t.status === 'failed');

	const verdict: 'approved' | 'revision_needed' =
		hasRevisionVerdict || hasFailedTasks ? 'revision_needed' : 'approved';

	const summary = normalizeTeamAgentSummary(
		reviewText,
		hasFailedTasks
			? `Review: ${completedTasks.filter((t) => t.status === 'failed').length} task(s) failed.`
			: `Review: All ${completedTasks.length} task(s) completed successfully.`
	);

	return { verdict, summary };
}

// ── Specialist execution ─────────────────────────────────────────────────

function buildSpecialistToolPool(base: AgentToolDef[], expert: TeamExpertRuntimeProfile): AgentToolDef[] {
	const allow = expert.allowedTools && expert.allowedTools.length > 0 ? new Set(expert.allowedTools) : null;
	const filtered =
		!allow
			? [...base]
			: base.filter((tool) => allow.has(tool.name));
	for (const tool of [teamEscalateToLeadTool, teamRequestFromPeerTool, teamReplyToPeerTool]) {
		if (!filtered.some((item) => item.name === tool.name)) {
			filtered.push(tool);
		}
	}
	return filtered;
}

async function runOneSpecialist(params: {
	settings: ShellSettings;
	task: TeamTask;
	expert: TeamExpertRuntimeProfile;
	userRequest: string;
	planSummary: string;
	completedTasksById: Map<string, TeamTask>;
	allTasks: TeamTask[];
	modelSelection: string;
	resolvedModel: TeamOrchestratorInput['resolvedModel'];
	signal: AbortSignal;
	thinkingLevel?: TeamOrchestratorInput['thinkingLevel'];
	workspaceRoot?: string | null;
	workspaceLspManager?: WorkspaceLspManager | null;
	toolHooks?: ToolExecutionHooks;
	baseTools: AgentToolDef[];
	threadId: string;
	pullPeerMailboxMessages?: () => Promise<ChatMessage[]>;
	handlePeerRequest?: (request: TeamPeerRequest) => Promise<string>;
	handlePeerReply?: (reply: TeamPeerReply) => void;
	emit: (evt: TeamEmit) => void;
}): Promise<SpecialistRunResult> {
	const {
		settings, task, expert, userRequest, planSummary, completedTasksById, allTasks,
		modelSelection, resolvedModel,
		signal, thinkingLevel, workspaceRoot, workspaceLspManager, toolHooks, baseTools,
		threadId, pullPeerMailboxMessages, handlePeerRequest, handlePeerReply, emit,
	} = params;

	const subMessages: ChatMessage[] = [
		{
			role: 'user',
			content: buildSpecialistTaskPacket({
				task,
				expert,
				userRequest,
				planSummary,
				completedTasksById,
				allTasks,
			}),
		},
	];
	const specializedToolPool = buildSpecialistToolPool(baseTools, expert);
	let finalText = '';
	let success = true;
	let escalation: TeamEscalation | undefined;
	const teamRoleScope = createTeamRoleScope(task, 'specialist');

	const options: AgentLoopOptions = {
		modelSelection: expert.preferredModelId?.trim() || modelSelection,
		requestModelId: resolvedModel.requestModelId,
		paradigm: resolvedModel.paradigm,
		requestApiKey: resolvedModel.apiKey,
		requestBaseURL: resolvedModel.baseURL,
		requestProxyUrl: resolvedModel.proxyUrl,
		maxOutputTokens: resolvedModel.maxOutputTokens,
		signal,
		composerMode: 'agent',
		toolPoolOverride: specializedToolPool,
		agentSystemAppend: appendTeamLanguageRule(settings, expert.systemPrompt),
		thinkingLevel,
		workspaceRoot,
		workspaceLspManager,
		hostWebContentsId: params.hostWebContentsId ?? null,
		threadId,
		toolHooks,
		teamToolRoleScope: teamRoleScope,
		beforeRoundMessages: pullPeerMailboxMessages,
	};

	const handlers: AgentLoopHandlers = {
		onTextDelta: (text) => {
			finalText += text;
			emit({ threadId, type: 'delta', text, teamRoleScope });
		},
		onToolInputDelta: ({ name, partialJson, index }) => {
			emit({ threadId, type: 'tool_input_delta', name, partialJson, index, teamRoleScope });
		},
		onThinkingDelta: (text) => {
			emit({ threadId, type: 'thinking_delta', text, teamRoleScope });
		},
		onToolProgress: ({ name, phase, detail }) => {
			emit({ threadId, type: 'tool_progress', name, phase, detail, teamRoleScope });
		},
		onToolCall: (name, args, toolCallId) => {
			emit({
				threadId,
				type: 'team_expert_progress',
				taskId: task.id,
				expertId: task.expertId,
				message: `Calling tool: ${name}`,
			});
			emit({
				threadId,
				type: 'tool_call',
				name,
				args: JSON.stringify(args),
				toolCallId,
				teamRoleScope,
			});
		},
		onToolResult: (name, result, toolSuccess, toolCallId) => {
			emit({
				threadId,
				type: 'team_expert_progress',
				taskId: task.id,
				expertId: task.expertId,
				message: `Tool ${name}: ${toolSuccess ? 'success' : 'failed'}`,
			});
			emit({
				threadId,
				type: 'tool_result',
				name,
				result,
				success: toolSuccess,
				toolCallId,
				teamRoleScope,
			});
		},
		onDone: (text, usage) => {
			finalText = text;
			emit({ threadId, type: 'done', text, usage, teamRoleScope });
		},
		onError: (message) => {
			success = false;
			finalText = message;
			emit({ threadId, type: 'error', message, teamRoleScope });
		},
	};

	try {
		if (expert.preferredModelId?.trim() && expert.preferredModelId.trim() !== modelSelection) {
			const resolvedOverride = resolveModelRequest(settings, expert.preferredModelId.trim());
			if (resolvedOverride.ok) {
				options.modelSelection = expert.preferredModelId.trim();
				options.requestModelId = resolvedOverride.requestModelId;
				options.paradigm = resolvedOverride.paradigm;
				options.requestApiKey = resolvedOverride.apiKey;
				options.requestBaseURL = resolvedOverride.baseURL;
				options.requestProxyUrl = resolvedOverride.proxyUrl;
				options.maxOutputTokens = resolvedOverride.maxOutputTokens;
			}
		}
		setTeamEscalationRuntime(teamRoleScope.teamTaskId, {
			onEscalation: (payload) => {
				escalation = payload;
			},
		});
		setTeamPeerRequestRuntime(teamRoleScope.teamTaskId, {
			onRequest: async (request) =>
				handlePeerRequest
					? handlePeerRequest(request)
					: buildPeerResponse(request, completedTasksById, allTasks),
		});
		setTeamPeerReplyRuntime(teamRoleScope.teamTaskId, {
			onReply: (reply) => {
				handlePeerReply?.(reply);
			},
		});
		try {
			await runAgentLoop(settings, subMessages, options, handlers);
		} finally {
			setTeamEscalationRuntime(teamRoleScope.teamTaskId, null);
			setTeamPeerRequestRuntime(teamRoleScope.teamTaskId, null);
			setTeamPeerReplyRuntime(teamRoleScope.teamTaskId, null);
		}
	} catch (error) {
		success = false;
		finalText = error instanceof Error ? error.message : String(error);
	}
	if (escalation) {
		return {
			success: false,
			text:
				finalText ||
				[
					`Escalation: ${escalation.reason}`,
					`Proposed change: ${escalation.proposedChange}`,
					...(escalation.blockingEvidence.length > 0
						? ['Evidence:', ...escalation.blockingEvidence.map((item) => `- ${item}`)]
						: []),
				].join('\n'),
			escalation,
		};
	}
	return { success, text: finalText };
}

// ── Dependency-aware scheduling ──────────────────────────────────────────

function getReadyTasks(pending: TeamTask[], completedIds: Set<string>): TeamTask[] {
	return pending.filter((t) =>
		t.dependencies.length === 0 || t.dependencies.every((dep) => completedIds.has(dep))
	);
}

function serializeTeamPlanTasks(tasks: TeamTask[]): Array<{
	id: string;
	expertId: string;
	expert: string;
	expertAssignmentKey?: string;
	expertName: string;
	roleType: TeamRoleType;
	task: string;
	dependencies?: string[];
	acceptanceCriteria?: string[];
}> {
	return tasks.map((task) => ({
		id: task.id,
		expertId: task.expertId,
		expert: task.expertAssignmentKey || task.expertId,
		expertAssignmentKey: task.expertAssignmentKey,
		expertName: task.expertName,
		roleType: task.roleType,
		task: task.description,
		dependencies: task.dependencies,
		acceptanceCriteria: task.acceptanceCriteria,
	}));
}

function applyPlanDiff(oldPendingTasks: TeamTask[], nextPendingTasks: TeamTask[]): {
	nextPendingTasks: TeamTask[];
	addedTasks: TeamTask[];
	removedTasks: TeamTask[];
	keptTasks: TeamTask[];
} {
	const previousById = new Map(oldPendingTasks.map((task) => [task.id, task]));
	const nextById = new Map(nextPendingTasks.map((task) => [task.id, task]));
	return {
		nextPendingTasks,
		addedTasks: nextPendingTasks.filter((task) => !previousById.has(task.id)),
		removedTasks: oldPendingTasks.filter((task) => !nextById.has(task.id)),
		keptTasks: nextPendingTasks.filter((task) => previousById.has(task.id)),
	};
}

function buildCompletedTaskContext(completedTasks: TeamTask[]): string {
	if (completedTasks.length === 0) {
		return 'None.';
	}
	return completedTasks.map((task) => [
		`### ${task.expertName} (${task.roleType})`,
		`Task: ${task.description}`,
		`Status: ${task.status}`,
		'Output:',
		clampTeamPacketText(task.result, TEAM_HANDOFF_TEXT_LIMIT),
	].join('\n')).join('\n\n');
}

function appendPlannerEscalationMessage(
	messages: ChatMessage[],
	params: {
		task: TeamTask;
		escalation: TeamEscalation;
		completedTasks: TeamTask[];
	}
): ChatMessage[] {
	const { task, escalation, completedTasks } = params;
	return [
		...messages,
		{
			role: 'user',
			content: [
				'[TEAM ESCALATION]',
				`${task.expertName} (${task.roleType}) could not safely continue the assigned task.`,
				'',
				'## Escalated Task',
				task.description,
				'',
				'## Reason',
				escalation.reason,
				'',
				'## Proposed Change',
				escalation.proposedChange,
				'',
				'## Blocking Evidence',
				escalation.blockingEvidence.length > 0 ? escalation.blockingEvidence.map((item) => `- ${item}`).join('\n') : '- (none provided)',
				'',
				'## Completed Work So Far',
				buildCompletedTaskContext(completedTasks),
				'',
				'Replan the remaining work. Preserve completed tasks and revise only the unfinished portion.',
			].join('\n'),
		},
	];
}

// ── Main orchestrator ────────────────────────────────────────────────────

export async function runTeamSession(input: TeamOrchestratorInput): Promise<void> {
	const {
		settings, threadId, messages, modelSelection, resolvedModel,
		agentSystemAppend, signal, thinkingLevel, workspaceRoot, workspaceLspManager,
		toolHooks, emit, onDone, onError,
	} = input;

	try {
		const latestUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
		let effectiveUserText = latestUser;

		const baseTeamTools = assembleAgentToolPool('team', {
			mcpToolDenyPrefixes: settings.mcpToolDenyPrefixes,
		});
		const resolvedExperts = resolveTeamExpertProfiles(settings.team, baseTeamTools);
		const { teamLead, specialists } = resolvedExperts;
		const plannerTools = buildPlannerToolPool(baseTeamTools);
		const presetMaxParallel = getTeamPreset(settings.team?.presetId).maxParallelExperts;
		const rawConfiguredMaxParallel = Number(settings.team?.maxParallelExperts);
		const maxParallelExperts =
			Number.isFinite(rawConfiguredMaxParallel) && rawConfiguredMaxParallel > 0
				? Math.max(1, Math.floor(rawConfiguredMaxParallel))
				: Math.max(1, Math.floor(presetMaxParallel || 2));

		if (!teamLead || specialists.length === 0) {
			onError('Team mode requires at least one Team Lead and one enabled specialist.');
			return;
		}

		const checkAbort = () => {
			if (signal.aborted) {
				throw new Error('Team session aborted by user.');
			}
		};

		const hasCjkRequest = /[\u3400-\u9fff]/.test(effectiveUserText);
		const presetDefaults = getTeamPresetDefaults(settings.team?.presetId);
		let planningMessages = messages;

		// ── Phase 1: Planning ────────────────────────────────────────
		let plannedTasks: TeamTask[] = [];
		let planSummary = '';
		let preflightSummary = '';
		let preflightVerdict: 'ok' | 'needs_clarification' | undefined;

		while (true) {
			checkAbort();
			emit({ threadId, type: 'team_phase', phase: 'planning' });

			plannedTasks = [];
			planSummary = '';
			preflightSummary = '';
			preflightVerdict = undefined;

			try {
				const planResult = await llmPlanTasks({
					settings, threadId, teamLead, specialists, plannerTools, messages: planningMessages, modelSelection,
					resolvedModel, signal, thinkingLevel, workspaceRoot, workspaceLspManager, toolHooks, emit,
				});
				if (planResult.clarificationAnswers.length > 0) {
					const propagated = applyTeamClarificationAnswers(
						effectiveUserText,
						planningMessages,
						planResult.clarificationAnswers
					);
					effectiveUserText = propagated.userText;
					planningMessages = propagated.messages;
				}
				planSummary = planResult.planSummary;

				if (planResult.mode === 'ANSWER') {
					const deliveryText = planSummary.trim() || buildFallbackTeamLeadNarrative(hasCjkRequest);
					emit({ threadId, type: 'team_plan_summary', summary: deliveryText });
					emit({ threadId, type: 'team_phase', phase: 'delivering' });
					onDone(deliveryText, undefined, {
						phase: 'delivering',
						tasks: [],
						planSummary: deliveryText,
						leaderMessage: deliveryText,
						reviewSummary: '',
						reviewVerdict: null,
					});
					return;
				}

				if (planResult.mode === 'CLARIFY') {
					const deliveryText = planSummary.trim() || buildClarificationNeededNarrative(hasCjkRequest);
					emit({ threadId, type: 'team_plan_summary', summary: deliveryText });
					emit({ threadId, type: 'team_phase', phase: 'delivering' });
					onDone(deliveryText, undefined, {
						phase: 'delivering',
						tasks: [],
						planSummary: deliveryText,
						leaderMessage: deliveryText,
						reviewSummary: '',
						reviewVerdict: null,
					});
					return;
				}

				if (planResult.tasks.length > 0) {
					plannedTasks = materializePlannedTasks(planResult.tasks, specialists);
				}
			} catch {
				const clarificationText = buildClarificationNeededNarrative(hasCjkRequest);
				emit({ threadId, type: 'team_plan_summary', summary: clarificationText });
				emit({ threadId, type: 'team_phase', phase: 'delivering' });
				onDone(clarificationText, undefined, {
					phase: 'delivering',
					tasks: [],
					planSummary: clarificationText,
					leaderMessage: clarificationText,
					reviewSummary: '',
					reviewVerdict: null,
				});
				return;
			}

			if (plannedTasks.length === 0) {
				const clarificationText = buildClarificationNeededNarrative(hasCjkRequest);
				emit({ threadId, type: 'team_plan_summary', summary: clarificationText });
				emit({ threadId, type: 'team_phase', phase: 'delivering' });
				onDone(clarificationText, undefined, {
					phase: 'delivering',
					tasks: [],
					planSummary: clarificationText,
					leaderMessage: clarificationText,
					reviewSummary: '',
					reviewVerdict: null,
				});
				return;
			}

			emit({ threadId, type: 'team_plan_summary', summary: planSummary });

			// ── Phase 1.25: Preflight requirement/plan review ────────────

			const enablePreflightReview = settings.team?.enablePreflightReview ?? presetDefaults.enablePreflightReview;
			if (enablePreflightReview && resolvedExperts.planReviewer) {
				checkAbort();
				emit({ threadId, type: 'team_phase', phase: 'preflight' });
				try {
					const preflight = await runPreflightReviewerAgent({
						settings, threadId, reviewer: resolvedExperts.planReviewer, plannedTasks,
						userRequest: effectiveUserText, planSummary, specialists,
						modelSelection, resolvedModel, signal, thinkingLevel,
						workspaceRoot, workspaceLspManager, toolHooks, baseTools: baseTeamTools, emit,
					});
					preflightSummary = preflight.summary;
					preflightVerdict = preflight.verdict;
					emit({
						threadId, type: 'team_preflight_review',
						verdict: preflight.verdict, summary: preflight.summary,
					});
				} catch (err) {
					if (signal.aborted) throw err;
					// Non-fatal — continue without preflight notes.
				}
			}

			if (preflightVerdict === 'needs_clarification') {
				const deliveryText = preflightSummary.trim() || buildClarificationNeededNarrative(hasCjkRequest);
				emit({ threadId, type: 'team_plan_summary', summary: deliveryText });
				emit({ threadId, type: 'team_phase', phase: 'delivering' });
				onDone(deliveryText, undefined, {
					phase: 'delivering',
					tasks: [],
					planSummary,
					leaderMessage: planSummary,
					reviewSummary: preflightSummary || deliveryText,
					reviewVerdict: null,
				});
				return;
			}

			break;
		}

		// ── Phase 1.5: Plan proposal — await user approval ───────────

		const requirePlanApproval = settings.team?.requirePlanApproval ?? presetDefaults.requirePlanApproval;
		if (requirePlanApproval) {
			checkAbort();
			emit({ threadId, type: 'team_phase', phase: 'proposing' });
			const proposalId = buildTeamPlanProposalId(threadId);
			emit({
				threadId,
				type: 'team_plan_proposed',
				proposalId,
				summary: planSummary,
				tasks: plannedTasks.map((t) => ({
					expert: t.expertAssignmentKey || t.expertId,
					expertName: t.expertName,
					roleType: t.roleType,
					task: t.description,
					dependencies: t.dependencies,
					acceptanceCriteria: t.acceptanceCriteria,
				})),
				...(preflightSummary ? { preflightSummary } : {}),
				...(preflightVerdict ? { preflightVerdict } : {}),
			});

			const decision = await new Promise<TeamPlanApprovalPayload>((resolve, reject) => {
				if (signal.aborted) {
					reject(new Error('Team session aborted by user.'));
					return;
				}
				const onAbort = () => {
					unregisterTeamPlanApprovalWaiter(proposalId);
					reject(new Error('Team session aborted by user.'));
				};
				signal.addEventListener('abort', onAbort, { once: true });
				registerTeamPlanApprovalWaiter(proposalId, (payload) => {
					signal.removeEventListener('abort', onAbort);
					resolve(payload);
				});
			});

			emit({ threadId, type: 'team_plan_decision', proposalId, approved: decision.approved });

			if (!decision.approved) {
				emit({ threadId, type: 'team_phase', phase: 'cancelled' });
				const feedback = decision.feedbackText?.trim();
				const hasCjk = /[\u3400-\u9fff]/.test(effectiveUserText);
				const cancelledLine = hasCjk
					? '方案已取消。你可以调整需求后重新发送。'
					: 'Plan cancelled. Adjust your request and send again when ready.';
				const deliveryText = feedback
					? `${cancelledLine}\n\n${hasCjk ? '用户备注' : 'Your feedback'}: ${feedback}`
					: cancelledLine;
				onDone(deliveryText, undefined, {
					phase: 'delivering',
					tasks: [],
					planSummary,
					leaderMessage: planSummary,
					reviewSummary: preflightSummary,
					reviewVerdict: null,
				});
				return;
			}

			// Optional: incorporate user feedback text as an extra hint for specialists.
			const feedback = decision.feedbackText?.trim();
			if (feedback) {
				effectiveUserText = `${effectiveUserText}\n\n[User feedback on plan]\n${feedback}`;
			}
		}

		for (const [index, task] of plannedTasks.entries()) {
			emit({
				threadId,
				type: 'team_task_created',
				task: {
					id: task.id,
					expertId: task.expertId,
					expertAssignmentKey: task.expertAssignmentKey,
					expertName: task.expertName,
					roleType: task.roleType,
					description: task.description,
					status: task.status,
					dependencies: task.dependencies,
					acceptanceCriteria: task.acceptanceCriteria,
				},
			});
			if (index < plannedTasks.length - 1) {
				await sleepWithAbort(450, signal);
			}
		}

		// ── Phase 2: Dependency-aware parallel execution ─────────────

		checkAbort();
		emit({ threadId, type: 'team_phase', phase: 'executing' });
		let pending = [...plannedTasks];
		const completed: TeamTask[] = [];
		const completedIds = new Set<string>();
		const completedTasksById = new Map<string, TeamTask>();
		const activeTaskIds = new Set<string>();
		const peerMailbox = new Map<string, Map<string, PeerMailboxRequest>>();
		const maxConsecutiveFailedBatches = 2;
		let consecutiveFailedBatches = 0;
		let replanBudget = 2;
		const peerResponseTimeoutMs = 15000;

		const clearPeerRequest = (targetTaskId: string, requestId: string): PeerMailboxRequest | null => {
			const requests = peerMailbox.get(targetTaskId);
			const request = requests?.get(requestId) ?? null;
			if (!request) {
				return null;
			}
			if (request.timer) {
				clearTimeout(request.timer);
				request.timer = null;
			}
			requests?.delete(requestId);
			if (requests && requests.size === 0) {
				peerMailbox.delete(targetTaskId);
			}
			return request;
		};

		const resolveOutstandingPeerRequestsForTask = (task: TeamTask, fallbackText: string) => {
			const requests = peerMailbox.get(task.id);
			if (!requests || requests.size === 0) {
				return;
			}
			for (const request of [...requests.values()]) {
				clearPeerRequest(task.id, request.requestId);
				request.resolve(
					[
						`${task.expertName} finished without a direct peer reply.`,
						'Latest output:',
						clampTeamPacketText(fallbackText || task.result, TEAM_HANDOFF_TEXT_LIMIT),
					].join('\n')
				);
			}
		};

		const pullPeerMailboxMessages = async (task: TeamTask): Promise<ChatMessage[]> => {
			const requests = [...(peerMailbox.get(task.id)?.values() ?? [])];
			if (requests.length === 0) {
				return [];
			}
			for (const request of requests) {
				request.deliveredCount += 1;
			}
			emit({
				threadId,
				type: 'team_expert_progress',
				taskId: task.id,
				expertId: task.expertId,
				message: `Received ${requests.length} peer request(s) while still running.`,
			});
			return buildPeerMailboxMessages(requests, task);
		};

		const waitForRunningPeerReply = async (requestingTask: TeamTask, request: TeamPeerRequest): Promise<string> => {
			const targetTask = findPeerTask(plannedTasks, request.targetExpertId);
			if (!targetTask) {
				return `No peer specialist matched "${request.targetExpertId}".`;
			}
			if (targetTask.id === requestingTask.id) {
				return 'You cannot request information from yourself.';
			}
			const completedTask = completedTasksById.get(targetTask.id);
			if (completedTask) {
				return buildPeerResponse(request, completedTasksById, plannedTasks);
			}
			if (!activeTaskIds.has(targetTask.id)) {
				return `${targetTask.expertName} is not currently running. Only running or completed peers are available.`;
			}
			return await new Promise<string>((resolve) => {
				const requestId = `peer-request-${randomUUID()}`;
				const targetRequests = peerMailbox.get(targetTask.id) ?? new Map<string, PeerMailboxRequest>();
				const mailboxRequest: PeerMailboxRequest = {
					requestId,
					fromTaskId: requestingTask.id,
					fromExpertId: requestingTask.expertId,
					fromExpertName: requestingTask.expertName,
					fromRoleType: requestingTask.roleType,
					question: request.question,
					resolve,
					deliveredCount: 0,
					timer: null,
				};
				mailboxRequest.timer = setTimeout(() => {
					clearPeerRequest(targetTask.id, requestId);
					resolve(`${targetTask.expertName} did not respond in time.`);
				}, peerResponseTimeoutMs);
				targetRequests.set(requestId, mailboxRequest);
				peerMailbox.set(targetTask.id, targetRequests);
			});
		};

		while (pending.length > 0) {
			checkAbort();
			const ready = getReadyTasks(pending, completedIds);
			if (ready.length === 0) {
				for (const task of pending) {
					completed.push({ ...task, status: 'failed', result: 'Stuck: unresolvable dependency.' });
				}
				pending.length = 0;
				break;
			}

			const batch = ready.slice(0, maxParallelExperts);
			for (const bt of batch) {
				const idx = pending.indexOf(bt);
				if (idx !== -1) pending.splice(idx, 1);
			}

			// 用 Promise.race 确保 abort 信号能立即中断 Promise.all，
			// 避免 agent loop 因 AbortSignal 事件监听器竞态而不停止
			const abortPromise = new Promise<never>((_, reject) => {
				if (signal.aborted) {
					reject(new Error('Team session aborted by user.'));
					return;
				}
				signal.addEventListener('abort', () => {
					reject(new Error('Team session aborted by user.'));
				}, { once: true });
			});

			const results = await Promise.race([
				Promise.all(
					batch.map(async (task) => {
						if (signal.aborted) throw new Error('Team session aborted by user.');
						const expert = specialists.find((s) => s.id === task.expertId) ?? specialists[0]!;
						activeTaskIds.add(task.id);
						emit({ threadId, type: 'team_expert_started', taskId: task.id, expertId: task.expertId });
						const result = await runOneSpecialist({
							settings, task, expert, userRequest: effectiveUserText, planSummary, completedTasksById,
							allTasks: plannedTasks,
							modelSelection, resolvedModel,
							signal, thinkingLevel, workspaceRoot, workspaceLspManager, toolHooks,
							baseTools: baseTeamTools,
							threadId,
							pullPeerMailboxMessages: () => pullPeerMailboxMessages(task),
							handlePeerRequest: (request) => waitForRunningPeerReply(task, request),
							handlePeerReply: (reply) => {
								const resolved = clearPeerRequest(task.id, reply.requestId);
								resolved?.resolve(reply.answer);
							},
							emit,
						});
						activeTaskIds.delete(task.id);
						return { task, result };
					})
				),
				abortPromise,
			]);

			const escalatedItems = results.filter((item) => item.result.escalation);
			const settledItems = results.filter((item) => !item.result.escalation);

			for (const item of settledItems) {
				emit({
					threadId,
					type: 'team_expert_done',
					taskId: item.task.id,
					expertId: item.task.expertId,
					success: item.result.success,
					result: item.result.text,
				});
				resolveOutstandingPeerRequestsForTask(item.task, item.result.text);
				const finishedTask = {
					...item.task,
					status: (item.result.success ? 'completed' : 'failed') as TeamTaskStatus,
					result: item.result.text,
				};
				completed.push(finishedTask);
				completedTasksById.set(finishedTask.id, finishedTask);
				if (item.result.success) {
					completedIds.add(item.task.id);
				}
			}

			if (escalatedItems.length > 0) {
				const primaryEscalation = escalatedItems[0]!;
				const replanCandidates = [...escalatedItems.map((item) => item.task), ...pending];
				if (replanBudget > 0) {
					replanBudget -= 1;
					planningMessages = appendPlannerEscalationMessage(planningMessages, {
						task: primaryEscalation.task,
						escalation: primaryEscalation.result.escalation!,
						completedTasks: completed,
					});
					emit({ threadId, type: 'team_phase', phase: 'planning' });

					try {
						const revisedPlan = await llmPlanTasks({
							settings, threadId, teamLead, specialists, plannerTools, messages: planningMessages, modelSelection,
							resolvedModel, signal, thinkingLevel, workspaceRoot, workspaceLspManager, toolHooks, emit,
						});
						if (revisedPlan.clarificationAnswers.length > 0) {
							const propagated = applyTeamClarificationAnswers(
								effectiveUserText,
								planningMessages,
								revisedPlan.clarificationAnswers
							);
							effectiveUserText = propagated.userText;
							planningMessages = propagated.messages;
						}

						if (revisedPlan.mode !== 'PLAN' || revisedPlan.tasks.length === 0) {
							const deliveryText = revisedPlan.planSummary.trim() || buildClarificationNeededNarrative(hasCjkRequest);
							emit({ threadId, type: 'team_plan_summary', summary: deliveryText });
							emit({ threadId, type: 'team_phase', phase: 'delivering' });
							onDone(deliveryText, undefined, {
								phase: 'delivering',
								tasks: completed.map((task) => ({
									id: task.id,
									expertId: task.expertId,
									expertAssignmentKey: task.expertAssignmentKey,
									expertName: task.expertName,
									roleType: task.roleType,
									description: task.description,
									status: task.status,
									dependencies: task.dependencies,
									acceptanceCriteria: task.acceptanceCriteria,
									result: task.result,
								})),
								planSummary: deliveryText,
								leaderMessage: deliveryText,
								reviewSummary: '',
								reviewVerdict: null,
							});
							return;
						}

						const revisedPendingTasks = materializePlannedTasks(revisedPlan.tasks, specialists, replanCandidates);
						const diff = applyPlanDiff(replanCandidates, revisedPendingTasks);
						pending = [...diff.nextPendingTasks];
						plannedTasks = [...completed, ...pending];
						planSummary = revisedPlan.planSummary;
						consecutiveFailedBatches = 0;

						emit({ threadId, type: 'team_plan_summary', summary: planSummary });
						emit({
							threadId,
							type: 'team_plan_revised',
							revisionId: `team-plan-revision-${randomUUID()}`,
							summary: planSummary,
							reason: primaryEscalation.result.escalation!.reason,
							tasks: serializeTeamPlanTasks(pending),
							addedTaskIds: diff.addedTasks.map((task) => task.id),
							removedTaskIds: diff.removedTasks.map((task) => task.id),
							keptTaskIds: diff.keptTasks.map((task) => task.id),
						});
						emit({ threadId, type: 'team_phase', phase: 'executing' });
						continue;
					} catch {
						// Fall through to mark the escalated task as needing revision.
					}
				}

				for (const item of escalatedItems) {
					const resultText =
						replanBudget <= 0
							? `${item.result.text}\n\nReplan budget exhausted; reviewer should inspect this escalation.`
							: item.result.text;
					resolveOutstandingPeerRequestsForTask(item.task, resultText);
					emit({
						threadId,
						type: 'team_expert_done',
						taskId: item.task.id,
						expertId: item.task.expertId,
						success: false,
						result: resultText,
					});
					const revisionTask: TeamTask = {
						...item.task,
						status: 'revision',
						result: resultText,
					};
					completed.push(revisionTask);
					completedTasksById.set(revisionTask.id, revisionTask);
				}
			}

			const failedInBatch = [...settledItems, ...escalatedItems].filter((item) => !item.result.success).length;
			consecutiveFailedBatches = failedInBatch === results.length ? consecutiveFailedBatches + 1 : 0;

			if (pending.length > 0 && consecutiveFailedBatches >= maxConsecutiveFailedBatches) {
				const fallback = 'Skipped due to repeated specialist failures (team circuit breaker triggered).';
				for (const task of pending.splice(0, pending.length)) {
					emit({
						threadId, type: 'team_expert_done',
						taskId: task.id, expertId: task.expertId,
						success: false, result: fallback,
					});
					completed.push({ ...task, status: 'failed', result: fallback });
				}
				break;
			}
		}

		// ── Phase 3: LLM-based review ────────────────────────────────

		checkAbort();
		emit({ threadId, type: 'team_phase', phase: 'reviewing' });

		let review: { verdict: 'approved' | 'revision_needed'; summary: string };

		if (resolvedExperts.deliveryReviewer) {
			checkAbort();
			review = await runReviewerAgent({
				settings, threadId, reviewer: resolvedExperts.deliveryReviewer, completedTasks: completed,
				userRequest: effectiveUserText, planSummary, modelSelection, resolvedModel, signal, thinkingLevel,
				workspaceRoot, workspaceLspManager, toolHooks, baseTools: baseTeamTools, emit,
			});
		} else {
			const failed = completed.filter((t) => t.status === 'failed' || t.status === 'revision');
			review = failed.length > 0
				? { verdict: 'revision_needed', summary: `${failed.length} task(s) need revision.` }
				: { verdict: 'approved', summary: `All ${completed.length} task(s) completed successfully.` };
		}

		emit({ threadId, type: 'team_review', verdict: review.verdict, summary: review.summary });

		// ── Phase 4: Delivery ────────────────────────────────────────

		checkAbort();
		emit({ threadId, type: 'team_phase', phase: 'delivering' });

		const delivery = [
			`# Team Delivery`,
			``,
			`**Lead:** ${teamLead.name}`,
			`**Review:** ${review.verdict === 'approved' ? '✅ Approved' : '⚠️ Revision Needed'}`,
			``,
			`## Planning Summary`,
			planSummary,
			``,
			`## Specialist Outputs`,
			...completed.map((task) => {
				const body = (task.result ?? '').trim() || '(no output)';
				const statusIcon = task.status === 'completed' ? '✅' : '❌';
				return `### ${statusIcon} ${task.expertName}\n- **Task:** ${task.description}\n- **Status:** ${task.status}\n\n${body}`;
			}),
			``,
			`## Review`,
			review.summary,
			...(agentSystemAppend?.trim() ? ['', '---', agentSystemAppend.trim()] : []),
		].join('\n');

		onDone(delivery, undefined, {
			phase: 'delivering',
			tasks: completed.map((t) => ({
				id: t.id,
				expertId: t.expertId,
				expertAssignmentKey: t.expertAssignmentKey,
				expertName: t.expertName,
				roleType: t.roleType,
				description: t.description,
				status: t.status,
				dependencies: t.dependencies,
				acceptanceCriteria: t.acceptanceCriteria,
				result: t.result,
			})),
			planSummary,
			leaderMessage: planSummary,
			reviewSummary: review.summary,
			reviewVerdict: review.verdict,
		});
	} catch (error) {
		if (signal.aborted) {
			onError('Team session aborted by user.');
		} else {
			onError(error instanceof Error ? error.message : String(error));
		}
	}
}
