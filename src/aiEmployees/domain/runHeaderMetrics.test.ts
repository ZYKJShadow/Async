import { describe, expect, it } from 'vitest';
import type { AiOrchestrationRun, AiRunPlanItem, AiSubAgentJob } from '../../../shared/aiEmployeesSettings';
import { runHeaderProgress } from './runHeaderMetrics';

function baseRun(over: Partial<AiOrchestrationRun> = {}): AiOrchestrationRun {
	return {
		id: 'r1',
		goal: 'g',
		status: 'running',
		createdAtIso: '2020-01-01T00:00:00.000Z',
		lastEventAtIso: '2020-01-01T00:00:00.000Z',
		subAgentJobs: [],
		handoffs: [],
		...over,
	};
}

describe('runHeaderProgress', () => {
	it('prefers plan checklist when present', () => {
		const plan: AiRunPlanItem[] = [
			{ id: 'a', runId: 'r1', title: '1', status: 'done', createdAtIso: 't' },
			{ id: 'b', runId: 'r1', title: '2', status: 'skipped', createdAtIso: 't' },
			{ id: 'c', runId: 'r1', title: '3', status: 'pending', createdAtIso: 't' },
		];
		expect(runHeaderProgress(baseRun({ plan }))).toEqual({ done: 2, total: 3 });
	});

	it('falls back to sub-agent jobs when no plan', () => {
		const subAgentJobs: AiSubAgentJob[] = [
			{
				id: 'j1',
				runId: 'r1',
				employeeId: 'e1',
				employeeName: 'A',
				taskTitle: 't',
				taskDescription: '',
				status: 'done',
				queuedAtIso: 't',
				toolLog: [],
			},
			{
				id: 'j2',
				runId: 'r1',
				employeeId: 'e2',
				employeeName: 'B',
				taskTitle: 't2',
				taskDescription: '',
				status: 'running',
				queuedAtIso: 't',
				toolLog: [],
			},
			{
				id: 'j3',
				runId: 'r1',
				employeeId: 'e2',
				employeeName: 'B',
				taskTitle: 't3',
				taskDescription: '',
				status: 'error',
				queuedAtIso: 't',
				toolLog: [],
			},
		];
		expect(runHeaderProgress(baseRun({ subAgentJobs }))).toEqual({ done: 2, total: 3 });
	});

	it('returns null when no plan and no jobs', () => {
		expect(runHeaderProgress(baseRun())).toBeNull();
	});
});
