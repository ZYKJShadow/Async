import { describe, expect, it } from 'vitest';
import { TeamTaskQueue } from './teamTaskQueue.js';
import type { TeamTask } from './teamOrchestrator.js';

function makeTask(id: string, deps: string[] = [], status: TeamTask['status'] = 'pending'): TeamTask {
	return {
		id,
		expertId: 'expert-1',
		expertName: 'Expert',
		expertAssignmentKey: 'expert-1',
		roleType: 'custom',
		description: `Task ${id}`,
		status,
		dependencies: deps,
		acceptanceCriteria: [],
		kind: 'deliver',
	};
}

describe('TeamTaskQueue', () => {
	it('adds tasks and resolves initial status', () => {
		const queue = new TeamTaskQueue();
		const t1 = makeTask('t1');
		const t2 = makeTask('t2', ['t1']);
		queue.add(t1);
		queue.add(t2);
		expect(queue.get('t1')!.status).toBe('pending');
		expect(queue.get('t2')!.status).toBe('blocked');
	});

	it('getReady returns only tasks with satisfied dependencies', () => {
		const queue = new TeamTaskQueue();
		queue.add(makeTask('t1'));
		queue.add(makeTask('t2', ['t1']));
		queue.add(makeTask('t3'));
		const ready = queue.getReady();
		expect(ready.map((t) => t.id)).toContain('t1');
		expect(ready.map((t) => t.id)).toContain('t3');
		expect(ready.map((t) => t.id)).not.toContain('t2');
	});

	it('unblocks dependents on complete', () => {
		const queue = new TeamTaskQueue();
		queue.add(makeTask('t1'));
		queue.add(makeTask('t2', ['t1']));
		expect(queue.get('t2')!.status).toBe('blocked');
		queue.complete('t1', 'done');
		expect(queue.get('t1')!.status).toBe('completed');
		expect(queue.get('t2')!.status).toBe('pending');
	});

	it('cascades failure to dependents', () => {
		const queue = new TeamTaskQueue();
		queue.add(makeTask('t1'));
		queue.add(makeTask('t2', ['t1']));
		queue.add(makeTask('t3', ['t2']));
		queue.fail('t1', 'oops');
		expect(queue.get('t1')!.status).toBe('failed');
		expect(queue.get('t2')!.status).toBe('failed');
		expect(queue.get('t3')!.status).toBe('failed');
	});

	it('does not cascade failure to already completed tasks', () => {
		const queue = new TeamTaskQueue();
		queue.add(makeTask('t1'));
		queue.add(makeTask('t2', ['t1']));
		queue.complete('t2', 'early');
		queue.fail('t1', 'oops');
		expect(queue.get('t2')!.status).toBe('completed');
	});

	it('getProgress reports correct counts', () => {
		const queue = new TeamTaskQueue();
		queue.add(makeTask('t1'));
		queue.add(makeTask('t2', ['t1']));
		queue.add(makeTask('t3'));
		queue.complete('t1');
		queue.fail('t3', 'err');
		const p = queue.getProgress();
		expect(p.total).toBe(3);
		expect(p.completed).toBe(1);
		expect(p.failed).toBe(1);
		expect(p.pending).toBe(1);
		expect(p.blocked).toBe(0);
	});

	it('isComplete returns true when all tasks terminal', () => {
		const queue = new TeamTaskQueue();
		queue.add(makeTask('t1'));
		queue.add(makeTask('t2'));
		expect(queue.isComplete()).toBe(false);
		queue.complete('t1');
		queue.fail('t2', 'err');
		expect(queue.isComplete()).toBe(true);
	});

	it('skipAllRemaining marks non-terminal tasks as failed', () => {
		const queue = new TeamTaskQueue();
		queue.add(makeTask('t1'));
		queue.add(makeTask('t2', ['t1']));
		queue.complete('t1');
		queue.skipAllRemaining('aborted');
		expect(queue.get('t2')!.status).toBe('failed');
		expect(queue.get('t2')!.result).toContain('aborted');
	});

	it('handles diamond dependency graph', () => {
		//     t1
		//    /  \
		//   t2   t3
		//    \  /
		//     t4
		const queue = new TeamTaskQueue();
		queue.add(makeTask('t1'));
		queue.add(makeTask('t2', ['t1']));
		queue.add(makeTask('t3', ['t1']));
		queue.add(makeTask('t4', ['t2', 't3']));

		expect(queue.getReady().map((t) => t.id)).toEqual(['t1']);
		queue.complete('t1');
		const readyAfterT1 = queue.getReady().map((t) => t.id);
		expect(readyAfterT1).toContain('t2');
		expect(readyAfterT1).toContain('t3');
		queue.complete('t2');
		expect(queue.get('t4')!.status).toBe('blocked');
		queue.complete('t3');
		expect(queue.get('t4')!.status).toBe('pending');
	});

	it('remove deletes a task from the queue', () => {
		const queue = new TeamTaskQueue();
		queue.add(makeTask('t1'));
		expect(queue.get('t1')).toBeDefined();
		queue.remove('t1');
		expect(queue.get('t1')).toBeUndefined();
	});
});
