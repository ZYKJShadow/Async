import type { AgentToolDef, ToolCall, ToolResult } from '../../../agent/agentTools.js';
import {
	type FeishuApiClient,
	makeErrorResult,
	makeJsonResult,
} from './feishuApiClient.js';

type Handler = (call: ToolCall) => Promise<ToolResult>;

const TASK_FIELDS_SLIM = [
	'guid',
	'summary',
	'description',
	'due',
	'reminders',
	'creator',
	'members',
	'completed_at',
	'status',
	'task_id',
	'created_at',
	'updated_at',
	'url',
	'start',
	'repeat_rule',
	'parent_task_guid',
	'subtask_count',
	'is_milestone',
	'mode',
] as const;

function slimTask(task: unknown): Record<string, unknown> | unknown {
	if (!task || typeof task !== 'object') return task;
	const out: Record<string, unknown> = {};
	const src = task as Record<string, unknown>;
	for (const k of TASK_FIELDS_SLIM) {
		if (src[k] !== undefined) out[k] = src[k];
	}
	return out;
}

type DueLike = { dueTimestamp?: string; isDueAllDay?: boolean };
type StartLike = { startTimestamp?: string; isStartAllDay?: boolean };

function buildTaskBody(args: Record<string, unknown>): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (typeof args.summary === 'string') body.summary = args.summary;
	if (typeof args.description === 'string') body.description = args.description;
	const due: DueLike = {};
	if (typeof args.dueTimestamp === 'string') due.dueTimestamp = args.dueTimestamp;
	if (typeof args.isDueAllDay === 'boolean') due.isDueAllDay = args.isDueAllDay;
	if (due.dueTimestamp) {
		body.due = { timestamp: due.dueTimestamp, is_all_day: due.isDueAllDay ?? false };
	}
	const start: StartLike = {};
	if (typeof args.startTimestamp === 'string') start.startTimestamp = args.startTimestamp;
	if (typeof args.isStartAllDay === 'boolean') start.isStartAllDay = args.isStartAllDay;
	if (start.startTimestamp) {
		body.start = { timestamp: start.startTimestamp, is_all_day: start.isStartAllDay ?? false };
	}
	if (typeof args.completedAt === 'string') body.completed_at = args.completedAt;
	if (typeof args.repeatRule === 'string') body.repeat_rule = args.repeatRule;
	if (typeof args.mode === 'number') body.mode = args.mode;
	if (typeof args.isMilestone === 'boolean') body.is_milestone = args.isMilestone;
	const assignees = Array.isArray(args.assigneeIds) ? args.assigneeIds : [];
	const followers = Array.isArray(args.followerIds) ? args.followerIds : [];
	const members = [
		...assignees.map((id) => ({ id: String(id), type: 'user', role: 'assignee' })),
		...followers.map((id) => ({ id: String(id), type: 'user', role: 'follower' })),
	];
	if (members.length > 0) body.members = members;
	return body;
}

type SubTask = Record<string, unknown> & { subTasks?: SubTask[] };

async function createOneTask(
	client: FeishuApiClient,
	item: SubTask,
	parentGuid: string | undefined,
	path: string,
	depth: number,
	maxDepth: number,
	errors: Array<{ path: string; error: string }>
): Promise<{ task: unknown; subTasks?: unknown[] } | null> {
	const body = buildTaskBody(item);
	const url = parentGuid ? `/open-apis/task/v2/tasks/${parentGuid}/subtasks` : '/open-apis/task/v2/tasks';
	let created: unknown;
	try {
		const res = await client.request<{ data?: { task?: unknown; subtask?: unknown } }>({
			method: 'POST',
			url,
			data: body,
			userToken: true,
		});
		const data = res?.data ?? (res as { task?: unknown; subtask?: unknown });
		created = parentGuid ? (data?.subtask ?? data) : (data?.task ?? data);
	} catch (e) {
		errors.push({ path, error: e instanceof Error ? e.message : String(e) });
		return null;
	}
	const result: { task: unknown; subTasks?: unknown[] } = { task: slimTask(created) };
	const children = Array.isArray(item.subTasks) ? item.subTasks : [];
	if (children.length && depth < maxDepth) {
		result.subTasks = [];
		const guid = (created as { guid?: string })?.guid;
		for (let i = 0; i < children.length; i++) {
			const child = await createOneTask(
				client,
				children[i] as SubTask,
				guid,
				`${path}.subTasks[${i}]`,
				depth + 1,
				maxDepth,
				errors
			);
			if (child) result.subTasks.push(child);
		}
	}
	return result;
}

