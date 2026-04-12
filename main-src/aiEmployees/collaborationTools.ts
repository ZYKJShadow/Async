/**
 * Collaboration tools for AI employees — allow agents to interact with each other
 * through the orchestration layer. These tools are injected into the agent loop's
 * tool pool when running employee chat in agent mode.
 *
 * Tool calls are executed in main process (returning success messages to the agent)
 * and forwarded to the renderer via IPC for orchestration state updates.
 */

import type { AgentToolDef, ToolCall, ToolResult } from '../agent/agentTools.js';

/* ─── Tool name constants ──────────────────────���───────────── */

export const COLLAB_TOOL_NAMES = new Set([
	'draft_plan',
	'delegate_task',
	'send_colleague_message',
	'submit_result',
	'report_blocker',
]);

export function isCollabTool(name: string): boolean {
	return COLLAB_TOOL_NAMES.has(name);
}

/* ─── Tool definitions ─────────────────────────────────────── */

/** CEO-only: publish a checklist before delegating work. */
const draftPlanTool: AgentToolDef = {
	name: 'draft_plan',
	description:
		'Publish a visible execution plan (checklist) for this run. As CEO, call this once at the start of a multi-step request, ' +
		'before any delegate_task calls, so the boss sees who will do what. Each checklist line should map to a future delegation.',
	parameters: {
		type: 'object',
		properties: {
			items: {
				type: 'array',
				description:
					'Ordered checklist entries. Each item has a short title and optional owner (teammate display name). ' +
					'Use owner_employee_name when a step is clearly owned by a teammate; omit for CEO-owned coordination steps.',
				items: {
					type: 'object',
					properties: {
						title: { type: 'string', description: 'One-line description of the step (under 120 characters).' },
						owner_employee_name: {
							type: 'string',
							description: 'Optional: teammate display name expected to own this step.',
						},
					},
					required: ['title'],
				},
			},
		},
		required: ['items'],
	},
};

const delegateTaskTool: AgentToolDef = {
	name: 'delegate_task',
	description:
		'Assign a task to a teammate. Use this when a task requires expertise outside your scope, ' +
		'or when the CEO/coordinator decides which team member should handle a piece of work. ' +
		'The target employee will receive the task and begin working on it. ' +
		'When a run plan exists, pass plan_item_id so the checklist stays in sync with this job.',
	parameters: {
		type: 'object',
		properties: {
			target_employee_name: {
				type: 'string',
				description: 'The display name of the teammate to assign the task to (must match a name from your team roster).',
			},
			task_title: {
				type: 'string',
				description: 'A short title for the task (under 80 characters).',
			},
			task_description: {
				type: 'string',
				description: 'Detailed description of what needs to be done, including context, requirements, and expected deliverables.',
			},
			priority: {
				type: 'string',
				description: 'Task priority: "urgent", "high", "medium", or "low". Defaults to "medium".',
			},
			context_files: {
				type: 'string',
				description: 'Optional comma-separated list of file paths relevant to this task.',
			},
			plan_item_id: {
				type: 'string',
				description:
					'When a plan was drafted, the id of the checklist item this delegation fulfills (must match an item from draft_plan).',
			},
		},
		required: ['target_employee_name', 'task_title', 'task_description'],
	},
};

const sendColleagueMessageTool: AgentToolDef = {
	name: 'send_colleague_message',
	description:
		'Send a message to a teammate for collaboration. Use this to ask questions, share context, ' +
		'request clarification, or coordinate work. The colleague will see your message and can respond.',
	parameters: {
		type: 'object',
		properties: {
			target_employee_name: {
				type: 'string',
				description: 'The display name of the teammate to message.',
			},
			message: {
				type: 'string',
				description: 'The message content to send.',
			},
		},
		required: ['target_employee_name', 'message'],
	},
};

const submitResultTool: AgentToolDef = {
	name: 'submit_result',
	description:
		'Report that your current task is complete. Include a summary of what was accomplished ' +
		'and any files that were modified. This will notify the boss and allow the next step to proceed.',
	parameters: {
		type: 'object',
		properties: {
			summary: {
				type: 'string',
				description: 'A concise summary of what was accomplished.',
			},
			modified_files: {
				type: 'string',
				description: 'Optional comma-separated list of files that were created or modified.',
			},
			next_steps: {
				type: 'string',
				description: 'Optional suggestions for follow-up work or the next team member in the chain.',
			},
		},
		required: ['summary'],
	},
};

const reportBlockerTool: AgentToolDef = {
	name: 'report_blocker',
	description:
		'Report that you are blocked and cannot continue your current task. ' +
		'Describe the issue and optionally suggest which teammate might help resolve it.',
	parameters: {
		type: 'object',
		properties: {
			description: {
				type: 'string',
				description: 'Description of the blocker — what you tried, what went wrong, what you need.',
			},
			suggested_helper_name: {
				type: 'string',
				description: 'Optional: display name of a teammate who might be able to help.',
			},
		},
		required: ['description'],
	},
};

/** Collaboration tools available to non-CEO teammates (and shared tools). */
export const COLLAB_TOOL_DEFS: AgentToolDef[] = [
	delegateTaskTool,
	sendColleagueMessageTool,
	submitResultTool,
	reportBlockerTool,
];

