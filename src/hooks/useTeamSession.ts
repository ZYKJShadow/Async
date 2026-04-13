import { useCallback, useMemo, useState } from 'react';
import { applyLiveAgentChatPayload, createEmptyLiveAgentBlocks, type LiveAgentBlocksState } from '../liveAgentBlocks';
import type { ChatMessage } from '../threadTypes';
import type { ChatStreamPayload, TeamRoleScope, TurnTokenUsage } from '../ipcTypes';

export type TeamSessionPhase = 'planning' | 'executing' | 'reviewing' | 'delivering' | 'waiting_user';
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'revision';
export type TeamRoleType = 'team_lead' | 'frontend' | 'backend' | 'qa' | 'reviewer' | 'custom';

export type TeamTask = {
	id: string;
	expertId: string;
	expertAssignmentKey?: string;
	expertName: string;
	roleType: TeamRoleType;
	description: string;
	status: TeamTaskStatus;
	dependencies: string[];
	acceptanceCriteria?: string[];
	result?: string;
	logs: string[];
};

export type TeamRoleWorkflowState = {
	taskId: string;
	expertId: string;
	expertName: string;
	roleType: TeamRoleType;
	roleKind: 'specialist' | 'reviewer';
	streaming: string;
	streamingThinking: string;
	liveBlocks: LiveAgentBlocksState;
	messages: ChatMessage[];
	lastTurnUsage: TurnTokenUsage | null;
	awaitingReply: boolean;
	lastUpdatedAt: number;
};

export type TeamSessionState = {
	phase: TeamSessionPhase;
	tasks: TeamTask[];
	planSummary: string;
	reviewSummary: string;
	reviewVerdict: 'approved' | 'revision_needed' | null;
	selectedTaskId: string | null;
	reviewerTaskId: string | null;
	roleWorkflowByTaskId: Record<string, TeamRoleWorkflowState>;
	userInputRequest:
		| {
				requestId: string;
				question: string;
				options: { id: string; label: string }[];
		  }
		| null;
	updatedAt: number;
};

function emptySession(): TeamSessionState {
	return {
		phase: 'planning',
		tasks: [],
		planSummary: '',
		reviewSummary: '',
		reviewVerdict: null,
		selectedTaskId: null,
		reviewerTaskId: null,
		roleWorkflowByTaskId: {},
		userInputRequest: null,
		updatedAt: Date.now(),
	};
}

function createRoleWorkflow(scope: TeamRoleScope): TeamRoleWorkflowState {
	return {
		taskId: scope.teamTaskId,
		expertId: scope.teamExpertId,
		expertName: scope.teamExpertName,
		roleType: scope.teamRoleType,
		roleKind: scope.teamRoleKind,
		streaming: '',
		streamingThinking: '',
		liveBlocks: createEmptyLiveAgentBlocks(),
		messages: [],
		lastTurnUsage: null,
		awaitingReply: true,
		lastUpdatedAt: Date.now(),
	};
}

function upsertRoleWorkflow(
	roleWorkflowByTaskId: Record<string, TeamRoleWorkflowState>,
	scope: TeamRoleScope
): Record<string, TeamRoleWorkflowState> {
	const current = roleWorkflowByTaskId[scope.teamTaskId];
	if (
		current &&
		current.expertId === scope.teamExpertId &&
		current.expertName === scope.teamExpertName &&
		current.roleType === scope.teamRoleType &&
		current.roleKind === scope.teamRoleKind
	) {
		return roleWorkflowByTaskId;
	}
	return {
		...roleWorkflowByTaskId,
		[scope.teamTaskId]: current
			? {
					...current,
					expertId: scope.teamExpertId,
					expertName: scope.teamExpertName,
					roleType: scope.teamRoleType,
					roleKind: scope.teamRoleKind,
			  }
			: createRoleWorkflow(scope),
	};
}

function appendRoleWorkflowMessage(
	roleWorkflowByTaskId: Record<string, TeamRoleWorkflowState>,
	taskId: string,
	nextMessage: ChatMessage,
	usage?: TurnTokenUsage
): Record<string, TeamRoleWorkflowState> {
	const current = roleWorkflowByTaskId[taskId];
	if (!current) {
		return roleWorkflowByTaskId;
	}
	return {
		...roleWorkflowByTaskId,
		[taskId]: {
			...current,
			streaming: '',
			streamingThinking: '',
			liveBlocks: createEmptyLiveAgentBlocks(),
			messages:
				current.messages[current.messages.length - 1]?.role === nextMessage.role &&
				current.messages[current.messages.length - 1]?.content === nextMessage.content
					? current.messages
					: [...current.messages, nextMessage],
			lastTurnUsage: usage ?? current.lastTurnUsage,
			awaitingReply: false,
			lastUpdatedAt: Date.now(),
		},
	};
}

