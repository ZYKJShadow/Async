import type {
	AiCollabMessage,
	AiEmployeesOrchestrationState,
	AiOrchestrationApprovalState,
	AiOrchestrationHandoff,
	AiOrchestrationHandoffStatus,
	AiOrchestrationRun,
	AiOrchestrationTimelineEvent,
	AiRunPlanItem,
	AiSubAgentJob,
	AiSubAgentToolEntry,
} from '../../../shared/aiEmployeesSettings';

export function emptyOrchestrationState(): AiEmployeesOrchestrationState {
	return { runs: [], timelineEvents: [], collabMessages: [] };
}

export function createDraftRun(
	goal: string,
	targetBranch: string | undefined,
	nowIso: string,
	id: string,
	extra?: Partial<AiOrchestrationRun>
): AiOrchestrationRun {
	return {
		id,
		goal: goal.trim(),
		targetBranch: targetBranch?.trim() || undefined,
		status: 'draft',
		createdAtIso: nowIso,
		handoffs: [],
		subAgentJobs: [],
		gitApproved: false,
		statusSummary: 'Run created',
		lastEventAtIso: nowIso,
		approvalState: 'none',
		...extra,
	};
}

function sortRuns(runs: AiOrchestrationRun[]): AiOrchestrationRun[] {
	return [...runs].sort((a, b) => {
		const aTime = Date.parse(a.lastEventAtIso ?? a.createdAtIso);
		const bTime = Date.parse(b.lastEventAtIso ?? b.createdAtIso);
		return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
	});
}

function deriveRunStatusSummary(run: AiOrchestrationRun): string | undefined {
	if (run.status === 'cancelled') {
		return run.statusSummary;
	}
	const blocked = [...run.handoffs].reverse().find((handoff) => handoff.status === 'blocked');
	if (blocked?.blockedReason) {
		return blocked.blockedReason;
	}
	if (blocked) {
		return blocked.note ?? 'Blocked';
	}
	const active = [...run.handoffs].reverse().find((handoff) => handoff.status === 'in_progress');
	if (active) {
		return active.note ?? 'In progress';
	}
	const pending = run.handoffs.find((handoff) => handoff.status === 'pending');
	if (pending) {
		return pending.note ?? 'Pending handoff';
	}
	const done = [...run.handoffs].reverse().find((handoff) => handoff.status === 'done');
	if (done?.resultSummary) {
		return done.resultSummary;
	}
	if (run.gitApproved) {
		return 'Git approved';
	}
	return run.statusSummary;
}

function deriveCurrentAssignee(run: AiOrchestrationRun): string | undefined {
	if (run.status === 'cancelled') {
		return undefined;
	}
	const active = [...run.handoffs].reverse().find((handoff) => handoff.status === 'in_progress');
	if (active) {
		return active.toEmployeeId;
	}
	const pending = run.handoffs.find((handoff) => handoff.status === 'pending');
	return pending?.toEmployeeId ?? run.currentAssigneeEmployeeId;
}

function deriveApprovalState(run: AiOrchestrationRun): AiOrchestrationApprovalState {
	if (run.status === 'cancelled') {
		return 'none';
	}
	if (run.gitApproved) {
		return 'approved';
	}
	if (run.status === 'awaiting_approval') {
		return run.approvalState === 'pending_handoff' ? 'pending_handoff' : 'pending_git';
	}
	return run.approvalState ?? 'none';
}

function deriveRunStatus(run: AiOrchestrationRun): AiOrchestrationRun['status'] {
	if (run.gitApproved) {
		return 'completed';
	}
	if (run.status === 'cancelled') {
		return 'cancelled';
	}
	if (run.approvalState === 'pending_git' || run.approvalState === 'pending_handoff') {
		return 'awaiting_approval';
	}
	if (run.handoffs.some((handoff) => handoff.status === 'blocked')) {
		return 'running';
	}
	if (run.handoffs.length === 0) {
		return run.status;
	}
	if (run.handoffs.every((handoff) => handoff.status === 'done')) {
		return 'awaiting_approval';
	}
	return 'running';
}

