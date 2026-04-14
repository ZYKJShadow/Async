import { randomUUID } from 'node:crypto';
import type { ChatMessage, TeamSessionSnapshot } from '../threadStore.js';
import type { ShellSettings, TeamRoleType } from '../settingsStore.js';
import type { WorkspaceLspManager } from '../lsp/workspaceLspManager.js';
import { runAgentLoop, type AgentLoopHandlers, type AgentLoopOptions } from './agentLoop.js';
import { assembleAgentToolPool } from './agentToolPool.js';
import { AGENT_TOOLS, type AgentToolDef } from './agentTools.js';
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
	| { threadId: string; type: 'team_plan_decision'; proposalId: string; approved: boolean };

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
	const flattened = flattenAssistantTextPartsForSearch(raw).trim();
	if (flattened) {
		return flattened;
	}
	const trimmed = raw.trim();
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

function parsePlannedTasks(llmOutput: string): LLMPlannedTask[] {
	const fenceRe = /```(?:json)?\s*\n?([\s\S]*?)```/;
	const match = fenceRe.exec(llmOutput);
	const jsonStr = match ? match[1]!.trim() : llmOutput.trim();

	try {
		const parsed = JSON.parse(jsonStr);
		const arr: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
		const tasks: LLMPlannedTask[] = [];
		for (const item of arr) {
			if (typeof item !== 'object' || item === null) continue;
			const obj = item as Record<string, unknown>;
			const expert = typeof obj.expert === 'string' ? obj.expert.trim() : '';
			const task = typeof obj.task === 'string' ? obj.task.trim() : '';
			if (!expert || !task) continue;
			tasks.push({
				expert,
				task,
				dependencies: Array.isArray(obj.dependencies)
					? obj.dependencies.filter((d): d is string => typeof d === 'string')
					: undefined,
				acceptanceCriteria: Array.isArray(obj.acceptanceCriteria)
					? obj.acceptanceCriteria.filter((c): c is string => typeof c === 'string')
					: undefined,
			});
		}
		return tasks;
	} catch {
		return [];
	}
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

const TEAM_LEAD_MODE_PREFIX_RE = /^\s*(?:[*_`>#-]+\s*)*MODE\s*:\s*(?:ANSWER|PLAN|CLARIFY)\s*(?:[*_`]+)?\s*$/i;
const TEAM_LEAD_MODE_EXTRACT_RE = /^\s*(?:[*_`>#-]+\s*)*MODE\s*:\s*(ANSWER|PLAN|CLARIFY)\b/i;
const MODE_MARKER_VARIANTS = [
	'MODE: ANSWER',
	'MODE:ANSWER',
	'MODE: PLAN',
	'MODE:PLAN',
	'MODE: CLARIFY',
	'MODE:CLARIFY',
];

function isStreamingModeMarkerPrefix(text: string): boolean {
	const trimmed = text.trimStart();
	if (!trimmed || trimmed.includes('\n')) {
		return TEAM_LEAD_MODE_PREFIX_RE.test(trimmed);
	}
	const up = trimmed.toUpperCase();
	return TEAM_LEAD_MODE_PREFIX_RE.test(trimmed) || MODE_MARKER_VARIANTS.some((v) => v.startsWith(up));
}

function extractTeamLeadNarrative(text: string): string {
	const raw = String(text ?? '');
	if (isStreamingModeMarkerPrefix(raw)) {
		return '';
	}
	const normalized = raw.trim();
	if (!normalized) {
		return '';
	}
	const withoutMode = stripLeadModeMarker(normalized);
	const withoutFence = stripFencedBlocks(withoutMode);
	const withoutJson = stripTrailingRawJson(withoutFence || withoutMode);
	return (withoutJson || withoutFence || withoutMode).replace(/\n{3,}/g, '\n\n').trim();
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

function buildTeamClarificationIntro(hasCjk: boolean): string {
	return hasCjk
		? '为了避免误分配专家，我需要先确认一个关键方向。'
		: 'To avoid dispatching the wrong specialists, I need to clarify one key direction first.';
}

function buildTeamLeadPlanningToolPool(): AgentToolDef[] {
	return AGENT_TOOLS.filter((tool) => tool.name === 'ask_plan_question');
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

export function buildSpecialistTaskPacket(params: {
	task: TeamTask;
	expert: TeamExpertRuntimeProfile;
	userRequest: string;
	planSummary: string;
	completedTasksById: Map<string, TeamTask>;
}): string {
	const { task, expert, userRequest, planSummary, completedTasksById } = params;
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
		settings, threadId, teamLead, specialists, messages, modelSelection, resolvedModel,
		signal, thinkingLevel, workspaceRoot, toolHooks, emit,
	} = params;
	const hasCjk = messages.some((message) => /[\u3400-\u9fff]/.test(String(message.content ?? '')));
	const planningTools = buildTeamLeadPlanningToolPool();

	const availableRoles = specialists.map((s) => `- ${s.assignmentKey}: ${s.name}`).join('\n');
	const planMessages: ChatMessage[] = [
		...messages,
		{
			role: 'user',
			content: [
				'[SYSTEM] You are the Team Lead coordinator in a planning-only phase.',
				'You cannot read, search, or modify files.',
				planningTools.length > 0
					? 'Your only available tool is `ask_plan_question`, which opens the existing clarification UI with 3 recommended options plus a custom answer slot.'
					: 'No clarification tool is available in this session.',
				'Do NOT say you will inspect the repository, investigate code, or look at files.',
				'',
				'First, classify the request. Start your reply with EXACTLY one of these markers on the first line:',
				'- `MODE: ANSWER` — the request is a generic question unrelated to this repository/project and needs no team expertise (e.g. "what is a closure", casual chat). Follow the marker with your answer in markdown. Do NOT output a JSON block.',
				'- `MODE: CLARIFY` — the request is about this repository/project, but it is too ambiguous to assign specialists safely. Follow the marker with a concise markdown reply that explains what is missing and asks 2-4 concrete clarification questions. Do NOT output a JSON block.',
				'- `MODE: PLAN` — the request involves this repository, this project, or any domain where specialists should contribute (analysis, review, investigation, design, refactor, implementation, testing, diagnosis, documentation). Follow the marker with: (1) a brief 1-2 sentence kickoff message, then (2) a ```json fenced block containing a JSON array of task objects.',
				'',
				'Only pick ANSWER for truly generic, repo-agnostic questions that any assistant could answer in one paragraph without looking at code.',
				'Pick CLARIFY whenever the request mentions improving, optimizing, reviewing, or refactoring "the project" / "the repo" without enough detail about the target area, desired outcome, scope, constraints, or success criteria.',
				planningTools.length > 0
					? 'Before using MODE: CLARIFY, prefer calling `ask_plan_question` to collect the most important missing decision through the built-in UI. You may ask multiple clarification questions over multiple turns, but only one tool question per turn.'
					: 'If the request is ambiguous and no clarification tool is available, use MODE: CLARIFY.',
				planningTools.length > 0
					? 'Only finish with MODE: CLARIFY when the remaining ambiguity cannot be resolved as a single `ask_plan_question`, or when the user needs to reply in free-form outside the multiple-choice UI.'
					: 'If the request is ambiguous and no clarification tool is available, use MODE: CLARIFY.',
				'Pick PLAN only when you can assign concrete specialist tasks without guessing.',
				'',
				'Each PLAN task object: { "expert": "<assignment_key>", "task": "<clear instruction for the specialist>", "dependencies": [...], "acceptanceCriteria": [...] }',
				'',
				'Available specialist assignment keys:',
				availableRoles,
				'',
				'If you call `ask_plan_question`, do not repeat the same options or raw tool protocol in markdown.',
				'If the user answers an `ask_plan_question`, absorb that answer and continue planning in the same turn whenever possible.',
				'Never invent a generic frontend/backend/qa split just to keep the workflow moving.',
				'In PLAN mode: delegate ALL investigation and implementation to the specialists — do not include analysis, code, or file paths outside the JSON.',
				'Respond in the same language as the user.',
			].join('\n'),
		},
	];

	let planText = '';
	let visiblePlanText = '';
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
		composerMode: 'ask',
		toolPoolOverride: planningTools,
		agentSystemAppend: appendTeamLanguageRule(settings, teamLead.systemPrompt),
		thinkingLevel: thinkingLevel === 'off' ? 'off' : 'low',
		workspaceRoot: workspaceRoot ?? null,
		workspaceLspManager: null,
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
			const finalMode = parseLeadMode(text);
			const finalVisible =
				extractTeamLeadNarrative(text) ||
				(finalMode === 'CLARIFY' ? buildTeamClarificationIntro(hasCjk) : '') ||
				visiblePlanText ||
				buildFallbackTeamLeadNarrative(hasCjk);
			visiblePlanText = finalVisible;
			emit({ threadId, type: 'done', text: finalVisible, usage, teamRoleScope: teamLeadScope });
		},
		onError: () => {},
	};

	await runAgentLoop(settings, planMessages, options, handlers);
	const tasks = parsePlannedTasks(planText);
	const mode = parseLeadMode(planText);
	return {
		tasks: mode === 'PLAN' ? tasks : [],
		planSummary: extractTeamLeadNarrative(planText) || buildFallbackTeamLeadNarrative(hasCjk),
		mode,
		clarificationAnswers,
	};
}

