import { describe, expect, it } from 'vitest';
import {
	addHandoffToRunInState,
	approveGitForRun,
	createDraftRun,
	emptyOrchestrationState,
	setHandoffStatusInState,
	upsertRun,
} from './orchestration';

describe('orchestration', () => {
	it('createDraftRun trims goal', () => {
		const r = createDraftRun('  hello  ', 'b1', '2020-01-01T00:00:00.000Z', 'id1');
		expect(r.goal).toBe('hello');
		expect(r.targetBranch).toBe('b1');
		expect(r.status).toBe('draft');
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
		const s = upsertRun(emptyOrchestrationState(), run);
		const next = approveGitForRun(s, 'x');
		expect(next.runs[0]?.gitApproved).toBe(true);
		expect(next.runs[0]?.status).toBe('completed');
	});

	it('addHandoffToRunInState appends handoff', () => {
		const run = { ...createDraftRun('g', undefined, 't', 'r1'), status: 'running' as const };
		const s = upsertRun(emptyOrchestrationState(), run);
		const h = {
			id: 'h1',
			toEmployeeId: 'e1',
			status: 'pending' as const,
			atIso: '2020-01-02T00:00:00.000Z',
		};
		const next = addHandoffToRunInState(s, 'r1', h);
		expect(next.runs[0]?.handoffs).toHaveLength(1);
		expect(next.runs[0]?.handoffs[0]?.toEmployeeId).toBe('e1');
	});

	it('setHandoffStatusInState updates one handoff', () => {
		const run = { ...createDraftRun('g', undefined, 't', 'r1'), status: 'running' as const, handoffs: [] };
		const s0 = upsertRun(emptyOrchestrationState(), run);
		const h = { id: 'h1', toEmployeeId: 'e1', status: 'pending' as const, atIso: 't' };
		const s1 = addHandoffToRunInState(s0, 'r1', h);
		const s2 = setHandoffStatusInState(s1, 'r1', 'h1', 'done');
		expect(s2.runs[0]?.handoffs[0]?.status).toBe('done');
	});
});