function finalizeRun(run: AiOrchestrationRun): AiOrchestrationRun {
	const base = { ...run, subAgentJobs: run.subAgentJobs ?? [] };
	const statusSummary = deriveRunStatusSummary(base);
	const currentAssigneeEmployeeId = deriveCurrentAssignee(base);
	const approvalState = deriveApprovalState(base);
	const status = deriveRunStatus({ ...base, statusSummary, currentAssigneeEmployeeId, approvalState });
	return {
		...base,
		statusSummary,
		currentAssigneeEmployeeId,
		approvalState,
		status,
	};
}

export function upsertRun(state: AiEmployeesOrchestrationState, run: AiOrchestrationRun): AiEmployeesOrchestrationState {
	const rest = state.runs.filter((existing) => existing.id !== run.id);
	return {
		...state,
		runs: sortRuns([finalizeRun(run), ...rest]),
		activeRunId: state.activeRunId ?? run.id,
	};
}

export function updateRunInState(
	state: AiEmployeesOrchestrationState,
	runId: string,
	updater: (run: AiOrchestrationRun) => AiOrchestrationRun
): AiEmployeesOrchestrationState {
	return {
		...state,
		runs: sortRuns(
			state.runs.map((run) => (run.id === runId ? finalizeRun(updater(run)) : run))
		),
	};
}

export function approveGitForRun(state: AiEmployeesOrchestrationState, runId: string): AiEmployeesOrchestrationState {
	return updateRunInState(state, runId, (run) => ({
		...run,
		gitApproved: true,
		status: 'completed',
		approvalState: 'approved',
		statusSummary: 'Git commit approved',
	}));
}

export function addHandoff(
	run: AiOrchestrationRun,
	handoff: AiOrchestrationHandoff
): AiOrchestrationRun {
	const nextStatus = run.handoffs.some((existing) => existing.status === 'in_progress') ? handoff.status : 'in_progress';
	return finalizeRun({
		...run,
		status: 'running',
		handoffs: [...run.handoffs, { ...handoff, status: nextStatus }],
		currentAssigneeEmployeeId: nextStatus === 'in_progress' ? handoff.toEmployeeId : run.currentAssigneeEmployeeId,
		statusSummary: handoff.note ?? run.statusSummary,
		lastEventAtIso: handoff.atIso,
	});
}

export function addHandoffToRunInState(
	state: AiEmployeesOrchestrationState,
	runId: string,
	handoff: AiOrchestrationHandoff
): AiEmployeesOrchestrationState {
	return updateRunInState(state, runId, (run) => addHandoff(run, handoff));
}

export function setHandoffStatusInState(
	state: AiEmployeesOrchestrationState,
	runId: string,
	handoffId: string,
	status: AiOrchestrationHandoffStatus,
	options?: { blockedReason?: string; resultSummary?: string; taskId?: string; atIso?: string }
): AiEmployeesOrchestrationState {
	return updateRunInState(state, runId, (run) => {
		const handoffs = run.handoffs.map((handoff) => {
			if (handoff.id !== handoffId) {
				return handoff;
			}
			return {
				...handoff,
				status,
				blockedReason: status === 'blocked' ? options?.blockedReason ?? handoff.blockedReason : handoff.blockedReason,
				resultSummary: status === 'done' ? options?.resultSummary ?? handoff.resultSummary : handoff.resultSummary,
				taskId: options?.taskId ?? handoff.taskId,
			};
		});
		const activeExists = handoffs.some((handoff) => handoff.status === 'in_progress');
		const nextPendingIndex = handoffs.findIndex((handoff) => handoff.status === 'pending');
		const normalized = !activeExists && status === 'done' && nextPendingIndex >= 0
			? handoffs.map((handoff, index) => (index === nextPendingIndex ? { ...handoff, status: 'in_progress' as const } : handoff))
			: handoffs;
		return finalizeRun({
			...run,
			handoffs: normalized,
			lastEventAtIso: options?.atIso ?? run.lastEventAtIso,
		});
	});
}

