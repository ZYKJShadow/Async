import { describe, expect, it } from 'vitest';
import { applyFilters, bucketByStatus, computeNewPosition, DEFAULT_ISSUE_BOARD_STATE, sortIssues } from './issueBoard';
import type { IssueJson } from '../api/types';

function issue(partial: Partial<IssueJson> & Pick<IssueJson, 'id' | 'title' | 'status'>): IssueJson {
	const { id, title, status, ...rest } = partial;
	return { id, title, status, ...rest } as IssueJson;
}

describe('issueBoard', () => {
	it('computeNewPosition appends after last', () => {
		const siblings = [issue({ id: '1', title: 'a', status: 'todo', position: 100 })];
		expect(computeNewPosition(siblings, 1)).toBe(100 + 65536);
	});

	it('computeNewPosition inserts between', () => {
		const siblings = [
			issue({ id: '1', title: 'a', status: 'todo', position: 100 }),
			issue({ id: '2', title: 'b', status: 'todo', position: 300 }),
		];
		expect(computeNewPosition(siblings, 1)).toBe(200);
	});

	it('applyFilters status', () => {
		const issues = [issue({ id: '1', title: 'a', status: 'done' }), issue({ id: '2', title: 'b', status: 'todo' })];
		const state = { ...DEFAULT_ISSUE_BOARD_STATE, statusFilters: ['todo'] };
		expect(applyFilters(issues, state).map((i) => i.id)).toEqual(['2']);
	});

	it('bucketByStatus groups', () => {
		const issues = [issue({ id: '1', title: 'a', status: 'todo' }), issue({ id: '2', title: 'b', status: 'todo' })];
		const m = bucketByStatus(issues);
		expect((m.get('todo') ?? []).length).toBe(2);
	});

	it('sortIssues by priority', () => {
		const issues = [
			issue({ id: '1', title: 'l', status: 'todo', priority: 'low' }),
			issue({ id: '2', title: 'u', status: 'todo', priority: 'urgent' }),
		];
		const sorted = sortIssues(issues, 'priority', 'asc');
		expect(sorted.map((i) => i.id)).toEqual(['2', '1']);
	});
});
