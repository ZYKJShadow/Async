import { describe, expect, it } from 'vitest';
import { catalogEntryForRemoteAgent, mergeCatalogWithRemoteAgents } from './employeeCatalogMerge';

describe('employeeCatalogMerge', () => {
	it('catalogEntryForRemoteAgent finds by linked id', () => {
		const cat = [{ id: 'e1', displayName: 'A', role: 'dev', modelSource: 'hybrid' as const, linkedRemoteAgentId: 'ag1' }];
		expect(catalogEntryForRemoteAgent(cat, { id: 'ag1', name: 'X', status: 'on' })?.displayName).toBe('A');
		expect(catalogEntryForRemoteAgent(cat, { id: 'ag2', name: 'Y', status: 'on' })).toBeUndefined();
	});

	it('mergeCatalogWithRemoteAgents pairs remote agents', () => {
		const agents = [
			{ id: 'a1', name: 'N1', status: 'x' },
			{ id: 'a2', name: 'N2', status: 'y' },
		];
		const cat = [{ id: 'e1', displayName: 'E1', role: 'r', modelSource: 'hybrid' as const, linkedRemoteAgentId: 'a1' }];
		const rows = mergeCatalogWithRemoteAgents(cat, agents);
		expect(rows).toHaveLength(2);
		const paired = rows.find((r) => r.remote?.id === 'a1');
		expect(paired?.entry.displayName).toBe('E1');
		const synthetic = rows.find((r) => r.remote?.id === 'a2');
		expect(synthetic?.entry.linkedRemoteAgentId).toBe('a2');
	});

	it('mergeCatalogWithRemoteAgents appends unlinked catalog entries', () => {
		const agents = [{ id: 'a1', name: 'N1', status: 'x' }];
		const cat = [
			{ id: 'e1', displayName: 'E1', role: 'r', modelSource: 'hybrid' as const, linkedRemoteAgentId: 'a1' },
			{ id: 'e2', displayName: 'Loose', role: 'pm', modelSource: 'local_model' as const },
		];
		const rows = mergeCatalogWithRemoteAgents(cat, agents);
		expect(rows).toHaveLength(2);
		expect(rows.some((r) => r.entry.id === 'e2' && !r.remote)).toBe(true);
	});
});