export const FEISHU_TASK_TOOL_NAMES = [
	'list_feishu_tasks',
	'create_feishu_task',
	'update_feishu_task',
	'delete_feishu_task',
] as const;

export const feishuTaskToolDefs: AgentToolDef[] = [
	{
		name: 'list_feishu_tasks',
		description:
			'List tasks assigned to the current user ("我负责的"). Returns up to 100 items per call. Optional pageToken for next page; optional completed (true=done only, false=todo only). Requires user_access_token configured on the integration.',
		parameters: {
			type: 'object',
			properties: {
				pageToken: { type: 'string', description: 'Page token from previous response. Omit on first call.' },
				completed: {
					type: 'boolean',
					description: 'Filter by completion: true=only completed, false=only todo, omit=no filter.',
				},
			},
			required: [],
		},
	},
	{
		name: 'create_feishu_task',
		description:
			'Batch-create Feishu tasks (with optional nested subTasks). Each item: summary (required), optional description, dueTimestamp (ms), assigneeIds (open_id list — fetch via get_feishu_users), followerIds, parentTaskGuid (attach under existing task), subTasks (recursive). Max 50 top-level items, 50 per nesting level, max depth 10.',
		parameters: {
			type: 'object',
			properties: {
				tasks: {
					type: 'array',
					description: 'Array of task items. Each may itself contain subTasks for nesting.',
				},
			},
			required: ['tasks'],
		},
	},
	{
		name: 'update_feishu_task',
		description:
			'Update one Feishu task by guid. Provide only the fields you want to change (summary/description/dueTimestamp/completedAt/repeatRule/mode/isMilestone). Requires at least one editable field.',
		parameters: {
			type: 'object',
			properties: {
				taskGuid: { type: 'string', description: 'Target task guid.' },
				summary: { type: 'string' },
				description: { type: 'string' },
				dueTimestamp: { type: 'string', description: 'ms since 1970-01-01 UTC.' },
				isDueAllDay: { type: 'boolean' },
				startTimestamp: { type: 'string' },
				isStartAllDay: { type: 'boolean' },
				completedAt: { type: 'string', description: 'ms timestamp; "0" or omit to clear completion.' },
				repeatRule: { type: 'string' },
				mode: { type: 'number', description: '1 = all assignees must complete, 2 = any.' },
				isMilestone: { type: 'boolean' },
			},
			required: ['taskGuid'],
		},
	},
	{
		name: 'delete_feishu_task',
		description:
			'Delete one or more Feishu tasks by guid (irreversible). Pass guids as an array; each is deleted independently and per-task errors are reported in the result.',
		parameters: {
			type: 'object',
			properties: {
				taskGuids: { type: 'array', description: 'Array of task guids to delete.' },
			},
			required: ['taskGuids'],
		},
	},
];