function parseLeadMode(text: string): LeadPlanMode {
	const head = String(text ?? '').trimStart();
	const match = TEAM_LEAD_MODE_EXTRACT_RE.exec(head);
	if (match && match[1]) {
		const mode = match[1].toUpperCase();
		if (mode === 'PLAN' || mode === 'CLARIFY') {
			return mode;
		}
		return 'ANSWER';
	}
	if (/```(?:json)?[\s\S]*```/.test(text)) {
		return 'PLAN';
	}
	if (
		/(clarify|need more (?:info|information|context|detail)|missing (?:scope|constraints|requirements|context)|please (?:clarify|specify)|too broad|success criteria|需要澄清|请补充|不够具体|缺少(?:目标|范围|约束|上下文)|明确(?:一下)?(?:目标|范围|约束)?)/i.test(
			head
		)
	) {
		return 'CLARIFY';
	}
	return 'ANSWER';
}

function stripLeadModeMarker(text: string): string {
	return String(text ?? '')
		.replace(/^\s*(?:[*_`>#-]+\s*)*MODE\s*:\s*(?:ANSWER|PLAN|CLARIFY)\s*(?:[*_`]+)?\s*\n?/i, '')
		.replace(/^\s*(?:[*_`>#-]+\s*)*MODE\s*:\s*(?:ANSWER|PLAN|CLARIFY)\s*(?:[*_`]+)?\s*$/gim, '')
		.trim();
}

