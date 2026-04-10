import { describe, expect, it } from 'vitest';
import { buildModelOptions, resolveEmployeeLocalModelId } from './modelAdapter';

describe('modelAdapter', () => {
	it('resolveEmployeeLocalModelId prefers bound then default', () => {
		const set = new Set(['m1', 'm2']);
		expect(
			resolveEmployeeLocalModelId({
				employeeId: 'e1',
				remoteAgentId: 'a',
				agentLocalModelMap: { a: 'm2' },
				employeeLocalModelMap: { e1: 'm1' },
				defaultModelId: 'm2',
				modelOptionIds: set,
			})
		).toBe('m1');
		expect(
			resolveEmployeeLocalModelId({
				remoteAgentId: 'a',
				agentLocalModelMap: { a: 'm2' },
				employeeLocalModelMap: {},
				defaultModelId: 'm1',
				modelOptionIds: set,
			})
		).toBe('m2');
		expect(
			resolveEmployeeLocalModelId({
				remoteAgentId: 'a',
				agentLocalModelMap: {},
				employeeLocalModelMap: {},
				defaultModelId: 'm1',
				modelOptionIds: set,
			})
		).toBe('m1');
	});

	it('buildModelOptions respects enabledIds order', () => {
		const opts = buildModelOptions({
			entries: [
				{ id: 'a', displayName: 'A' },
				{ id: 'b', displayName: 'B' },
			],
			enabledIds: ['b', 'a'],
		});
		expect(opts.map((x) => x.id)).toEqual(['b', 'a']);
	});
});