export function buildFeishuTaskHandlers(client: FeishuApiClient): Record<string, Handler> {
	return {
		list_feishu_tasks: async (call) => {
			try {
				if (!client.hasUserToken) {
					return makeErrorResult(
						call.id,
						call.name,
						new Error('user_access_token is not configured for this Feishu integration.')
					);
				}
				const params: Record<string, unknown> = { page_size: 50, type: 'my_tasks' };
				if (typeof call.arguments.pageToken === 'string' && call.arguments.pageToken) {
					params.page_token = call.arguments.pageToken;
				}
				if (typeof call.arguments.completed === 'boolean') {
					params.completed = call.arguments.completed;
				}
				const first = await client.request<{
					data?: { items?: unknown[]; page_token?: string; has_more?: boolean };
				}>({ method: 'GET', url: '/open-apis/task/v2/tasks', params, userToken: true });
				const firstData = first?.data ?? (first as { items?: unknown[]; page_token?: string; has_more?: boolean });
				const items = (firstData?.items ?? []).map(slimTask);
				let pageToken = firstData?.page_token;
				let hasMore = Boolean(firstData?.has_more);
				if (hasMore && (firstData?.items?.length ?? 0) === 50) {
					try {
						const second = await client.request<{
							data?: { items?: unknown[]; page_token?: string; has_more?: boolean };
						}>({
							method: 'GET',
							url: '/open-apis/task/v2/tasks',
							params: { ...params, page_token: pageToken },
							userToken: true,
						});
						const sd = second?.data ?? (second as { items?: unknown[]; page_token?: string; has_more?: boolean });
						items.push(...(sd?.items ?? []).map(slimTask));
						pageToken = sd?.page_token;
						hasMore = Boolean(sd?.has_more);
					} catch {
						/* second-page failure should not break the first-page result */
					}
				}
				return makeJsonResult(call.id, call.name, { items, page_token: pageToken, has_more: hasMore });
			} catch (e) {
				return makeErrorResult(call.id, call.name, e);
			}
		},
		create_feishu_task: async (call) => {
			try {
				if (!client.hasUserToken) {
					return makeErrorResult(
						call.id,
						call.name,
						new Error('user_access_token is not configured for this Feishu integration.')
					);
				}
				const tasks = Array.isArray(call.arguments.tasks) ? call.arguments.tasks : [];
				if (tasks.length === 0) {
					return makeErrorResult(call.id, call.name, new Error('tasks must contain at least one item.'));
				}
				if (tasks.length > 50) {
					return makeErrorResult(call.id, call.name, new Error('tasks cannot exceed 50 top-level items.'));
				}
				const errors: Array<{ path: string; error: string }> = [];
				const results: unknown[] = [];
				for (let i = 0; i < tasks.length; i++) {
					const item = tasks[i] as SubTask;
					const parentGuid = typeof item.parentTaskGuid === 'string' ? item.parentTaskGuid : undefined;
					const created = await createOneTask(client, item, parentGuid, `[${i}]`, 0, 10, errors);
					if (created) results.push(created);
				}
				return makeJsonResult(call.id, call.name, { results, errors });
			} catch (e) {
				return makeErrorResult(call.id, call.name, e);
			}
		},
		update_feishu_task: async (call) => {
			try {
				if (!client.hasUserToken) {
					return makeErrorResult(
						call.id,
						call.name,
						new Error('user_access_token is not configured for this Feishu integration.')
					);
				}
				const taskGuid = String(call.arguments.taskGuid ?? '').trim();
				if (!taskGuid) {
					return makeErrorResult(call.id, call.name, new Error('taskGuid is required.'));
				}
				const task: Record<string, unknown> = {};
				const updateFields: string[] = [];
				const args = call.arguments;
				if (typeof args.summary === 'string') {
					task.summary = args.summary;
					updateFields.push('summary');
				}
				if (typeof args.description === 'string') {
					task.description = args.description;
					updateFields.push('description');
				}
				if (typeof args.dueTimestamp === 'string') {
					task.due = { timestamp: args.dueTimestamp, is_all_day: Boolean(args.isDueAllDay) };
					updateFields.push('due');
				}
				if (typeof args.startTimestamp === 'string') {
					task.start = { timestamp: args.startTimestamp, is_all_day: Boolean(args.isStartAllDay) };
					updateFields.push('start');
				}
				if (typeof args.completedAt === 'string') {
					task.completed_at = args.completedAt;
					updateFields.push('completed_at');
				}
				if (typeof args.repeatRule === 'string') {
					task.repeat_rule = args.repeatRule;
					updateFields.push('repeat_rule');
				}
				if (typeof args.mode === 'number') {
					task.mode = args.mode;
					updateFields.push('mode');
				}
				if (typeof args.isMilestone === 'boolean') {
					task.is_milestone = args.isMilestone;
					updateFields.push('is_milestone');
				}
				if (updateFields.length === 0) {
					return makeErrorResult(call.id, call.name, new Error('At least one editable field is required.'));
				}
				const res = await client.request<{ data?: { task?: unknown } }>({
					method: 'PATCH',
					url: `/open-apis/task/v2/tasks/${taskGuid}`,
					data: { task, update_fields: updateFields },
					userToken: true,
				});
				const updated = res?.data?.task ?? res;
				return makeJsonResult(call.id, call.name, slimTask(updated));
			} catch (e) {
				return makeErrorResult(call.id, call.name, e);
			}
		},
		delete_feishu_task: async (call) => {
			try {
				if (!client.hasUserToken) {
					return makeErrorResult(
						call.id,
						call.name,
						new Error('user_access_token is not configured for this Feishu integration.')
					);
				}
				const guidsRaw = Array.isArray(call.arguments.taskGuids) ? call.arguments.taskGuids : [];
				const guids = guidsRaw.map((g) => String(g).trim()).filter(Boolean);
				if (guids.length === 0) {
					return makeErrorResult(call.id, call.name, new Error('taskGuids must contain at least one guid.'));
				}
				const deleted: string[] = [];
				const errors: Array<{ guid: string; error: string }> = [];
				for (const guid of guids) {
					try {
						await client.request({
							method: 'DELETE',
							url: `/open-apis/task/v2/tasks/${guid}`,
							userToken: true,
						});
						deleted.push(guid);
					} catch (e) {
						errors.push({ guid, error: e instanceof Error ? e.message : String(e) });
					}
				}
				return makeJsonResult(call.id, call.name, { deleted, errors });
			} catch (e) {
				return makeErrorResult(call.id, call.name, e);
			}
		},
	};
}
