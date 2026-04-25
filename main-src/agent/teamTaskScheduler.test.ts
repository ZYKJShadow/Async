import { describe, expect, it } from 'vitest';
import { rankReadyTasks } from './teamTaskScheduler.js';
import type { TeamTask } from './teamOrchestrator.js';
import type { TeamExpertRuntimeProfile } from './teamExpertProfiles.js';

function makeTask(id: string, expertId: string, description: string, dependencies: string[] = []): TeamTask {
	return {
		id,
		expertId,
		expertName: expertId,
		expertAssignmentKey: expertId,
		roleType: 'custom',
		description,
		status: 'pending',
		dependencies,
		acceptanceCriteria: [],
		kind: 'deliver',
	};
}

function makeExpert(id: string, name: string, systemPrompt = ''): TeamExpertRuntimeProfile {
	return {
		id,
		name,
		assignmentKey: id,
		roleType: 'custom',
		systemPrompt,
		summary: '',
		allowedTools: [],
	};
}

describe('rankReadyTasks', () => {
	const specialists = [
		makeExpert('frontend', 'Frontend Expert', 'React UI components styling'),
		makeExpert('backend', 'Backend Expert', 'API design database'),
		makeExpert('qa', 'QA Expert', 'testing automation'),
	];

	it('returns empty for empty input', () => {
		expect(rankReadyTasks([], [], specialists, new Set(), 'dependency-first')).toEqual([]);
	});

	it('returns single task unchanged', () => {
		const task = makeTask('t1', 'frontend', 'Build login form');
		expect(rankReadyTasks([task], [task], specialists, new Set(), 'dependency-first')).toEqual([task]);
	});

	it('fifo preserves original order', () => {
		const t1 = makeTask('t1', 'frontend', 'A');
		const t2 = makeTask('t2', 'backend', 'B');
		const t3 = makeTask('t3', 'qa', 'C');
		const result = rankReadyTasks([t1, t2, t3], [t1, t2, t3], specialists, new Set(), 'fifo');
		expect(result.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
	});

	it('dependency-first prioritises critical path tasks', () => {
		// t1 -> t3 (t3 depends on t1)
		// t2 has no dependents
		const t1 = makeTask('t1', 'frontend', 'Design schema');
		const t2 = makeTask('t2', 'backend', 'Setup repo');
		const t3 = makeTask('t3', 'qa', 'Review schema', ['t1']);
		const all = [t1, t2, t3];
		const ready = [t1, t2]; // t3 blocked
		const result = rankReadyTasks(ready, all, specialists, new Set(), 'dependency-first');
		// t1 blocks t3, so t1 should come first
		expect(result[0]!.id).toBe('t1');
	});

	it('dependency-first handles transitive dependents', () => {
		// t1 -> t3 -> t4
		// t2 -> nothing
		const t1 = makeTask('t1', 'frontend', 'A');
		const t2 = makeTask('t2', 'backend', 'B');
		const t3 = makeTask('t3', 'qa', 'C', ['t1']);
		const t4 = makeTask('t4', 'frontend', 'D', ['t3']);
		const all = [t1, t2, t3, t4];
		const ready = [t1, t2];
		const result = rankReadyTasks(ready, all, specialists, new Set(), 'dependency-first');
		// t1 blocks 2 tasks (t3, t4); t2 blocks 0
		expect(result[0]!.id).toBe('t1');
		expect(result[1]!.id).toBe('t2');
	});

	it('least-busy prefers experts with fewer active tasks', () => {
		const t1 = makeTask('t1', 'frontend', 'A');
		const t2 = makeTask('t2', 'frontend', 'B');
		const t3 = makeTask('t3', 'backend', 'C');
		const all = [t1, t2, t3];
		const ready = [t1, t2, t3];
		const active = new Set(['t1']); // frontend busy
		const result = rankReadyTasks(ready, all, specialists, active, 'least-busy');
		// backend has 0 active → should come first
		expect(result[0]!.id).toBe('t3');
	});

	it('round-robin cycles through different experts', () => {
		const t1 = makeTask('t1', 'frontend', 'A');
		const t2 = makeTask('t2', 'frontend', 'B');
		const t3 = makeTask('t3', 'backend', 'C');
		const t4 = makeTask('t4', 'qa', 'D');
		const all = [t1, t2, t3, t4];
		const ready = [t1, t2, t3, t4];
		const result = rankReadyTasks(ready, all, specialists, new Set(), 'round-robin');
		// First round: one task per expert in ready order
		const ids = result.map((t) => t.id);
		expect(ids[0]).toBe('t1'); // first frontend
		expect(ids[1]).toBe('t3'); // first backend
		expect(ids[2]).toBe('t4'); // first qa
		expect(ids[3]).toBe('t2'); // second frontend
	});

	it('capability-match scores by keyword overlap', () => {
		const frontend = makeExpert('frontend', 'Frontend', 'React component styling');
		const backend = makeExpert('backend', 'Backend', 'API database design');
		const experts = [frontend, backend];

		const t1 = makeTask('t1', 'frontend', 'Build a React component');
		const t2 = makeTask('t2', 'backend', 'Design the database schema');
		const all = [t1, t2];
		const ready = [t1, t2];
		const result = rankReadyTasks(ready, all, experts, new Set(), 'capability-match');
		// Both should be present; order depends on score.
		expect(result.map((t) => t.id)).toContain('t1');
		expect(result.map((t) => t.id)).toContain('t2');
	});

	it('defaults to dependency-first when strategy omitted', () => {
		const t1 = makeTask('t1', 'frontend', 'A');
		const t2 = makeTask('t2', 'backend', 'B');
		const t3 = makeTask('t3', 'qa', 'C', ['t1']);
		const all = [t1, t2, t3];
		const ready = [t1, t2];
		const result = rankReadyTasks(ready, all, specialists, new Set());
		expect(result[0]!.id).toBe('t1');
	});
});
