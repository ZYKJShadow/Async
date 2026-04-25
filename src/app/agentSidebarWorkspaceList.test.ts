import { describe, expect, it } from 'vitest';
import {
	isAgentWorkspaceCollapsed,
	selectAgentSidebarThreadPaths,
} from './agentSidebarWorkspaceList';

describe('selectAgentSidebarThreadPaths', () => {
	it('keeps non-current workspaces expanded unless explicitly collapsed elsewhere', () => {
		expect(isAgentWorkspaceCollapsed('D:/work/A', [])).toBe(false);
		expect(isAgentWorkspaceCollapsed('D:/work/A', ['D:/work/A'])).toBe(true);
	});

	it('always includes the current workspace even when it falls past the visible limit', () => {
		const orderedPaths = [
			'D:/work/one',
			'D:/work/two',
			'D:/work/three',
			'D:/work/four',
			'D:/work/current',
		];

		expect(
			selectAgentSidebarThreadPaths({
				orderedPaths,
				hiddenPaths: [],
				currentWorkspace: 'D:/work/current',
				limit: 3,
			})
		).toEqual(['D:/work/one', 'D:/work/two', 'D:/work/current']);
	});

	it('returns every visible workspace when no explicit limit is provided', () => {
		const orderedPaths = Array.from({ length: 12 }, (_, i) => `D:/work/${i + 1}`);

		expect(
			selectAgentSidebarThreadPaths({
				orderedPaths,
				hiddenPaths: [],
				currentWorkspace: null,
			})
		).toHaveLength(12);
	});

	it('ignores stale hidden state so conversation workspaces remain visible', () => {
		expect(
			selectAgentSidebarThreadPaths({
				orderedPaths: ['D:/work/A', 'D:/work/B'],
				hiddenPaths: ['D:/work/B'],
				currentWorkspace: null,
				limit: 8,
			})
		).toEqual(['D:/work/A', 'D:/work/B']);
	});
});
