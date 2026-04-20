import type { AgentToolDef, ToolCall, ToolResult } from './agentTools.js';

export type TeamPlanDecideMode = 'ANSWER' | 'CLARIFY' | 'PLAN';

export type TeamPlanTaskKind = 'discuss' | 'deliver';

export type TeamPlanDecideTask = {
	expert: string;
	task: string;
	kind?: TeamPlanTaskKind;
	dependencies?: string[];
	acceptanceCriteria?: string[];
};

export type TeamPlanDecision = {
	mode: TeamPlanDecideMode;
	tasks: TeamPlanDecideTask[];
	replyToUser?: string;
};

type TeamPlanDecideRuntime = {
	onDecision: (decision: TeamPlanDecision) => void;
};

const runtimes = new Map<string, TeamPlanDecideRuntime>();

export const teamPlanDecideTool: AgentToolDef = {
	name: 'team_plan_decide',
	description: 'Submit the planning decision. MUST be called exactly once before the planning turn ends.',
	parameters: {
		type: 'object',
		properties: {
			mode: {
				type: 'string',
				enum: ['ANSWER', 'CLARIFY', 'PLAN'],
				description: 'Decision mode for this planning turn.',
			},
			tasks: {
				type: 'array',
				description: 'Structured specialist tasks when mode is PLAN.',
				items: {
					type: 'object',
					properties: {
						expert: {
							type: 'string',
							description: 'Specialist assignment key to route the task to.',
						},
						task: {
							type: 'string',
							description: 'Concrete task description for the specialist.',
						},
						kind: {
							type: 'string',
							enum: ['discuss', 'deliver'],
							description:
								'Task intent. Use "discuss" when the user wants ideas / perspectives / analysis and NO file changes. Use "deliver" when the user wants concrete implementation output.',
						},
						dependencies: {
							type: 'array',
							items: { type: 'string' },
							description: 'Optional dependency keys referencing other tasks in the same decision.',
						},
						acceptanceCriteria: {
							type: 'array',
							items: { type: 'string' },
							description: 'Optional acceptance criteria for the task.',
						},
					},
					required: ['expert', 'task'],
				},
			},
			replyToUser: {
				type: 'string',
				description: 'User-visible reply when mode is ANSWER or CLARIFY.',
			},
		},
		required: ['mode'],
	},
};

export function setTeamPlanDecideRuntime(taskId: string, next: TeamPlanDecideRuntime | null): void {
	if (!taskId) {
		return;
	}
	if (next) {
		runtimes.set(taskId, next);
	} else {
		runtimes.delete(taskId);
	}
}

function normalizeTaskKind(raw: unknown): TeamPlanTaskKind {
	const value = String(raw ?? '').trim().toLowerCase();
	return value === 'discuss' ? 'discuss' : 'deliver';
}

function normalizeTask(item: unknown): TeamPlanDecideTask | null {
	if (!item || typeof item !== 'object' || Array.isArray(item)) {
		return null;
	}
	const raw = item as Record<string, unknown>;
	const expert = String(raw.expert ?? '').trim();
	const task = String(raw.task ?? '').trim();
	if (!expert || !task) {
		return null;
	}
	return {
		expert,
		task,
		kind: normalizeTaskKind(raw.kind),
		dependencies: Array.isArray(raw.dependencies)
			? raw.dependencies.map((value) => String(value ?? '').trim()).filter(Boolean)
			: [],
		acceptanceCriteria: Array.isArray(raw.acceptanceCriteria)
			? raw.acceptanceCriteria.map((value) => String(value ?? '').trim()).filter(Boolean)
			: [],
	};
}

export function normalizeTeamPlanDecisionArgs(
	raw: Record<string, unknown>
): { ok: true; decision: TeamPlanDecision } | { ok: false; error: string } {
	const mode = String(raw.mode ?? '').trim().toUpperCase() as TeamPlanDecideMode;
	if (mode !== 'ANSWER' && mode !== 'CLARIFY' && mode !== 'PLAN') {
		return {
			ok: false,
			error: 'Error: team_plan_decide.mode must be ANSWER, CLARIFY, or PLAN.',
		};
	}
	const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask).filter((task): task is TeamPlanDecideTask => Boolean(task)) : [];
	const replyToUser = String(raw.replyToUser ?? '').trim();
	if (mode === 'PLAN' && tasks.length === 0) {
		return {
			ok: false,
			error: 'Error: team_plan_decide requires at least one task when mode is PLAN.',
		};
	}
	if ((mode === 'ANSWER' || mode === 'CLARIFY') && !replyToUser) {
		return {
			ok: false,
			error: 'Error: team_plan_decide.replyToUser is required when mode is ANSWER or CLARIFY.',
		};
	}
	return {
		ok: true,
		decision: {
			mode,
			tasks,
			replyToUser: replyToUser || undefined,
		},
	};
}

export async function executeTeamPlanDecideTool(
	call: ToolCall,
	teamTaskId?: string
): Promise<ToolResult> {
	const runtime = teamTaskId ? runtimes.get(teamTaskId) ?? null : null;
	if (!runtime) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'team_plan_decide is only available during Team planning.',
			isError: true,
		};
	}
	const normalized = normalizeTeamPlanDecisionArgs(call.arguments);
	if (!normalized.ok) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: normalized.error,
			isError: true,
		};
	}
	runtime.onDecision(normalized.decision);
	return {
		toolCallId: call.id,
		name: call.name,
		content: `Planning decision recorded: ${normalized.decision.mode}.`,
		isError: false,
	};
}