/** CEO coordinator: plan first, then delegate. */
export const CEO_COLLAB_TOOL_DEFS: AgentToolDef[] = [draftPlanTool, ...COLLAB_TOOL_DEFS];

/* ─── Typed collab action payload ──────────────────────────── */

export type CollabAction =
	| {
			tool: 'draft_plan';
			items: Array<{ title: string; ownerEmployeeName?: string }>;
	  }
	| {
			tool: 'delegate_task';
			targetEmployeeName: string;
			taskTitle: string;
			taskDescription: string;
			priority: string;
			contextFiles: string[];
			planItemId?: string;
	  }
	| {
			tool: 'send_colleague_message';
			targetEmployeeName: string;
			message: string;
	  }
	| {
			tool: 'submit_result';
			summary: string;
			modifiedFiles: string[];
			nextSteps?: string;
	  }
	| {
			tool: 'report_blocker';
			description: string;
			suggestedHelperName?: string;
	  };

/** Parse raw tool args into a typed CollabAction. */
export function parseCollabAction(name: string, args: Record<string, unknown>): CollabAction | null {
	const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string).trim() : '');
	const csvList = (key: string) =>
		str(key)
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

	switch (name) {
		case 'draft_plan': {
			const raw = args.items;
			if (!Array.isArray(raw) || raw.length === 0) {
				return null;
			}
			const items: Array<{ title: string; ownerEmployeeName?: string }> = [];
			for (const row of raw) {
				if (!row || typeof row !== 'object') {
					continue;
				}
				const rec = row as Record<string, unknown>;
				const title = typeof rec.title === 'string' ? rec.title.trim() : '';
				if (!title) {
					continue;
				}
				const ownerRaw = rec.owner_employee_name;
				const ownerEmployeeName =
					typeof ownerRaw === 'string' && ownerRaw.trim() ? ownerRaw.trim() : undefined;
				items.push(ownerEmployeeName ? { title, ownerEmployeeName } : { title });
			}
			if (items.length === 0) {
				return null;
			}
			return { tool: 'draft_plan', items };
		}
		case 'delegate_task': {
			const planItemRaw = str('plan_item_id');
			return {
				tool: 'delegate_task',
				targetEmployeeName: str('target_employee_name'),
				taskTitle: str('task_title'),
				taskDescription: str('task_description'),
				priority: str('priority') || 'medium',
				contextFiles: csvList('context_files'),
				planItemId: planItemRaw || undefined,
			};
		}
		case 'send_colleague_message':
			return {
				tool: 'send_colleague_message',
				targetEmployeeName: str('target_employee_name'),
				message: str('message'),
			};
		case 'submit_result':
			return {
				tool: 'submit_result',
				summary: str('summary'),
				modifiedFiles: csvList('modified_files'),
				nextSteps: str('next_steps') || undefined,
			};
		case 'report_blocker':
			return {
				tool: 'report_blocker',
				description: str('description'),
				suggestedHelperName: str('suggested_helper_name') || undefined,
			};
		default:
			return null;
	}
}

/* ─── Tool execution (main process) ───────────────────────── */

/**
 * Execute a collaboration tool and return a result for the agent loop.
 * These tools don't have side effects in main process — the real orchestration
 * state updates happen in the renderer via IPC callbacks.
 */
export function executeCollabTool(call: ToolCall): ToolResult {
	const action = parseCollabAction(call.name, call.arguments);
	if (!action) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `Unknown collaboration tool: ${call.name}`,
			isError: true,
		};
	}

	switch (action.tool) {
		case 'draft_plan':
			return {
				toolCallId: call.id,
				name: call.name,
				content:
					`Plan published with ${action.items.length} step(s). The boss can see the checklist.\n` +
					`Now call delegate_task for each actionable step; include plan_item_id when linking to a checklist row.`,
				isError: false,
			};
		case 'delegate_task':
			return {
				toolCallId: call.id,
				name: call.name,
				content:
					`Task delegated to ${action.targetEmployeeName}: "${action.taskTitle}"\n` +
					`Priority: ${action.priority}\n` +
					(action.planItemId ? `Linked to plan item: ${action.planItemId}\n` : '') +
					`${action.targetEmployeeName} will receive this task and begin working on it. ` +
					`You will be notified of progress.`,
				isError: false,
			};
		case 'send_colleague_message':
			return {
				toolCallId: call.id,
				name: call.name,
				content: `Message sent to ${action.targetEmployeeName}. They will see it and can respond.`,
				isError: false,
			};
		case 'submit_result':
			return {
				toolCallId: call.id,
				name: call.name,
				content:
					`Result submitted: "${action.summary}"\n` +
					(action.modifiedFiles.length > 0 ? `Modified files: ${action.modifiedFiles.join(', ')}\n` : '') +
					`The boss has been notified. The next step in the workflow will proceed.`,
				isError: false,
			};
		case 'report_blocker':
			return {
				toolCallId: call.id,
				name: call.name,
				content:
					`Blocker reported: "${action.description}"\n` +
					(action.suggestedHelperName
						? `Suggested helper: ${action.suggestedHelperName}\n`
						: '') +
					`The team has been notified. Someone will help resolve this.`,
				isError: false,
			};
	}
}
