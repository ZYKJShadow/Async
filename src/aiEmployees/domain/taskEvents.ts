import type { AiCollabMessage, AiOrchestrationTimelineEvent } from '../../../shared/aiEmployeesSettings';

export type NormalizedTaskEvent = {
	eventType: string;
	taskId?: string;
	workspaceId?: string;
	issueId?: string;
	agentId?: string;
	employeeId?: string;
	runId?: string;
	handoffId?: string;
	summary: string;
	message?: string;
	status?: string;
	timestamp: string;
	raw: unknown;
};

function asObject(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

function getNested(obj: Record<string, unknown>, key: string): unknown {
	const direct = obj[key];
	if (direct !== undefined) {
		return direct;
	}
	const snake = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
	if (obj[snake] !== undefined) {
		return obj[snake];
	}
	return undefined;
}

function summarizeMessage(eventType: string, payload: Record<string, unknown>): { summary: string; message?: string } {
	const message = firstString(
		getNested(payload, 'message'),
		getNested(payload, 'content'),
		getNested(payload, 'output'),
		getNested(payload, 'text')
	);
	const summary =
		firstString(getNested(payload, 'summary'), message) ??
		(eventType === 'task:dispatch'
			? 'Task dispatched'
			: eventType === 'task:progress'
				? 'Task progress'
				: eventType === 'task:completed'
					? 'Task completed'
					: eventType === 'task:failed'
						? 'Task failed'
						: eventType === 'task:message'
							? 'Task message'
							: eventType);
	return { summary, message };
}

export function normalizeTaskEvent(eventType: string, payload: unknown): NormalizedTaskEvent {
	const obj = asObject(payload);
	const task = asObject(getNested(obj, 'task'));
	const issue = asObject(getNested(obj, 'issue'));
	const { summary, message } = summarizeMessage(eventType, { ...task, ...issue, ...obj });
	const timestamp =
		firstString(getNested(obj, 'timestamp'), getNested(obj, 'createdAt'), getNested(obj, 'created_at')) ??
		new Date().toISOString();
	return {
		eventType,
		taskId: firstString(getNested(obj, 'taskId'), getNested(task, 'id')),
		workspaceId: firstString(getNested(obj, 'workspaceId')),
		issueId: firstString(getNested(obj, 'issueId'), getNested(issue, 'id')),
		agentId: firstString(getNested(obj, 'agentId'), getNested(task, 'agentId'), getNested(task, 'agent_id')),
		employeeId: firstString(getNested(obj, 'employeeId')),
		runId: firstString(getNested(obj, 'runId')),
		handoffId: firstString(getNested(obj, 'handoffId')),
		summary,
		message,
		status: firstString(getNested(obj, 'status'), getNested(task, 'status')),
		timestamp,
		raw: payload,
	};
}

export function taskEventToTimelineEvent(runId: string, event: NormalizedTaskEvent): AiOrchestrationTimelineEvent {
	return {
		id: [event.eventType, event.taskId ?? 'na', event.timestamp].join(':'),
		runId,
		type: event.eventType === 'task:message' ? 'message' : event.eventType === 'task:completed' ? 'result' : 'task_event',
		label: event.summary,
		description: event.message,
		createdAtIso: event.timestamp,
		handoffId: event.handoffId,
		taskId: event.taskId,
		employeeId: event.employeeId,
		status: event.status,
		sourceEventType: event.eventType,
		source: 'remote',
	};
}

export function taskEventToCollabMessage(
	runId: string,
	event: NormalizedTaskEvent,
	fromEmployeeId?: string,
	toEmployeeId?: string
): AiCollabMessage | null {
	if (event.eventType !== 'task:message' && event.eventType !== 'task:completed' && event.eventType !== 'task:failed') {
		return null;
	}
	return {
		id: ['msg', event.eventType, event.taskId ?? 'na', event.timestamp].join(':'),
		runId,
		type:
			event.eventType === 'task:completed'
				? 'result'
				: event.eventType === 'task:failed'
					? 'blocker'
					: 'status_update',
		fromEmployeeId,
		toEmployeeId,
		summary: event.summary,
		body: event.message ?? event.summary,
		taskId: event.taskId,
		createdAtIso: event.timestamp,
	};
}