function applyRoleWorkflowPayload(
	roleWorkflowByTaskId: Record<string, TeamRoleWorkflowState>,
	payload: ChatStreamPayload,
	scope: TeamRoleScope
): Record<string, TeamRoleWorkflowState> {
	const withWorkflow = upsertRoleWorkflow(roleWorkflowByTaskId, scope);
	const current = withWorkflow[scope.teamTaskId];
	if (!current) {
		return withWorkflow;
	}
	if (payload.type === 'delta') {
		return {
			...withWorkflow,
			[scope.teamTaskId]: {
				...current,
				streaming: current.streaming + payload.text,
				liveBlocks: applyLiveAgentChatPayload(current.liveBlocks, { type: 'delta', text: payload.text }),
				awaitingReply: true,
				lastUpdatedAt: Date.now(),
			},
		};
	}
	if (payload.type === 'thinking_delta') {
		return {
			...withWorkflow,
			[scope.teamTaskId]: {
				...current,
				streamingThinking: current.streamingThinking + payload.text,
				liveBlocks: applyLiveAgentChatPayload(current.liveBlocks, { type: 'thinking_delta', text: payload.text }),
				awaitingReply: true,
				lastUpdatedAt: Date.now(),
			},
		};
	}
	if (payload.type === 'tool_input_delta') {
		return {
			...withWorkflow,
			[scope.teamTaskId]: {
				...current,
				liveBlocks: applyLiveAgentChatPayload(current.liveBlocks, {
					type: 'tool_input_delta',
					name: payload.name,
					partialJson: payload.partialJson,
					index: payload.index,
				}),
				awaitingReply: true,
				lastUpdatedAt: Date.now(),
			},
		};
	}
	if (payload.type === 'tool_call') {
		return {
			...withWorkflow,
			[scope.teamTaskId]: {
				...current,
				streaming:
					current.streaming +
					`\n<tool_call tool="${payload.name}">${payload.args}</tool_call>\n`,
				liveBlocks: applyLiveAgentChatPayload(current.liveBlocks, {
					type: 'tool_call',
					name: payload.name,
					args: payload.args,
					toolCallId: payload.toolCallId,
				}),
				awaitingReply: true,
				lastUpdatedAt: Date.now(),
			},
		};
	}
	if (payload.type === 'tool_result') {
		const safe = payload.result.split('</tool_result>').join('</tool\u200c_result>');
		return {
			...withWorkflow,
			[scope.teamTaskId]: {
				...current,
				streaming:
					current.streaming +
					`<tool_result tool="${payload.name}" success="${payload.success}">${safe}</tool_result>\n`,
				liveBlocks: applyLiveAgentChatPayload(current.liveBlocks, {
					type: 'tool_result',
					name: payload.name,
					result: payload.result,
					success: payload.success,
					toolCallId: payload.toolCallId,
				}),
				awaitingReply: true,
				lastUpdatedAt: Date.now(),
			},
		};
	}
	if (payload.type === 'tool_progress') {
		return {
			...withWorkflow,
			[scope.teamTaskId]: {
				...current,
				liveBlocks: applyLiveAgentChatPayload(current.liveBlocks, {
					type: 'tool_progress',
					name: payload.name,
					phase: payload.phase,
					detail: payload.detail,
				}),
				awaitingReply: true,
				lastUpdatedAt: Date.now(),
			},
		};
	}
	if (payload.type === 'done') {
		return appendRoleWorkflowMessage(withWorkflow, scope.teamTaskId, { role: 'assistant', content: payload.text }, payload.usage);
	}
	if (payload.type === 'error') {
		return appendRoleWorkflowMessage(withWorkflow, scope.teamTaskId, {
			role: 'assistant',
			content: `Error: ${payload.message}`,
		});
	}
	return withWorkflow;
}

function upsertTask(tasks: TeamTask[], next: TeamTask): TeamTask[] {
	const idx = tasks.findIndex((t) => t.id === next.id);
	if (idx < 0) {
		return [...tasks, next];
	}
	const copy = [...tasks];
	copy[idx] = { ...copy[idx]!, ...next };
	return copy;
}

