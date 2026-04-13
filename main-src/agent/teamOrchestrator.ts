import { randomUUID } from 'node:crypto';
import type { ChatMessage } from '../threadStore.js';
import type { ShellSettings, TeamRoleType } from '../settingsStore.js';
import type { WorkspaceLspManager } from '../lsp/workspaceLspManager.js';
import { runAgentLoop, type AgentLoopHandlers, type AgentLoopOptions } from './agentLoop.js';
import { assembleAgentToolPool } from './agentToolPool.js';
import type { AgentToolDef } from './agentTools.js';
import {
	clampTeamParallel,
	resolveTeamExpertProfiles,
	type TeamExpertRuntimeProfile,
} from './teamExpertProfiles.js';
import { resolveModelRequest, type ResolvedModelRequest } from '../llm/modelResolve.js';

type TeamPhase = 'planning' | 'executing' | 'reviewing' | 'delivering' | 'waiting_user';
type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'revision';

type TeamTask = {
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
	| { threadId: string; type: 'team_plan_summary'; summary: string };

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
	requestUserInput?: (question: string, options?: string[]) => Promise<string>;
	emit: (evt: TeamEmit) => void;
	onDone: (fullText: string, usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }) => void;
	onError: (message: string) => void;
};

// ── LLM-based task planning ──────────────────────────────────────────────

type LLMPlannedTask = {
	expert: string;
	task: string;
	dependencies?: string[];
	acceptanceCriteria?: string[];
};

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

async function llmPlanTasks(params: {
	settings: ShellSettings;
	teamLead: TeamExpertRuntimeProfile;
	specialists: TeamExpertRuntimeProfile[];
	messages: ChatMessage[];
	modelSelection: string;
	resolvedModel: TeamOrchestratorInput['resolvedModel'];
	signal: AbortSignal;
	thinkingLevel?: TeamOrchestratorInput['thinkingLevel'];
	workspaceRoot?: string | null;
	workspaceLspManager?: WorkspaceLspManager | null;
	baseTools: AgentToolDef[];
}): Promise<{ tasks: LLMPlannedTask[]; planSummary: string }> {
	const {
		settings, teamLead, specialists, messages, modelSelection, resolvedModel,
		signal, thinkingLevel, workspaceRoot, workspaceLspManager, baseTools,
	} = params;

	const availableRoles = specialists.map((s) => `- ${s.assignmentKey}: ${s.name}`).join('\n');
	const planMessages: ChatMessage[] = [
		...messages,
		{
			role: 'user',
			content: [
				'You are the Team Lead. Analyze the user\'s request above and decompose it into specialist tasks.',
				'',
				'Available specialists:',
				availableRoles,
				'',
				'Respond with:',
				'1. A brief analysis of the request (2-3 sentences).',
				'2. A JSON array in a ```json fenced block with the task assignments.',
				'Each task object must have: "expert" (assignment key), "task" (clear instruction), optionally "dependencies" and "acceptanceCriteria".',
			].join('\n'),
		},
	];

	let planText = '';
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
		toolPoolOverride: baseTools.filter((t) => ['Read', 'Glob', 'Grep', 'LSP'].includes(t.name)),
		agentSystemAppend: teamLead.systemPrompt,
		thinkingLevel,
		workspaceRoot,
		workspaceLspManager,
		threadId: null,
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
		onTextDelta: (text) => { planText += text; },
		onToolCall: () => {},
		onToolResult: () => {},
		onDone: (text) => { planText = text; },
		onError: () => {},
	};

	await runAgentLoop(settings, planMessages, options, handlers);
	const tasks = parsePlannedTasks(planText);
	return { tasks, planSummary: planText };
}

// ── Regex fallback when LLM planning fails ───────────────────────────────

function selectSpecialistTasksFallback(userText: string, experts: TeamExpertRuntimeProfile[]): TeamTask[] {
	if (experts.some((expert) => expert.roleType === 'custom')) {
		return experts.map((profile) => ({
			id: `task-${randomUUID()}`,
			expertId: profile.id,
			expertAssignmentKey: profile.assignmentKey,
			expertName: profile.name,
			roleType: profile.roleType,
			description: `Contribute your specialty to this request and produce a clear deliverable:\n${userText}`,
			status: 'pending',
			dependencies: [],
			acceptanceCriteria: [],
		}));
	}
	const normalized = userText.toLowerCase();
	const hasFrontend = /\b(ui|ux|component|css|style|layout|react|tsx|frontend)\b/.test(normalized);
	const hasBackend = /\b(api|backend|server|service|endpoint|database|schema)\b/.test(normalized);
	const hasQa = /\b(test|qa|verify|regression|coverage)\b/.test(normalized);
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

	if (hasFrontend || (!hasBackend && !hasQa)) {
		pushTask('frontend', 'Implement UI and interaction updates needed for this request.');
	}
	if (hasBackend || (!hasFrontend && !hasQa)) {
		pushTask('backend', 'Implement service/API/data-layer updates needed for this request.');
	}
	if (hasQa || picks.length > 1) {
		pushTask('qa', 'Add or update tests and verification steps for changed behavior.');
	}
	return picks;
}

