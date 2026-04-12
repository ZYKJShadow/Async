import { describe, expect, it } from 'vitest';
import type { AiCollabMessage } from '../../../shared/aiEmployeesSettings';
import type { OrgEmployee } from '../api/orgTypes';
import {
	buildCollabHistoryForCeoInRun,
	buildCollabHistoryForEmployeeInRun,
} from './employeeChatHistory';

const eng: OrgEmployee = {
	id: 'e1',
	displayName: '工程师',
	roleKey: 'dev',
	isCeo: false,
	capabilities: [],
	status: 'active',
	sortOrder: 0,
	modelSource: 'local_model',
};

function msg(p: Partial<AiCollabMessage> & Pick<AiCollabMessage, 'id' | 'runId' | 'type' | 'summary' | 'body' | 'createdAtIso'>): AiCollabMessage {
	return {
		fromEmployeeId: undefined,
		toEmployeeId: undefined,
		...p,
	};
}

describe('employeeChatHistory group run', () => {
	it('buildCollabHistoryForCeoInRun treats non-CEO lines as user and CEO as assistant', () => {
		const messages: AiCollabMessage[] = [
			msg({
				id: '1',
				runId: 'r1',
				type: 'text',
				toEmployeeId: 'ceo1',
				summary: 'hi',
				body: '用户问题',
				createdAtIso: '2020-01-01T00:00:00.000Z',
			}),
			msg({
				id: '2',
				runId: 'r1',
				type: 'text',
				fromEmployeeId: 'ceo1',
				summary: 'ok',
				body: 'CEO 回复',
				createdAtIso: '2020-01-01T00:00:01.000Z',
			}),
		];
		const h = buildCollabHistoryForCeoInRun(messages, 'r1', 'ceo1');
		expect(h).toEqual([
			{ role: 'user', content: '用户问题' },
			{ role: 'assistant', content: 'CEO 回复' },
		]);
	});

	it('buildCollabHistoryForEmployeeInRun includes CEO context lines for a teammate', () => {
		const messages: AiCollabMessage[] = [
			msg({
				id: '1',
				runId: 'r1',
				type: 'text',
				fromEmployeeId: 'ceo1',
				summary: 's',
				body: 'CEO 布置',
				createdAtIso: '2020-01-01T00:00:00.000Z',
			}),
			msg({
				id: '2',
				runId: 'r1',
				type: 'task_assignment',
				fromEmployeeId: 'ceo1',
				toEmployeeId: 'e1',
				summary: '读代码',
				body: '请读 src',
				createdAtIso: '2020-01-01T00:00:01.000Z',
			}),
			msg({
				id: '3',
				runId: 'r1',
				type: 'text',
				fromEmployeeId: 'e1',
				summary: 'done',
				body: '我看完了',
				createdAtIso: '2020-01-01T00:00:02.000Z',
			}),
		];
		const h = buildCollabHistoryForEmployeeInRun(messages, 'r1', eng.id, 'ceo1');
		expect(h.some((t) => t.role === 'user' && t.content.includes('CEO 布置'))).toBe(true);
		expect(h.some((t) => t.role === 'user' && t.content.includes('[Task assigned]'))).toBe(true);
		expect(h.some((t) => t.role === 'assistant' && t.content === '我看完了')).toBe(true);
	});

	it('buildCollabHistoryForEmployeeInRun uses employee id for thread filter', () => {
		const messages: AiCollabMessage[] = [
			msg({
				id: '1',
				runId: 'r1',
				type: 'text',
				fromEmployeeId: eng.id,
				summary: 'a',
				body: 'only eng',
				createdAtIso: '2020-01-01T00:00:00.000Z',
			}),
		];
		const h = buildCollabHistoryForEmployeeInRun(messages, 'r1', eng.id, 'ceo1');
		expect(h).toEqual([{ role: 'assistant', content: 'only eng' }]);
	});

	it('does not leak CEO messages to other teammates into this employee thread', () => {
		const messages: AiCollabMessage[] = [
			msg({
				id: '1',
				runId: 'r1',
				type: 'text',
				fromEmployeeId: 'ceo1',
				toEmployeeId: 'e2',
				summary: 'to designer',
				body: '这条消息是发给设计师的',
				createdAtIso: '2020-01-01T00:00:00.000Z',
			}),
			msg({
				id: '2',
				runId: 'r1',
				type: 'text',
				fromEmployeeId: 'ceo1',
				toEmployeeId: 'e1',
				summary: 'to engineer',
				body: '这条消息是发给工程师的',
				createdAtIso: '2020-01-01T00:00:01.000Z',
			}),
		];
		const h = buildCollabHistoryForEmployeeInRun(messages, 'r1', eng.id, 'ceo1');
		expect(h).toEqual([{ role: 'user', content: '这条消息是发给工程师的' }]);
	});
});
