import { describe, expect, it } from 'vitest';
import { normalizeTaskEvent, taskEventToCollabMessage, taskEventToTimelineEvent } from './taskEvents';

describe('taskEvents', () => {
	it('normalizes mixed camelCase and nested payloads', () => {
		const event = normalizeTaskEvent('task:progress', {
			task: { id: 'task-1', agent_id: 'agent-1', status: 'running' },
			issue: { id: 'issue-1' },
			timestamp: '2026-04-10T12:00:00.000Z',
			message: 'Compiled 3 files',
		});
		expect(event.taskId).toBe('task-1');
		expect(event.agentId).toBe('agent-1');
		expect(event.issueId).toBe('issue-1');
		expect(event.summary).toBe('Compiled 3 files');
		expect(event.status).toBe('running');
	});

	it('builds timeline and collab projections', () => {
		const event = normalizeTaskEvent('task:completed', {
			taskId: 'task-2',
			timestamp: '2026-04-10T13:00:00.000Z',
			summary: 'Backend task done',
			message: 'All acceptance criteria passed',
		});
		const timeline = taskEventToTimelineEvent('run-1', event);
		expect(timeline.type).toBe('result');
		expect(timeline.taskId).toBe('task-2');
		const message = taskEventToCollabMessage('run-1', event, 'employee-a', 'employee-b');
		expect(message?.type).toBe('result');
		expect(message?.body).toContain('All acceptance criteria passed');
	});
});