// ── LLM-based Reviewer Agent ─────────────────────────────────────────────

async function runReviewerAgent(params: {
	settings: ShellSettings;
	reviewer: TeamExpertRuntimeProfile;
	completedTasks: TeamTask[];
	messages: ChatMessage[];
	modelSelection: string;
	resolvedModel: TeamOrchestratorInput['resolvedModel'];
	signal: AbortSignal;
	thinkingLevel?: TeamOrchestratorInput['thinkingLevel'];
	workspaceRoot?: string | null;
	workspaceLspManager?: WorkspaceLspManager | null;
	baseTools: AgentToolDef[];
}): Promise<{ verdict: 'approved' | 'revision_needed'; summary: string }> {
	const {
		settings, reviewer, completedTasks, messages, modelSelection, resolvedModel,
		signal, thinkingLevel, workspaceRoot, workspaceLspManager, baseTools,
	} = params;

	const taskSummary = completedTasks.map((t) => [
		`### ${t.expertName} (${t.roleType}) — ${t.status}`,
		`Task: ${t.description}`,
		`Output:\n${(t.result ?? '').trim().slice(0, 3000) || '(no output)'}`,
	].join('\n')).join('\n\n');

	const reviewMessages: ChatMessage[] = [
		...messages,
		{
			role: 'user',
			content: [
				'You are the Reviewer. The following specialist tasks have been completed.',
				'Review the code changes for correctness, regressions, and quality.',
				'',
				taskSummary,
				'',
				'Respond with your review following your review checklist.',
				'Your verdict line MUST start with exactly "### Verdict: APPROVED" or "### Verdict: NEEDS_REVISION".',
			].join('\n'),
		},
	];

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
		agentSystemAppend: reviewer.systemPrompt,
		thinkingLevel,
		workspaceRoot,
		workspaceLspManager,
		threadId: null,
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
		onTextDelta: (text) => { reviewText += text; },
		onToolCall: () => {},
		onToolResult: () => {},
		onDone: (text) => { reviewText = text; },
		onError: () => {},
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

	const summary = reviewText.trim() || (
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
	messages: ChatMessage[];
	modelSelection: string;
	resolvedModel: TeamOrchestratorInput['resolvedModel'];
	signal: AbortSignal;
	thinkingLevel?: TeamOrchestratorInput['thinkingLevel'];
	workspaceRoot?: string | null;
	workspaceLspManager?: WorkspaceLspManager | null;
	baseTools: AgentToolDef[];
	threadId: string;
	emit: (evt: TeamEmit) => void;
}): Promise<{ success: boolean; text: string }> {
	const {
		settings, task, expert, messages, modelSelection, resolvedModel,
		signal, thinkingLevel, workspaceRoot, workspaceLspManager, baseTools,
		threadId, emit,
	} = params;

	const subMessages: ChatMessage[] = [
		...messages,
		{
			role: 'user',
			content: `Specialist task (${expert.name}):\n${task.description}`,
		},
	];
	const specializedToolPool = buildSpecialistToolPool(baseTools, expert);
	let finalText = '';
	let success = true;

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
		agentSystemAppend: expert.systemPrompt,
		thinkingLevel,
		workspaceRoot,
		workspaceLspManager,
		threadId: null,
	};

	const handlers: AgentLoopHandlers = {
		onTextDelta: (text) => {
			finalText += text;
			emit({
				threadId,
				type: 'team_expert_progress',
				taskId: task.id,
				expertId: task.expertId,
				delta: text,
			});
		},
		onToolCall: (name, _args, _id) => {
			emit({
				threadId,
				type: 'team_expert_progress',
				taskId: task.id,
				expertId: task.expertId,
				message: `Calling tool: ${name}`,
			});
		},
		onToolResult: (name, _result, toolSuccess, _id) => {
			emit({
				threadId,
				type: 'team_expert_progress',
				taskId: task.id,
				expertId: task.expertId,
				message: `Tool ${name}: ${toolSuccess ? 'success' : 'failed'}`,
			});
		},
		onDone: (text) => {
			finalText = text;
		},
		onError: (message) => {
			success = false;
			finalText = message;
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
		requestUserInput, emit, onDone, onError,
	} = input;

	try {
		const latestUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
		let effectiveUserText = latestUser;

		if (latestUser.trim().length < 20 && requestUserInput) {
			emit({ threadId, type: 'team_phase', phase: 'waiting_user' });
			const extra = await requestUserInput('Please provide a bit more detail on the expected delivery.', [
				'Focus on frontend',
				'Focus on backend',
				'Focus on end-to-end implementation',
			]);
			if (extra.trim()) {
				effectiveUserText = `${latestUser}\n\nUser clarification: ${extra.trim()}`;
			}
		}

		const baseTeamTools = assembleAgentToolPool('team', {
			mcpToolDenyPrefixes: settings.mcpToolDenyPrefixes,
		});
		const experts = resolveTeamExpertProfiles(settings.team, baseTeamTools);
		const teamLead = experts.find((e) => e.assignmentKey === 'team_lead') ?? experts.find((e) => e.roleType === 'team_lead');
		const reviewerExpert = experts.find((e) => e.assignmentKey === 'reviewer') ?? experts.find((e) => e.roleType === 'reviewer');
		const specialists = experts.filter((e) => e.id !== teamLead?.id && e.id !== reviewerExpert?.id);

		if (!teamLead || specialists.length === 0) {
			onError('Team mode requires at least one Team Lead and one enabled specialist.');
			return;
		}

		const checkAbort = () => {
			if (signal.aborted) throw new Error('Team session aborted by user.');
		};

		// ── Phase 1: LLM-based planning ──────────────────────────────

		checkAbort();
		emit({ threadId, type: 'team_phase', phase: 'planning' });

		let plannedTasks: TeamTask[] = [];
		let planSummary = '';

		try {
			const planResult = await llmPlanTasks({
				settings, teamLead, specialists, messages, modelSelection,
				resolvedModel, signal, thinkingLevel, workspaceRoot, workspaceLspManager,
				baseTools: baseTeamTools,
			});
			planSummary = planResult.planSummary;

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
			planSummary = 'Task planning used keyword-based fallback.';
		}

		if (plannedTasks.length === 0) {
			onError('No specialist task could be generated for Team mode.');
			return;
		}

		emit({ threadId, type: 'team_plan_summary', summary: planSummary });

		for (const task of plannedTasks) {
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
		}

		// ── Phase 2: Dependency-aware parallel execution ─────────────

		checkAbort();
		emit({ threadId, type: 'team_phase', phase: 'executing' });
		const maxParallel = clampTeamParallel(settings.team?.maxParallelExperts);
		const pending = [...plannedTasks];
		const completed: TeamTask[] = [];
		const completedIds = new Set<string>();
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

			const batch = ready.slice(0, maxParallel);
			for (const bt of batch) {
				const idx = pending.indexOf(bt);
				if (idx !== -1) pending.splice(idx, 1);
			}

			const results = await Promise.all(
				batch.map(async (task) => {
					const expert = specialists.find((s) => s.id === task.expertId) ?? specialists[0]!;
					emit({ threadId, type: 'team_expert_started', taskId: task.id, expertId: task.expertId });
					const result = await runOneSpecialist({
						settings, task, expert, messages, modelSelection, resolvedModel,
						signal, thinkingLevel, workspaceRoot, workspaceLspManager,
						baseTools: baseTeamTools, threadId, emit,
					});
					emit({
						threadId, type: 'team_expert_done',
						taskId: task.id, expertId: task.expertId,
						success: result.success, result: result.text,
					});
					return { task, result };
				})
			);

			for (const item of results) {
				const finishedTask = {
					...item.task,
					status: (item.result.success ? 'completed' : 'failed') as TeamTaskStatus,
					result: item.result.text,
				};
				completed.push(finishedTask);
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
			review = await runReviewerAgent({
				settings, reviewer: reviewerExpert, completedTasks: completed,
				messages, modelSelection, resolvedModel, signal, thinkingLevel,
				workspaceRoot, workspaceLspManager, baseTools: baseTeamTools,
			});
		} else {
			const failed = completed.filter((t) => t.status === 'failed' || t.status === 'revision');
			review = failed.length > 0
				? { verdict: 'revision_needed', summary: `${failed.length} task(s) need revision.` }
				: { verdict: 'approved', summary: `All ${completed.length} task(s) completed successfully.` };
		}

		emit({ threadId, type: 'team_review', verdict: review.verdict, summary: review.summary });

		// ── Phase 4: Delivery ────────────────────────────────────────

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

		onDone(delivery);
	} catch (error) {
		onError(error instanceof Error ? error.message : String(error));
	}
}