// ── Regex fallback when LLM planning fails ───────────────────────────────

function requestMentionsExpert(userText: string, expert: TeamExpertRuntimeProfile): boolean {
	const candidates = [expert.assignmentKey, expert.id, expert.name]
		.map((value) => String(value ?? '').trim().toLowerCase())
		.filter((value, index, arr) => value && (value.length >= 3 || /[^\x00-\x7f]/.test(value)) && arr.indexOf(value) === index);
	return candidates.some((value) => userText.includes(value));
}

function selectSpecialistTasksFallback(userText: string, experts: TeamExpertRuntimeProfile[]): TeamTask[] {
	const normalized = userText.toLowerCase();
	const customMatches = experts.filter((expert) => expert.roleType === 'custom' && requestMentionsExpert(normalized, expert));
	if (customMatches.length > 0) {
		return customMatches.map((profile) => ({
			id: `task-${randomUUID()}`,
			expertId: profile.id,
			expertAssignmentKey: profile.assignmentKey,
			expertName: profile.name,
			roleType: profile.roleType,
			description: `Handle the explicitly requested specialty for this request and produce a clear deliverable:\n${userText}`,
			status: 'pending',
			dependencies: [],
			acceptanceCriteria: [],
		}));
	}
	const hasFrontend = /\b(ui|ux|component|css|style|layout|react|tsx|frontend)\b|前端|界面|交互|页面|样式|组件/.test(normalized);
	const hasBackend = /\b(api|backend|server|service|endpoint|database|schema)\b|后端|接口|服务|数据库|数据层/.test(normalized);
	const hasQa = /\b(test|qa|verify|regression|coverage)\b|测试|验证|回归|覆盖率/.test(normalized);
	if (!hasFrontend && !hasBackend && !hasQa) {
		return [];
	}
	const picks: TeamTask[] = [];

	const pushTask = (role: TeamRoleType, description: string) => {
		const profile = experts.find((e) => e.roleType === role);
		if (!profile) return;
		picks.push({
			id: `task-${randomUUID()}`,
			expertId: profile.id,
			expertAssignmentKey: profile.assignmentKey,
			expertName: profile.name,
			roleType: profile.roleType,
			description,
			status: 'pending',
			dependencies: [],
			acceptanceCriteria: [],
		});
	};

	if (hasFrontend) {
		pushTask('frontend', 'Implement UI and interaction updates needed for this request.');
	}
	if (hasBackend) {
		pushTask('backend', 'Implement service/API/data-layer updates needed for this request.');
	}
	if (hasQa || picks.length > 1) {
		pushTask('qa', 'Add or update tests and verification steps for changed behavior.');
	}
	return picks;
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

// ── Researcher Agent ─────────────────────────────────────────────────────

function buildResearcherToolPool(baseTools: AgentToolDef[]): AgentToolDef[] {
	const readOnlyNames = new Set(['Read', 'Glob', 'Grep', 'LSP']);
	const readOnly = baseTools.filter((t) => readOnlyNames.has(t.name));
	const questionTool = AGENT_TOOLS.find((t) => t.name === 'ask_plan_question');
	return questionTool ? [...readOnly, questionTool] : readOnly;
}

function buildResearcherTaskPacket(params: {
	researcher: TeamExpertRuntimeProfile;
	userRequest: string;
	hasCjk: boolean;
}): string {
	const { researcher, userRequest, hasCjk } = params;
	const lang = hasCjk ? 'zh-CN' : 'en';
	return [
		`You are ${researcher.name}, the requirements researcher for this team.`,
		'Your job is to investigate the codebase and clarify the user request BEFORE the Team Lead creates a plan.',
		'',
		'## Instructions',
		'1. Read relevant files to understand the codebase context around the user request.',
		'2. Identify ambiguities, missing information, or key decisions that need user input.',
		'3. Use the `ask_plan_question` tool to ask the user targeted clarification questions (up to 3).',
		'   Each call must provide exactly 3 concrete options plus 1 custom "Other" option.',
		'4. After investigation and any clarification, produce a structured requirements summary.',
		'',
		'## User Request',
		clampTeamPacketText(userRequest),
		'',
		'## Output Format',
		'Produce your final report with these sections:',
		'### Requirements Summary',
		'### Codebase Context',
		'### Assumptions',
		'### Open Questions',
		'### Scope Boundaries',
		'',
		lang === 'zh-CN'
			? '请用中文回复。'
			: 'Respond in English.',
	].join('\n');
}

async function runResearcherAgent(params: {
	settings: ShellSettings;
	threadId: string;
	taskId: string;
	researcher: TeamExpertRuntimeProfile;
	userRequest: string;
	hasCjk: boolean;
	modelSelection: string;
	resolvedModel: TeamOrchestratorInput['resolvedModel'];
	signal: AbortSignal;
	thinkingLevel?: TeamOrchestratorInput['thinkingLevel'];
	workspaceRoot?: string | null;
	workspaceLspManager?: WorkspaceLspManager | null;
	toolHooks?: ToolExecutionHooks;
	baseTools: AgentToolDef[];
	emit: (evt: TeamEmit) => void;
}): Promise<{ summary: string }> {
	const {
		settings, threadId, taskId, researcher, userRequest, hasCjk, modelSelection, resolvedModel,
		signal, thinkingLevel, workspaceRoot, workspaceLspManager, toolHooks, baseTools, emit,
	} = params;

	const messages: ChatMessage[] = [
		{
			role: 'user',
			content: buildResearcherTaskPacket({ researcher, userRequest, hasCjk }),
		},
	];

	const researcherTask: TeamTask = {
		id: taskId,
		expertId: researcher.id,
		expertAssignmentKey: researcher.assignmentKey,
		expertName: researcher.name,
		roleType: researcher.roleType,
		description: 'Investigate the codebase and clarify user requirements before planning.',
		status: 'in_progress',
		dependencies: [],
		acceptanceCriteria: [
			'Read relevant code to build context',
			'Ask user targeted clarification questions when needed',
			'Produce a structured requirements summary',
		],
	};
	const teamRoleScope = createTeamRoleScope(researcherTask, 'specialist');
	const researcherTools = buildResearcherToolPool(baseTools);

	let researchText = '';

	const options: AgentLoopOptions = {
		modelSelection: researcher.preferredModelId?.trim() || modelSelection,
		requestModelId: resolvedModel.requestModelId,
		paradigm: resolvedModel.paradigm,
		requestApiKey: resolvedModel.apiKey,
		requestBaseURL: resolvedModel.baseURL,
		requestProxyUrl: resolvedModel.proxyUrl,
		maxOutputTokens: resolvedModel.maxOutputTokens,
		signal,
		composerMode: 'agent',
		toolPoolOverride: researcherTools,
		agentSystemAppend: appendTeamLanguageRule(settings, researcher.systemPrompt),
		thinkingLevel: thinkingLevel === 'off' ? 'off' : 'low',
		workspaceRoot: workspaceRoot ?? null,
		workspaceLspManager,
		threadId,
		toolHooks,
		teamToolRoleScope: teamRoleScope,
	};

	if (researcher.preferredModelId?.trim() && researcher.preferredModelId.trim() !== modelSelection) {
		const resolved = resolveModelRequest(settings, researcher.preferredModelId.trim());
		if (resolved.ok) {
			options.modelSelection = researcher.preferredModelId.trim();
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
			researchText += text;
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
			researchText = text;
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
			name: researcher.name,
			phase: 'starting',
			detail: 'Investigating the codebase and clarifying requirements.',
			teamRoleScope,
		});
		await runAgentLoop(settings, messages, options, handlers);
	} catch {
		// Degrade gracefully — caller will proceed without research context.
	}

	const summary = normalizeTeamAgentSummary(
		researchText,
		'Research phase did not produce a summary; proceeding to planning.'
	);
	return { summary };
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
	if (!expert.allowedTools || expert.allowedTools.length === 0) {
		return base;
	}
	const allow = new Set(expert.allowedTools);
	return base.filter((tool) => allow.has(tool.name));
}