export function useTeamSession() {
	const [sessionsByThread, setSessionsByThread] = useState<Record<string, TeamSessionState>>({});

	const applyTeamPayload = useCallback((payload: ChatStreamPayload) => {
		if (!payload.threadId) {
			return;
		}
		const threadId = payload.threadId;
		setSessionsByThread((prev) => {
			const session = prev[threadId] ?? emptySession();
			if (payload.teamRoleScope) {
				const nextRoleWorkflowByTaskId = applyRoleWorkflowPayload(
					session.roleWorkflowByTaskId,
					payload,
					payload.teamRoleScope
				);
				const selectedTaskId = session.selectedTaskId ?? payload.teamRoleScope.teamTaskId;
				return {
					...prev,
					[threadId]: {
						...session,
						roleWorkflowByTaskId: nextRoleWorkflowByTaskId,
						selectedTaskId,
						reviewerTaskId:
							payload.teamRoleScope.teamRoleKind === 'reviewer'
								? payload.teamRoleScope.teamTaskId
								: session.reviewerTaskId,
						updatedAt: Date.now(),
					},
				};
			}
			if (!String(payload.type).startsWith('team_')) {
				return prev;
			}
			let next = session;
			switch (payload.type) {
				case 'team_phase':
					next = {
						...session,
						phase: payload.phase,
						userInputRequest: payload.phase === 'waiting_user' ? session.userInputRequest : null,
					};
					break;
				case 'team_task_created': {
					const created: TeamTask = {
						id: payload.task.id,
						expertId: payload.task.expertId,
						expertAssignmentKey: payload.task.expertAssignmentKey,
						expertName: payload.task.expertName,
						roleType: payload.task.roleType,
						description: payload.task.description,
						status: payload.task.status,
						dependencies: payload.task.dependencies ?? [],
						acceptanceCriteria: payload.task.acceptanceCriteria ?? [],
						logs: [],
					};
					next = {
						...session,
						tasks: upsertTask(session.tasks, created),
						selectedTaskId: session.selectedTaskId ?? payload.task.id,
					};
					break;
				}
				case 'team_expert_started': {
					next = {
						...session,
						selectedTaskId: session.selectedTaskId ?? payload.taskId,
						tasks: session.tasks.map((t) =>
							t.id === payload.taskId ? { ...t, status: 'in_progress', logs: [...t.logs, 'Started'] } : t
						),
					};
					break;
				}
				case 'team_expert_progress': {
					const detail = payload.message ?? payload.delta ?? '';
					next = {
						...session,
						tasks: session.tasks.map((t) =>
							t.id === payload.taskId
								? {
										...t,
										logs: detail ? [...t.logs, detail] : t.logs,
									}
								: t
						),
					};
					break;
				}
				case 'team_expert_done': {
					next = {
						...session,
						tasks: session.tasks.map((t) =>
							t.id === payload.taskId
								? {
										...t,
										status: payload.success ? 'completed' : 'failed',
										result: payload.result,
										logs: payload.result ? [...t.logs, payload.result] : t.logs,
									}
								: t
						),
					};
					break;
				}
			case 'team_plan_summary':
				next = {
					...session,
					planSummary: payload.summary,
				};
				break;
			case 'team_review':
				next = {
					...session,
					reviewVerdict: payload.verdict,
					reviewSummary: payload.summary,
				};
				break;
				case 'team_user_input_needed':
					next = {
						...session,
						phase: 'waiting_user',
						userInputRequest: {
							requestId: payload.requestId,
							question: payload.question,
							options: payload.options ?? [],
						},
					};
					break;
				default:
					return prev;
			}
			return {
				...prev,
				[threadId]: { ...next, updatedAt: Date.now() },
			};
		});
	}, []);

	const setSelectedTask = useCallback((threadId: string, taskId: string | null) => {
		setSessionsByThread((prev) => {
			const cur = prev[threadId] ?? emptySession();
			return {
				...prev,
				[threadId]: { ...cur, selectedTaskId: taskId, updatedAt: Date.now() },
			};
		});
	}, []);

	const clearTeamSession = useCallback((threadId: string) => {
		setSessionsByThread((prev) => {
			if (!prev[threadId]) {
				return prev;
			}
			const next = { ...prev };
			delete next[threadId];
			return next;
		});
	}, []);

	const getTeamSession = useCallback(
		(threadId: string | null): TeamSessionState | null => {
			if (!threadId) {
				return null;
			}
			return sessionsByThread[threadId] ?? null;
		},
		[sessionsByThread]
	);

	return useMemo(
		() => ({
			sessionsByThread,
			applyTeamPayload,
			setSelectedTask,
			clearTeamSession,
			getTeamSession,
		}),
		[sessionsByThread, applyTeamPayload, setSelectedTask, clearTeamSession, getTeamSession]
	);
}
