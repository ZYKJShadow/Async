import type { AiEmployeesOrchestrationState, AiOrchestrationRun, AiOrchestrationHandoff } from '../../../shared/aiEmployeesSettings';

export function emptyOrchestrationState(): AiEmployeesOrchestrationState {
	return { runs: [] };
}

export function createDraftRun(goal: string, targetBranch: string | undefined, nowIso: string, id: string): AiOrchestrationRun {
	return {
		id,
		goal: goal.trim(),
		targetBranch: targetBranch?.trim() || undefined,
		status: 'draft',
		createdAtIso: nowIso,
		handoffs: [],
		gitApproved: false,
	};
}

export function upsertRun(state: AiEmployeesOrchestrationState, run: AiOrchestrationRun): AiEmployeesOrchestrationState {
	const rest = state.runs.filter((r) => r.id !== run.id);
	return {
		...state,
		runs: [run, ...rest],
		activeRunId: state.activeRunId ?? run.id,
	};
}

export function approveGitForRun(state: AiEmployeesOrchestrationState, runId: string): AiEmployeesOrchestrationState {
	return {
		...state,
		runs: state.runs.map((r) => (r.id === runId ? { ...r, gitApproved: true, status: 'completed' as const } : r)),
	};
}

export function addHandoff(
	run: AiOrchestrationRun,
	h: Omit<AiOrchestrationHandoff, 'id' | 'atIso'> & { id: string; atIso: string }
): AiOrchestrationRun {
	return {
		...run,
		status: 'running',
		handoffs: [...run.handoffs, h],
	};
}
