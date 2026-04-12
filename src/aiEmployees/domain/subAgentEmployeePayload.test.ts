import { describe, expect, it } from 'vitest';
import type { AiCollabMessage } from '../../../shared/aiEmployeesSettings';
import { buildModelOptions, resolveEmployeeLocalModelId } from '../adapters/modelAdapter';
import { mergeEnabledIdsWithAllModels, type UserModelEntry } from '../../modelCatalog';
import { buildCollabHistoryForEmployeeInRun } from './employeeChatHistory';

/**
 * Mirrors the two gate conditions in `buildEmployeeChatPayload` (useAiEmployeesController):
 * - no resolved local model id → payload null
 * - empty chat history → payload null
 *
 * These tests help distinguish "Missing model" vs "empty history" when debugging sub-agent runs.
 */

function msg(p: Partial<AiCollabMessage> & Pick<AiCollabMessage, 'id' | 'runId' | 'type' | 'summary' | 'body' | 'createdAtIso'>): AiCollabMessage {
	return {
		fromEmployeeId: undefined,
		toEmployeeId: undefined,
		...p,
	};
}

describe('sub-agent employee payload gates (pure helpers)', () => {
	const ceoId = 'ceo1';
	const workerId = 'worker1';
	const runId = 'run-1';

	it('history is non-empty when delegate_task persisted only title (empty body) but summary exists', () => {
		const messages: AiCollabMessage[] = [
			msg({
				id: 'job-1',
				runId,
				type: 'task_assignment',
				fromEmployeeId: ceoId,
				toEmployeeId: workerId,
				summary: 'Fix login bug',
				body: '',
				createdAtIso: '2020-01-01T00:00:00.000Z',
			}),
		];
		const history = buildCollabHistoryForEmployeeInRun(messages, runId, workerId, ceoId);
		expect(history.length).toBeGreaterThan(0);
		expect(history[0]?.role).toBe('user');
		expect(history[0]?.content).toContain('Fix login bug');
	});

	it('history stays empty when task_assignment has neither summary nor body (whitespace only)', () => {
		const messages: AiCollabMessage[] = [
			msg({
				id: 'job-bad',
				runId,
				type: 'task_assignment',
				fromEmployeeId: ceoId,
				toEmployeeId: workerId,
				summary: '   ',
				body: '  \n  ',
				createdAtIso: '2020-01-01T00:00:00.000Z',
			}),
		];
		const history = buildCollabHistoryForEmployeeInRun(messages, runId, workerId, ceoId);
		expect(history).toEqual([]);
	});

	it('history is empty when messages belong to another runId', () => {
		const messages: AiCollabMessage[] = [
			msg({
				id: '1',
				runId: 'other-run',
				type: 'task_assignment',
				fromEmployeeId: ceoId,
				toEmployeeId: workerId,
				summary: 'Wrong run',
				body: 'x',
				createdAtIso: '2020-01-01T00:00:00.000Z',
			}),
		];
		expect(buildCollabHistoryForEmployeeInRun(messages, runId, workerId, ceoId)).toEqual([]);
	});

	it('resolveEmployeeLocalModelId falls back to default when employee bound id is not in modelOptionIds', () => {
		const set = new Set(['m-enabled']);
		expect(
			resolveEmployeeLocalModelId({
				employeeId: workerId,
				remoteAgentId: undefined,
				agentLocalModelMap: {},
				employeeLocalModelMap: { [workerId]: 'm-bound-but-not-in-set' },
				defaultModelId: 'm-enabled',
				modelOptionIds: set,
			})
		).toBe('m-enabled');
	});

	it('resolveEmployeeLocalModelId returns empty when bound and default are both absent from modelOptionIds', () => {
		const set = new Set(['m-enabled']);
		expect(
			resolveEmployeeLocalModelId({
				employeeId: workerId,
				remoteAgentId: undefined,
				agentLocalModelMap: {},
				employeeLocalModelMap: { [workerId]: 'm-missing' },
				defaultModelId: 'm-also-missing',
				modelOptionIds: set,
			})
		).toBe('');
	});

	it('mergeEnabledIdsWithAllModels + buildModelOptions keeps every entry id selectable (matches main settings merge)', () => {
		const entries: UserModelEntry[] = [
			{ id: 'old', providerId: 'p', displayName: 'Old', requestName: 'old' },
			{ id: 'new', providerId: 'p', displayName: 'New', requestName: 'new' },
		];
		const merged = mergeEnabledIdsWithAllModels(entries, ['old']);
		const opts = buildModelOptions({
			entries: [
				{ id: 'old', displayName: 'Old' },
				{ id: 'new', displayName: 'New' },
			],
			enabledIds: merged,
		});
		expect(new Set(opts.map((o) => o.id))).toEqual(new Set(['old', 'new']));
	});
});