async function runOneSpecialist(params: {
	settings: ShellSettings;
	task: TeamTask;
	expert: TeamExpertRuntimeProfile;
	userRequest: string;
	planSummary: string;
	completedTasksById: Map<string, TeamTask>;
	modelSelection: string;
	resolvedModel: TeamOrchestratorInput['resolvedModel'];
	signal: AbortSignal;
	thinkingLevel?: TeamOrchestratorInput['thinkingLevel'];
	workspaceRoot?: string | null;
	workspaceLspManager?: WorkspaceLspManager | null;
	toolHooks?: ToolExecutionHooks;
	baseTools: AgentToolDef[];
	threadId: string;
	emit: (evt: TeamEmit) => void;
}): Promise<{ success: boolean; text: string }> {
	const {
		settings, task, expert, userRequest, planSummary, completedTasksById, modelSelection, resolvedModel,
		signal, thinkingLevel, workspaceRoot, workspaceLspManager, toolHooks, baseTools,
		threadId, emit,
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
			}),
		},
	];
	const specializedToolPool = buildSpecialistToolPool(baseTools, expert);
	let finalText = '';
	let success = true;
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
		threadId,
		toolHooks,
		teamToolRoleScope: teamRoleScope,
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
		await runAgentLoop(settings, subMessages, options, handlers);
	} catch (error) {
		success = false;
		finalText = error instanceof Error ? error.message : String(error);
	}
	return { success, text: finalText };
}

