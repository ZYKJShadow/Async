import type { AiOrchestrationRun } from '../../../shared/aiEmployeesSettings';

export function runHeaderProgress(run: AiOrchestrationRun): { done: number; total: number } | null {
	const plan = run.plan;
	if (plan?.length) {
		const total = plan.length;
		const done = plan.filter((p) => p.status === 'done' || p.status === 'skipped').length;
		return { done, total };
	}
	const jobs = run.subAgentJobs ?? [];
	if (!jobs.length) {
		return null;
	}
	const done = jobs.filter((j) => j.status === 'done' || j.status === 'error' || j.status === 'blocked').length;
	return { done, total: jobs.length };
}
