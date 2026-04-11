import { describe, expect, it } from 'vitest';
import {
	buildModelOptions,
	formatEmployeeResolvedModelLabel,
	formatLocalModelPickLabel,
	resolveEmployeeLocalModelId,
} from './modelAdapter';

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

	it('formatLocalModelPickLabel appends provider when set', () => {
		expect(formatLocalModelPickLabel({ id: 'x', displayName: 'GPT-4' })).toBe('GPT-4');
		expect(formatLocalModelPickLabel({ id: 'x', displayName: 'GPT-4', providerDisplayName: 'OpenAI' })).toBe('GPT-4 (OpenAI)');
	});

	it('formatEmployeeResolvedModelLabel uses resolve + pick label', () => {
		const set = new Set(['m1']);
		const opts = [{ id: 'm1', displayName: 'Model One', providerDisplayName: 'Prov' }];
		expect(
			formatEmployeeResolvedModelLabel({
				employee: { id: 'e1', linkedRemoteAgentId: null },
				employeeLocalModelMap: { e1: 'm1' },
				agentLocalModelMap: {},
				defaultModelId: undefined,
				modelOptionIdSet: set,
				modelOptions: opts,
			})
		).toBe('Model One (Prov)');
		expect(
			formatEmployeeResolvedModelLabel({
				employee: { id: 'e9', linkedRemoteAgentId: null },
				employeeLocalModelMap: {},
				agentLocalModelMap: {},
				defaultModelId: undefined,
				modelOptionIdSet: set,
				modelOptions: opts,
			})
		).toBe(null);
	});
});