// ── Dependency-aware scheduling ──────────────────────────────────────────

function getReadyTasks(pending: TeamTask[], completedIds: Set<string>): TeamTask[] {
	return pending.filter((t) =>
		t.dependencies.length === 0 || t.dependencies.every((dep) => completedIds.has(dep))
	);
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
		const experts = resolveTeamExpertProfiles(settings.team, baseTeamTools);
		const teamLead = experts.find((e) => e.assignmentKey === 'team_lead') ?? experts.find((e) => e.roleType === 'team_lead');
		const reviewerExpert = experts.find((e) => e.assignmentKey === 'reviewer') ?? experts.find((e) => e.roleType === 'reviewer');
		const researcherExpert = experts.find((e) => e.assignmentKey === 'researcher');
		const specialists = experts.filter((e) => e.id !== teamLead?.id && e.id !== reviewerExpert?.id && e.id !== researcherExpert?.id);
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

		// ── Phase 0: Researcher investigation ────────────────────────
		const presetDefaults = getTeamPresetDefaults(settings.team?.presetId);
		const enableResearchPhase = settings.team?.enableResearchPhase ?? presetDefaults.enableResearchPhase;
		let researchSummary = '';
		let planningMessages = messages;

		if (enableResearchPhase && researcherExpert) {
			checkAbort();
			emit({ threadId, type: 'team_phase', phase: 'researching' });
			const researcherTaskId = `task-researcher-${randomUUID()}`;
			emit({
				threadId,
				type: 'team_task_created',
				task: {
					id: researcherTaskId,
					expertId: researcherExpert.id,
					expertAssignmentKey: researcherExpert.assignmentKey,
					expertName: researcherExpert.name,
					roleType: researcherExpert.roleType,
					description: 'Investigate the codebase and clarify user requirements before planning.',
					status: 'pending',
					dependencies: [],
					acceptanceCriteria: [
						'Read relevant code to build context',
						'Ask user targeted clarification questions when needed',
						'Produce a structured requirements summary',
					],
				},
			});
			emit({ threadId, type: 'team_expert_started', taskId: researcherTaskId, expertId: researcherExpert.id });
			try {
				const research = await runResearcherAgent({
					settings, threadId, taskId: researcherTaskId, researcher: researcherExpert,
					userRequest: effectiveUserText, hasCjk: hasCjkRequest,
					modelSelection, resolvedModel, signal, thinkingLevel,
					workspaceRoot, workspaceLspManager, toolHooks, baseTools: baseTeamTools, emit,
				});
				researchSummary = research.summary;
				emit({
					threadId, type: 'team_expert_done',
					taskId: researcherTaskId, expertId: researcherExpert.id,
					success: true, result: researchSummary,
				});
				if (researchSummary.trim()) {
					effectiveUserText = [
						effectiveUserText.trim(),
						'',
						'[RESEARCH CONTEXT]',
						researchSummary.trim(),
					].join('\n').trim();
					planningMessages = [
						...messages,
						{
							role: 'user',
							content: [
								'[RESEARCH CONTEXT — from the team Researcher who investigated the codebase]',
								researchSummary.trim(),
								'',
								'Use this research context to inform your planning. Do not repeat the investigation.',
							].join('\n'),
						},
					];
				}
			} catch (err) {
				if (signal.aborted) throw err;
				emit({
					threadId, type: 'team_expert_done',
					taskId: researcherTaskId, expertId: researcherExpert.id,
					success: false, result: 'Research phase failed; proceeding without research context.',
				});
			}
		}

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
					settings, threadId, teamLead, specialists, messages: planningMessages, modelSelection,
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
					const taskIdMap = new Map<string, string>();
					plannedTasks = planResult.tasks.map((pt) => {
						const expert = matchExpert(pt.expert, specialists) ?? specialists[0]!;
						const taskId = `task-${randomUUID()}`;
						taskIdMap.set(pt.expert, taskId);
						return {
							id: taskId,
							expertId: expert.id,
							expertAssignmentKey: expert.assignmentKey,
							expertName: expert.name,
							roleType: expert.roleType,
							description: pt.task,
							status: 'pending' as TeamTaskStatus,
							dependencies: (pt.dependencies ?? [])
								.map((d) => taskIdMap.get(d) ?? '')
								.filter(Boolean),
							acceptanceCriteria: pt.acceptanceCriteria ?? [],
						};
					});
				}
			} catch {
				// LLM planning failed — fall through to fallback
			}

			if (plannedTasks.length === 0) {
				plannedTasks = selectSpecialistTasksFallback(effectiveUserText, specialists);
				if (plannedTasks.length > 0) {
					planSummary = hasCjkRequest
						? '我已按明确提到的技术方向完成角色分派，接下来会等待各成员反馈并统一汇报。'
						: 'I assigned specialists only for the explicitly requested technical areas and will report back after their findings come in.';
				}
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
			if (enablePreflightReview && reviewerExpert) {
				checkAbort();
				emit({ threadId, type: 'team_phase', phase: 'preflight' });
				try {
					const preflight = await runPreflightReviewerAgent({
						settings, threadId, reviewer: reviewerExpert, plannedTasks,
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
		const pending = [...plannedTasks];
		const completed: TeamTask[] = [];
		const completedIds = new Set<string>();
		const completedTasksById = new Map<string, TeamTask>();
		const maxConsecutiveFailedBatches = 2;
		let consecutiveFailedBatches = 0;

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
						emit({ threadId, type: 'team_expert_started', taskId: task.id, expertId: task.expertId });
						const result = await runOneSpecialist({
							settings, task, expert, userRequest: effectiveUserText, planSummary, completedTasksById,
							modelSelection, resolvedModel,
							signal, thinkingLevel, workspaceRoot, workspaceLspManager, toolHooks,
							baseTools: baseTeamTools, threadId, emit,
						});
						emit({
							threadId, type: 'team_expert_done',
							taskId: task.id, expertId: task.expertId,
							success: result.success, result: result.text,
						});
						return { task, result };
					})
				),
				abortPromise,
			]);

			for (const item of results) {
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

			const failedInBatch = results.filter((item) => !item.result.success).length;
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

		if (reviewerExpert) {
			checkAbort();
			review = await runReviewerAgent({
				settings, threadId, reviewer: reviewerExpert, completedTasks: completed,
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