export function appendTimelineEventToState(
	state: AiEmployeesOrchestrationState,
	event: AiOrchestrationTimelineEvent
): AiEmployeesOrchestrationState {
	const existingIndex = state.timelineEvents.findIndex((item) => item.id === event.id);
	const timelineEvents = [...state.timelineEvents];
	if (existingIndex >= 0) {
		timelineEvents[existingIndex] = event;
	} else {
		timelineEvents.push(event);
	}
	const nextState = updateRunInState(state, event.runId, (run) => ({
		...run,
		lastEventAtIso: event.createdAtIso,
		statusSummary: event.description ?? event.label,
	}));
	return {
		...nextState,
		timelineEvents: timelineEvents.sort((a, b) => Date.parse(a.createdAtIso) - Date.parse(b.createdAtIso)),
	};
}

export function upsertCollabMessageInState(
	state: AiEmployeesOrchestrationState,
	message: AiCollabMessage
): AiEmployeesOrchestrationState {
	const index = state.collabMessages.findIndex((item) => item.id === message.id);
	const collabMessages = [...state.collabMessages];
	if (index >= 0) {
		collabMessages[index] = message;
	} else {
		collabMessages.push(message);
	}
	return {
		...state,
		collabMessages: collabMessages.sort((a, b) => Date.parse(a.createdAtIso) - Date.parse(b.createdAtIso)),
	};
}

export function markCollabMessageReadInState(
	state: AiEmployeesOrchestrationState,
	messageId: string,
	readAtIso: string
): AiEmployeesOrchestrationState {
	return {
		...state,
		collabMessages: state.collabMessages.map((message) =>
			message.id === messageId ? { ...message, readAtIso } : message
		),
	};
}

export function linkTaskToHandoffInState(
	state: AiEmployeesOrchestrationState,
	runId: string,
	handoffId: string,
	taskId: string
): AiEmployeesOrchestrationState {
	return updateRunInState(state, runId, (run) => ({
		...run,
		handoffs: run.handoffs.map((handoff) => (handoff.id === handoffId ? { ...handoff, taskId } : handoff)),
	}));
}

export function setRunIssueInState(
	state: AiEmployeesOrchestrationState,
	runId: string,
	issueId: string
): AiEmployeesOrchestrationState {
	return updateRunInState(state, runId, (run) => ({ ...run, issueId }));
}

export function findRunByTaskId(state: AiEmployeesOrchestrationState, taskId: string): AiOrchestrationRun | undefined {
	return state.runs.find((run) => run.handoffs.some((handoff) => handoff.taskId === taskId));
}

export function findNextPendingHandoff(run: AiOrchestrationRun): AiOrchestrationHandoff | undefined {
	return run.handoffs.find((handoff) => handoff.status === 'pending');
}

export function addSubAgentJobToRun(
	state: AiEmployeesOrchestrationState,
	runId: string,
	job: AiSubAgentJob
): AiEmployeesOrchestrationState {
	return updateRunInState(state, runId, (run) => ({
		...run,
		subAgentJobs: [...(run.subAgentJobs ?? []), job],
		lastEventAtIso: job.queuedAtIso,
	}));
}

export function updateSubAgentJobInRun(
	state: AiEmployeesOrchestrationState,
	runId: string,
	jobId: string,
	updater: (job: AiSubAgentJob) => AiSubAgentJob
): AiEmployeesOrchestrationState {
	return updateRunInState(state, runId, (run) => {
		const jobs = run.subAgentJobs ?? [];
		const idx = jobs.findIndex((j) => j.id === jobId);
		if (idx < 0) {
			return run;
		}
		const nextJobs = [...jobs];
		nextJobs[idx] = updater(nextJobs[idx]);
		return { ...run, subAgentJobs: nextJobs };
	});
}

export function setRunPlanInState(
	state: AiEmployeesOrchestrationState,
	runId: string,
	plan: AiRunPlanItem[],
	planSource: 'ceo' | 'user',
	lastEventAtIso: string
): AiEmployeesOrchestrationState {
	return updateRunInState(state, runId, (run) => ({
		...run,
		plan,
		planSource,
		lastEventAtIso,
	}));
}

