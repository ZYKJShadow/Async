import { describe, expect, it } from 'vitest';
import {
	addHandoffToRunInState,
	addSubAgentJobToRun,
	appendTimelineEventToState,
	appendToolLogToJob,
	approveGitForRun,
	createDraftRun,
	emptyOrchestrationState,
	linkDelegatedJobToPlanInState,
	markCollabMessageReadInState,
	setHandoffStatusInState,
	setRunPlanInState,
	syncRunPlanAfterSubAgentJobUpdate,
	updateRunInState,
	updateSubAgentJobInRun,
	upsertCollabMessageInState,
	upsertRun,
} from './orchestration';

describe('orchestration', () => {
	it('createDraftRun trims goal', () => {
		const run = createDraftRun('  hello  ', 'b1', '2020-01-01T00:00:00.000Z', 'id1');
		expect(run.goal).toBe('hello');
		expect(run.targetBranch).toBe('b1');
		expect(run.status).toBe('draft');
		expect(run.approvalState).toBe('none');
		expect(run.subAgentJobs).toEqual([]);
	});

	it('addSubAgentJobToRun / updateSubAgentJobInRun / appendToolLogToJob', () => {
		const run = { ...createDraftRun('g', undefined, 't', 'r1'), status: 'running' as const };
		let state = upsertRun(emptyOrchestrationState(), run);
		const job = {
			id: 'j1',
			runId: 'r1',
			employeeId: 'e1',
			employeeName: 'A',
			taskTitle: 't1',
			taskDescription: 'd',
			status: 'queued' as const,
			queuedAtIso: '2020-01-02T00:00:00.000Z',
			toolLog: [],
		};
		state = addSubAgentJobToRun(state, 'r1', job);
		expect(state.runs[0]?.subAgentJobs).toHaveLength(1);
		state = updateSubAgentJobInRun(state, 'r1', 'j1', (j) => ({ ...j, status: 'running' }));
		expect(state.runs[0]?.subAgentJobs?.[0]?.status).toBe('running');
		state = appendToolLogToJob(state, 'r1', 'j1', {
			id: 'tool-1',
			name: 'Read',
			args: { path: 'x' },
			result: 'ok',
			success: true,
			startedAtIso: '2020-01-02T00:00:01.000Z',
			durationMs: 5,
		});
		expect(state.runs[0]?.subAgentJobs?.[0]?.toolLog).toHaveLength(1);
		expect(state.runs[0]?.subAgentJobs?.[0]?.toolLog[0]?.name).toBe('Read');
	});

	it('syncRunPlanAfterSubAgentJobUpdate mirrors job status to linked plan item', () => {
		const run = { ...createDraftRun('g', undefined, 't', 'r1'), status: 'running' as const };
		let state = upsertRun(emptyOrchestrationState(), run);
		state = setRunPlanInState(
			state,
			'r1',
			[
				{
					id: 'p1',
					runId: 'r1',
					title: 'Do work',
					status: 'in_progress',
					createdAtIso: 't0',
					subAgentJobId: 'j1',
				},
			],
			'ceo',
			't1'
		);
		const job = {
			id: 'j1',
			runId: 'r1',
			employeeId: 'e1',
			employeeName: 'A',
			taskTitle: 't1',
			taskDescription: 'd',
			status: 'done' as const,
			queuedAtIso: 't0',
			completedAtIso: 't2',
			toolLog: [],
		};
		state = addSubAgentJobToRun(state, 'r1', job);
		state = syncRunPlanAfterSubAgentJobUpdate(state, 'r1', 'j1', {
			...job,
			status: 'done',
			completedAtIso: 't2',
		});
		expect(state.runs[0]?.plan?.[0]?.status).toBe('done');
		expect(state.runs[0]?.plan?.[0]?.completedAtIso).toBe('t2');
	});

	it('links delegated jobs to existing plan rows by title when no explicit plan item id is available', () => {
		const run = { ...createDraftRun('g', undefined, 't', 'r1'), status: 'running' as const };
		let state = upsertRun(emptyOrchestrationState(), run);
		state = setRunPlanInState(
			state,
			'r1',
			[
				{
					id: 'p1',
					runId: 'r1',
					title: 'Explore project structure',
					ownerEmployeeId: 'eng-1',
					status: 'pending',
					createdAtIso: 't0',
				},
			],
			'ceo',
			't0'
		);
		state = linkDelegatedJobToPlanInState(state, 'r1', {
			jobId: 'job-1',
			taskTitle: 'Explore project structure',
			ownerEmployeeId: 'eng-1',
			nowIso: 't1',
		});
		expect(state.runs[0]?.plan?.[0]).toMatchObject({
			id: 'p1',
			subAgentJobId: 'job-1',
			status: 'in_progress',
		});
	});

	it('honors explicit plan item ids when delegating', () => {
		const run = { ...createDraftRun('g', undefined, 't', 'r1'), status: 'running' as const };
		let state = upsertRun(emptyOrchestrationState(), run);
		state = setRunPlanInState(
			state,
			'r1',
			[
				{ id: 'p1', runId: 'r1', title: 'Step A', status: 'pending', createdAtIso: 't0' },
				{ id: 'p2', runId: 'r1', title: 'Step B', status: 'pending', createdAtIso: 't0' },
			],
			'ceo',
			't0'
		);
		state = linkDelegatedJobToPlanInState(state, 'r1', {
			jobId: 'job-2',
			taskTitle: 'Step B',
			ownerEmployeeId: 'eng-2',
			nowIso: 't1',
			planItemId: 'p2',
		});
		expect(state.runs[0]?.plan?.[1]).toMatchObject({
			id: 'p2',
			subAgentJobId: 'job-2',
			status: 'in_progress',
		});
	});

	it('appends a synthetic plan row when delegation does not match the drafted checklist', () => {
		const run = { ...createDraftRun('g', undefined, 't', 'r1'), status: 'running' as const };
		let state = upsertRun(emptyOrchestrationState(), run);
		state = setRunPlanInState(
			state,
			'r1',
			[
				{
					id: 'p1',
					runId: 'r1',
					title: 'Review findings',
					status: 'done',
					createdAtIso: 't0',
					subAgentJobId: 'job-old',
				},
			],
			'ceo',
			't0'
		);
		state = linkDelegatedJobToPlanInState(state, 'r1', {
			jobId: 'job-new',
			taskTitle: 'Draft regression fix',
			ownerEmployeeId: 'eng-3',
			nowIso: 't1',
		});
		expect(state.runs[0]?.plan).toHaveLength(2);
		expect(state.runs[0]?.plan?.[1]).toMatchObject({
			title: 'Draft regression fix',
			subAgentJobId: 'job-new',
			status: 'in_progress',
			ownerEmployeeId: 'eng-3',
		});
	});

	it('upsertRun replaces by id and sets activeRunId', () => {
		const s0 = emptyOrchestrationState();
		const r1 = createDraftRun('a', undefined, 't', '1');
		const s1 = upsertRun(s0, r1);
		expect(s1.runs).toHaveLength(1);
		expect(s1.activeRunId).toBe('1');
		const r2 = { ...r1, id: '1', goal: 'b' };
		const s2 = upsertRun(s1, r2);
		expect(s2.runs).toHaveLength(1);
		expect(s2.runs[0]?.goal).toBe('b');
	});

	it('approveGitForRun marks completed', () => {
		const run = { ...createDraftRun('g', 'br', 't', 'x'), status: 'running' as const };
		const state = upsertRun(emptyOrchestrationState(), run);
		const next = approveGitForRun(state, 'x');
		expect(next.runs[0]?.gitApproved).toBe(true);
		expect(next.runs[0]?.status).toBe('completed');
	});

	it('addHandoffToRunInState appends handoff and makes it active', () => {
		const run = { ...createDraftRun('g', undefined, 't', 'r1'), status: 'running' as const };
		const state = upsertRun(emptyOrchestrationState(), run);
		const handoff = {
			id: 'h1',
			toEmployeeId: 'e1',
			status: 'pending' as const,
			atIso: '2020-01-02T00:00:00.000Z',
		};
		const next = addHandoffToRunInState(state, 'r1', handoff);
		expect(next.runs[0]?.handoffs).toHaveLength(1);
		expect(next.runs[0]?.handoffs[0]?.status).toBe('in_progress');
	});

	it('setHandoffStatusInState auto-promotes the next pending handoff', () => {
		const run = {
			...createDraftRun('g', undefined, 't', 'r1'),
			status: 'running' as const,
			handoffs: [
				{ id: 'h1', toEmployeeId: 'e1', status: 'in_progress' as const, atIso: 't1' },
				{ id: 'h2', toEmployeeId: 'e2', status: 'pending' as const, atIso: 't2' },
			],
		};
		const state = upsertRun(emptyOrchestrationState(), run);
		const next = setHandoffStatusInState(state, 'r1', 'h1', 'done', { resultSummary: 'done', atIso: 't3' });
		expect(next.runs[0]?.handoffs[0]?.status).toBe('done');
		expect(next.runs[0]?.handoffs[1]?.status).toBe('in_progress');
	});

	it('finalizeRun keeps user stop summary and clears approval when status is cancelled', () => {
		const run = {
			...createDraftRun('g', undefined, 't', 'r1'),
			status: 'running' as const,
			approvalState: 'pending_git' as const,
		};
		let state = upsertRun(emptyOrchestrationState(), run);
		state = updateRunInState(state, 'r1', (r) => ({
			...r,
			status: 'cancelled',
			statusSummary: 'Stopped by you',
			lastEventAtIso: '2020-01-02T00:00:00.000Z',
		}));
		const updated = state.runs.find((x) => x.id === 'r1');
		expect(updated?.status).toBe('cancelled');
		expect(updated?.statusSummary).toBe('Stopped by you');
		expect(updated?.approvalState).toBe('none');
		expect(updated?.currentAssigneeEmployeeId).toBeUndefined();
	});

	it('stores timeline events and collab messages', () => {
		const run = createDraftRun('g', undefined, 't', 'r1');
		let state = upsertRun(emptyOrchestrationState(), run);
		state = appendTimelineEventToState(state, {
			id: 'evt1',
			runId: 'r1',
			type: 'run_created',
			label: 'Run created',
			createdAtIso: '2020-01-01T00:00:00.000Z',
			source: 'local',
		});
		state = upsertCollabMessageInState(state, {
			id: 'msg1',
			runId: 'r1',
			type: 'text',
			summary: 'hello',
			body: 'hello',
			createdAtIso: '2020-01-01T00:00:01.000Z',
		});
		state = markCollabMessageReadInState(state, 'msg1', '2020-01-01T00:00:02.000Z');
		expect(state.timelineEvents).toHaveLength(1);
		expect(state.collabMessages[0]?.readAtIso).toBe('2020-01-01T00:00:02.000Z');
	});
});
