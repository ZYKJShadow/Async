import type { IssueJson } from '../api/types';

export type IssueViewMode = 'board' | 'list';
export type IssueSortBy = 'position' | 'priority' | 'due_date' | 'created_at' | 'title';

export type AssigneeFilter = { type: 'member' | 'agent'; id: string };

export interface IssueBoardState {
	viewMode: IssueViewMode;
	statusFilters: string[];
	priorityFilters: string[];
	assigneeFilters: AssigneeFilter[];
	sortBy: IssueSortBy;
	sortDirection: 'asc' | 'desc';
	collapsedStatuses: string[];
}

export const DEFAULT_ISSUE_BOARD_STATE: IssueBoardState = {
	viewMode: 'board',
	statusFilters: [],
	priorityFilters: [],
	assigneeFilters: [],
	sortBy: 'position',
	sortDirection: 'asc',
	collapsedStatuses: [],
};

const PRIORITY_RANK: Record<string, number> = {
	urgent: 0,
	high: 1,
	medium: 2,
	low: 3,
	none: 4,
};

export function bucketByStatus(issues: IssueJson[]): Map<string, IssueJson[]> {
	const map = new Map<string, IssueJson[]>();
	for (const i of issues) {
		const st = i.status || 'backlog';
		const list = map.get(st) ?? [];
		list.push(i);
		map.set(st, list);
	}
	for (const [, list] of map) {
		list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
	}
	return map;
}

export function applyFilters(issues: IssueJson[], state: IssueBoardState): IssueJson[] {
	let out = issues;
	if (state.statusFilters.length > 0) {
		const set = new Set(state.statusFilters);
		out = out.filter((i) => set.has(i.status));
	}
	if (state.priorityFilters.length > 0) {
		const set = new Set(state.priorityFilters);
		out = out.filter((i) => set.has(i.priority ?? 'none'));
	}
	if (state.assigneeFilters.length > 0) {
		out = out.filter((i) => {
			if (!i.assignee_type || !i.assignee_id) {
				return false;
			}
			return state.assigneeFilters.some((f) => f.type === i.assignee_type && f.id === i.assignee_id);
		});
	}
	return out;
}

export function sortIssues(issues: IssueJson[], sortBy: IssueSortBy, dir: 'asc' | 'desc'): IssueJson[] {
	const mul = dir === 'desc' ? -1 : 1;
	const copy = [...issues];
	const cmpNum = (a: number, b: number) => (a - b) * mul;
	const cmpStr = (a: string, b: string) => a.localeCompare(b) * mul;
	copy.sort((a, b) => {
		switch (sortBy) {
			case 'priority': {
				const pa = PRIORITY_RANK[a.priority ?? 'none'] ?? 99;
				const pb = PRIORITY_RANK[b.priority ?? 'none'] ?? 99;
				const c = cmpNum(pa, pb);
				if (c !== 0) {
					return c;
				}
				break;
			}
			case 'due_date': {
				const da = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY;
				const db = b.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY;
				const c = cmpNum(da, db);
				if (c !== 0) {
					return c;
				}
				break;
			}
			case 'created_at': {
				const ca = a.created_at ? Date.parse(a.created_at) : 0;
				const cb = b.created_at ? Date.parse(b.created_at) : 0;
				const c = cmpNum(ca, cb);
				if (c !== 0) {
					return c;
				}
				break;
			}
			case 'title': {
				const c = cmpStr(a.title, b.title);
				if (c !== 0) {
					return c;
				}
				break;
			}
			default: {
				const c = cmpNum(a.position ?? 0, b.position ?? 0);
				if (c !== 0) {
					return c;
				}
			}
		}
		return cmpNum(Date.parse(a.created_at ?? '0'), Date.parse(b.created_at ?? '0'));
	});
	return copy;
}

/** 在已按 position 排好序的兄弟列表中，插入到 `insertAt`（0..length）时的 position 值 */
export function computeNewPosition(siblingsOrdered: IssueJson[], insertAt: number): number {
	const STEP = 65536;
	const n = siblingsOrdered.length;
	const clamped = Math.max(0, Math.min(insertAt, n));
	const prev = clamped > 0 ? (siblingsOrdered[clamped - 1].position ?? 0) : null;
	const next = clamped < n ? (siblingsOrdered[clamped].position ?? 0) : null;
	if (prev == null && next == null) {
		return STEP;
	}
	if (prev == null) {
		return (next as number) - STEP;
	}
	if (next == null) {
		return (prev as number) + STEP;
	}
	if (next <= prev) {
		return prev + STEP;
	}
	return (prev + next) / 2;
}