function normalizePlanTitle(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function pickPlanItemForDelegation(
	run: AiOrchestrationRun,
	taskTitle: string,
	ownerEmployeeId: string,
	planItemId?: string
): AiRunPlanItem | undefined {
	const plan = run.plan ?? [];
	if (!plan.length) {
		return undefined;
	}
	if (planItemId) {
		const explicit = plan.find((item) => item.id === planItemId);
		if (explicit) {
			return explicit;
		}
	}
	const titleKey = normalizePlanTitle(taskTitle);
	const candidates = plan.filter((item) => !item.subAgentJobId || item.status === 'pending');
	if (titleKey) {
		const sameTitle = candidates.find((item) => normalizePlanTitle(item.title) === titleKey);
		if (sameTitle) {
			return sameTitle;
		}
	}
	const sameOwner = candidates.find((item) => item.ownerEmployeeId === ownerEmployeeId);
	if (sameOwner) {
		return sameOwner;
	}
	return candidates[0];
}

export function linkDelegatedJobToPlanInState(
	state: AiEmployeesOrchestrationState,
	runId: string,
	input: {
		jobId: string;
		taskTitle: string;
		ownerEmployeeId: string;
		nowIso: string;
		planItemId?: string;
	}
): AiEmployeesOrchestrationState {
	return updateRunInState(state, runId, (run) => {
		const existingPlan = run.plan ?? [];
		if (!existingPlan.length) {
			const synthetic: AiRunPlanItem = {
				id: crypto.randomUUID(),
				runId,
				title: input.taskTitle,
				ownerEmployeeId: input.ownerEmployeeId,
				subAgentJobId: input.jobId,
				status: 'in_progress',
				createdAtIso: input.nowIso,
			};
			return {
				...run,
				plan: [synthetic],
				planSource: run.planSource ?? 'ceo',
				lastEventAtIso: input.nowIso,
			};
		}
		const matched = pickPlanItemForDelegation(run, input.taskTitle, input.ownerEmployeeId, input.planItemId);
		if (!matched) {
			const synthetic: AiRunPlanItem = {
				id: crypto.randomUUID(),
				runId,
				title: input.taskTitle,
				ownerEmployeeId: input.ownerEmployeeId,
				subAgentJobId: input.jobId,
				status: 'in_progress',
				createdAtIso: input.nowIso,
			};
			return {
				...run,
				plan: [...existingPlan, synthetic],
				lastEventAtIso: input.nowIso,
			};
		}
		return {
			...run,
			plan: existingPlan.map((item) =>
				item.id === matched.id
					? {
							...item,
							ownerEmployeeId: item.ownerEmployeeId ?? input.ownerEmployeeId,
							subAgentJobId: input.jobId,
							status: 'in_progress' as const,
							completedAtIso: undefined,
					  }
					: item
			),
			lastEventAtIso: input.nowIso,
		};
	});
}

/** After a sub-agent job row is updated, mirror terminal states onto linked plan items. */
export function syncRunPlanAfterSubAgentJobUpdate(
	state: AiEmployeesOrchestrationState,
	runId: string,
	jobId: string,
	job: AiSubAgentJob
): AiEmployeesOrchestrationState {
	return updateRunInState(state, runId, (run) => {
		if (!run.plan?.length) {
			return run;
		}
		let touched = false;
		const plan = run.plan.map((item) => {
			if (item.subAgentJobId !== jobId) {
				return item;
			}
			touched = true;
			if (job.status === 'done') {
				return {
					...item,
					status: 'done' as const,
					completedAtIso: job.completedAtIso ?? item.completedAtIso,
				};
			}
			if (job.status === 'blocked' || job.status === 'error') {
				return {
					...item,
					status: 'blocked' as const,
					completedAtIso: job.completedAtIso ?? item.completedAtIso,
				};
			}
			return {
				...item,
				status: 'in_progress' as const,
			};
		});
		return touched ? { ...run, plan } : run;
	});
}

export function appendToolLogToJob(
	state: AiEmployeesOrchestrationState,
	runId: string,
	jobId: string,
	entry: AiSubAgentToolEntry
): AiEmployeesOrchestrationState {
	return updateSubAgentJobInRun(state, runId, jobId, (job) => ({
		...job,
		toolLog: [...job.toolLog, entry].slice(-50),
	}));
}
