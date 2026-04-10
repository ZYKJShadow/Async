import { describe, expect, it } from 'vitest';
import {
	addHandoffToRunInState,
	appendTimelineEventToState,
	approveGitForRun,
	createDraftRun,
	emptyOrchestrationState,
	markCollabMessageReadInState,
	setHandoffStatusInState,
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
