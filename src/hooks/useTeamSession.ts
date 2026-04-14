import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../threadTypes';
import type { ChatStreamPayload, TeamRoleScope, TurnTokenUsage } from '../ipcTypes';
import {
	applyLiveAgentChatPayload,
	createEmptyLiveAgentBlocks,
	type LiveAgentBlocksState,
} from '../liveAgentBlocks';
import { flattenAssistantTextPartsForSearch } from '../agentStructuredMessage';
import { extractTeamLeadNarrative } from '../teamWorkflowText';

export type TeamSessionPhase =
	| 'planning'
	| 'preflight'
	| 'proposing'
	| 'executing'
	| 'reviewing'
	| 'delivering'
	| 'cancelled';

export type TeamPlanProposedTask = {
	expert: string;
	expertName: string;
	roleType: TeamRoleType;
	task: string;
	dependencies?: string[];
	acceptanceCriteria?: string[];
};

export type TeamPlanProposalState = {
	proposalId: string;
	summary: string;
	tasks: TeamPlanProposedTask[];
	preflightSummary?: string;
	preflightVerdict?: 'ok' | 'needs_clarification';
	/** true while awaiting user approval; false after decision */
	awaitingApproval: boolean;
	decision?: 'approved' | 'rejected';
};
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'revision';
export type TeamRoleType = 'team_lead' | 'frontend' | 'backend' | 'qa' | 'reviewer' | 'custom';

export type TeamSessionSnapshot = {
	phase: TeamSessionPhase;
	tasks: Array<{
		id: string;
		expertId: string;
		expertAssignmentKey?: string;
		expertName: string;
		roleType: string;
		description: string;
		status: string;
		dependencies: string[];
		acceptanceCriteria: string[];
		result?: string;
	}>;
	planSummary: string;
	leaderMessage: string;
	reviewSummary: string;
	reviewVerdict: 'approved' | 'revision_needed' | null;
};

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
	roleKind: 'specialist' | 'reviewer' | 'lead';
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
	originalUserRequest: string;
	leaderMessage: string;
	leaderWorkflow: TeamRoleWorkflowState | null;
	planSummary: string;
	reviewSummary: string;
	reviewVerdict: 'approved' | 'revision_needed' | null;
	preflightSummary: string;
	preflightVerdict: 'ok' | 'needs_clarification' | null;
	planProposal: TeamPlanProposalState | null;
	selectedTaskId: string | null;
	reviewerTaskId: string | null;
	roleWorkflowByTaskId: Record<string, TeamRoleWorkflowState>;
	updatedAt: number;
};

function emptySession(): TeamSessionState {
	return {
		phase: 'planning',
		tasks: [],
		originalUserRequest: '',
		leaderMessage: '',
		leaderWorkflow: null,
		planSummary: '',
		reviewSummary: '',
		reviewVerdict: null,
		preflightSummary: '',
		preflightVerdict: null,
		planProposal: null,
		selectedTaskId: null,
		reviewerTaskId: null,
		roleWorkflowByTaskId: {},
		updatedAt: Date.now(),
	};
}

const MAX_TASK_LOGS = 50;
const FLUSH_INTERVAL_MS = 250;

function normalizeTeamSummary(raw: string, fallback = ''): string {
	const flattened = flattenAssistantTextPartsForSearch(raw).trim();
	if (flattened) {
		return flattened;
	}
	const trimmed = raw.trim();
	return trimmed || fallback;
}

function ensureRoleWorkflow(
	roleWorkflowByTaskId: Record<string, TeamRoleWorkflowState>,
	scope: TeamRoleScope
): TeamRoleWorkflowState {
	const current = roleWorkflowByTaskId[scope.teamTaskId];
	if (current) {
		current.expertId = scope.teamExpertId;
		current.expertName = scope.teamExpertName;
		current.roleType = scope.teamRoleType;
		current.roleKind = scope.teamRoleKind;
		return current;
	}
	const workflow: TeamRoleWorkflowState = {
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
	roleWorkflowByTaskId[scope.teamTaskId] = workflow;
	return workflow;
}

function ensureLeaderWorkflow(
	session: TeamSessionState,
	scope: TeamRoleScope
): TeamRoleWorkflowState {
	const current = session.leaderWorkflow;
	if (current) {
		current.expertId = scope.teamExpertId;
		current.expertName = scope.teamExpertName;
		current.roleType = scope.teamRoleType;
		current.roleKind = 'lead';
		return current;
	}
	const workflow: TeamRoleWorkflowState = {
		taskId: scope.teamTaskId,
		expertId: scope.teamExpertId,
		expertName: scope.teamExpertName,
		roleType: scope.teamRoleType,
		roleKind: 'lead',
		streaming: '',
		streamingThinking: '',
		liveBlocks: createEmptyLiveAgentBlocks(),
		messages: [],
		lastTurnUsage: null,
		awaitingReply: true,
		lastUpdatedAt: Date.now(),
	};
	session.leaderWorkflow = workflow;
	return workflow;
}

function mutateRoleWorkflowPayload(
	session: TeamSessionState,
	payload: ChatStreamPayload,
	scope: TeamRoleScope
): boolean {
	const isLead = scope.teamRoleKind === 'lead';
	const workflow = isLead
		? ensureLeaderWorkflow(session, scope)
		: ensureRoleWorkflow(session.roleWorkflowByTaskId, scope);
	if (!isLead && !session.selectedTaskId) {
		session.selectedTaskId = scope.teamTaskId;
	}
	if (scope.teamRoleKind === 'reviewer') {
		session.reviewerTaskId = scope.teamTaskId;
	}

	switch (payload.type) {
		case 'delta':
			workflow.streaming += payload.text;
			workflow.liveBlocks = applyLiveAgentChatPayload(workflow.liveBlocks, {
				type: 'delta',
				text: payload.text,
			});
			workflow.awaitingReply = true;
			workflow.lastUpdatedAt = Date.now();
			return false;
		case 'thinking_delta':
			workflow.streamingThinking += payload.text;
			workflow.liveBlocks = applyLiveAgentChatPayload(workflow.liveBlocks, {
				type: 'thinking_delta',
				text: payload.text,
			});
			workflow.awaitingReply = true;
			workflow.lastUpdatedAt = Date.now();
			return false;
		case 'tool_input_delta':
			workflow.liveBlocks = applyLiveAgentChatPayload(workflow.liveBlocks, {
				type: 'tool_input_delta',
				name: payload.name,
				partialJson: payload.partialJson,
				index: payload.index,
			});
			workflow.awaitingReply = true;
			workflow.lastUpdatedAt = Date.now();
			return false;
		case 'tool_progress':
			workflow.liveBlocks = applyLiveAgentChatPayload(workflow.liveBlocks, {
				type: 'tool_progress',
				name: payload.name,
				phase: payload.phase,
				detail: payload.detail,
			});
			workflow.awaitingReply = true;
			workflow.lastUpdatedAt = Date.now();
			return true;
		case 'tool_call':
			workflow.liveBlocks = applyLiveAgentChatPayload(workflow.liveBlocks, {
				type: 'tool_call',
				name: payload.name,
				args: payload.args,
				toolCallId: payload.toolCallId,
			});
			workflow.awaitingReply = true;
			workflow.lastUpdatedAt = Date.now();
			return true;
		case 'tool_result':
			workflow.liveBlocks = applyLiveAgentChatPayload(workflow.liveBlocks, {
				type: 'tool_result',
				name: payload.name,
				result: payload.result,
				success: payload.success,
				toolCallId: payload.toolCallId,
			});
			workflow.awaitingReply = true;
			workflow.lastUpdatedAt = Date.now();
			return true;
		case 'done': {
			const leaderNarrative = isLead ? extractTeamLeadNarrative(payload.text) : '';
			const nextMessage: ChatMessage = {
				role: 'assistant',
				content: isLead ? leaderNarrative || session.leaderMessage || payload.text : payload.text,
			};
			const lastMessage = workflow.messages[workflow.messages.length - 1];
			if (!(lastMessage?.role === nextMessage.role && lastMessage?.content === nextMessage.content)) {
				workflow.messages = [...workflow.messages, nextMessage];
			}
			workflow.streaming = '';
			workflow.streamingThinking = '';
			workflow.liveBlocks = createEmptyLiveAgentBlocks();
			workflow.lastTurnUsage = payload.usage ?? workflow.lastTurnUsage;
			workflow.awaitingReply = false;
			workflow.lastUpdatedAt = Date.now();
			if (isLead) {
				session.leaderMessage = nextMessage.content;
			}
			return true;
		}
		case 'error': {
			const nextMessage: ChatMessage = { role: 'assistant', content: `Error: ${payload.message}` };
			const lastMessage = workflow.messages[workflow.messages.length - 1];
			if (!(lastMessage?.role === nextMessage.role && lastMessage?.content === nextMessage.content)) {
				workflow.messages = [...workflow.messages, nextMessage];
			}
			workflow.streaming = '';
			workflow.streamingThinking = '';
			workflow.liveBlocks = createEmptyLiveAgentBlocks();
			workflow.awaitingReply = false;
			workflow.lastUpdatedAt = Date.now();
			if (isLead) {
				session.leaderMessage = nextMessage.content;
			}
			return true;
		}
		default:
			return false;
	}
}

function upsertTask(tasks: TeamTask[], nextTask: TeamTask): TeamTask[] {
	const index = tasks.findIndex((task) => task.id === nextTask.id);
	if (index < 0) {
		return [...tasks, nextTask];
	}
	const copy = [...tasks];
	copy[index] = { ...copy[index]!, ...nextTask };
	return copy;
}

function clampLogs(logs: string[], entry: string): string[] {
	if (!entry) {
		return logs;
	}
	if (logs.length >= MAX_TASK_LOGS) {
		const next = logs.slice(-(MAX_TASK_LOGS - 1));
		next.push(entry);
		return next;
	}
	return [...logs, entry];
}

function snapshotSession(session: TeamSessionState): TeamSessionState {
	const roleWorkflowByTaskId: Record<string, TeamRoleWorkflowState> = {};
	for (const [taskId, workflow] of Object.entries(session.roleWorkflowByTaskId)) {
		roleWorkflowByTaskId[taskId] = {
			...workflow,
			messages: workflow.messages.map((message) => ({ ...message })),
			liveBlocks: {
				blocks: workflow.liveBlocks.blocks.map((block) => ({ ...block })),
			},
		};
	}
	return {
		...session,
		tasks: session.tasks.map((task) => ({ ...task })),
		leaderWorkflow: session.leaderWorkflow
			? {
					...session.leaderWorkflow,
					messages: session.leaderWorkflow.messages.map((message) => ({ ...message })),
					liveBlocks: {
						blocks: session.leaderWorkflow.liveBlocks.blocks.map((block) => ({ ...block })),
					},
				}
			: null,
		planProposal: session.planProposal
			? { ...session.planProposal, tasks: session.planProposal.tasks.map((t) => ({ ...t })) }
			: null,
		roleWorkflowByTaskId,
	};
}

export function useTeamSession() {
	const [sessionsByThread, setSessionsByThread] = useState<Record<string, TeamSessionState>>({});

	const sessionsRef = useRef<Record<string, TeamSessionState>>({});
	const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dirtyThreadsRef = useRef<Set<string>>(new Set());

	const flushDirty = useCallback(() => {
		flushTimerRef.current = null;
		const dirty = dirtyThreadsRef.current;
		if (dirty.size === 0) {
			return;
		}
		const threadIds = [...dirty];
		dirty.clear();
		setSessionsByThread((prev) => {
			const next = { ...prev };
			for (const threadId of threadIds) {
				const live = sessionsRef.current[threadId];
				if (live) {
					next[threadId] = snapshotSession(live);
				} else {
					delete next[threadId];
				}
			}
			return next;
		});
	}, []);

	const scheduleFlush = useCallback(
		(threadId: string, immediate: boolean) => {
			dirtyThreadsRef.current.add(threadId);
			if (immediate) {
				if (flushTimerRef.current) {
					clearTimeout(flushTimerRef.current);
					flushTimerRef.current = null;
				}
				flushDirty();
			} else if (!flushTimerRef.current) {
				flushTimerRef.current = setTimeout(flushDirty, FLUSH_INTERVAL_MS);
			}
		},
		[flushDirty]
	);

	useEffect(() => {
		return () => {
			if (flushTimerRef.current) {
				clearTimeout(flushTimerRef.current);
				flushTimerRef.current = null;
			}
		};
	}, []);

	const applyTeamPayload = useCallback(
		(payload: ChatStreamPayload) => {
			if (!payload.threadId) {
				return;
			}
			const threadId = payload.threadId;

			if (!sessionsRef.current[threadId]) {
				sessionsRef.current[threadId] = emptySession();
			}
			const session = sessionsRef.current[threadId]!;

			if ('teamRoleScope' in payload && payload.teamRoleScope) {
				const needFlush = mutateRoleWorkflowPayload(session, payload, payload.teamRoleScope);
				session.updatedAt = Date.now();
				scheduleFlush(threadId, needFlush);
				return;
			}

			if (!String(payload.type).startsWith('team_')) {
				return;
			}

			let needFlush = true;
			switch (payload.type) {
				case 'team_phase':
					session.phase = payload.phase;
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
					session.tasks = upsertTask(session.tasks, created);
					if (!session.selectedTaskId) {
						session.selectedTaskId = created.id;
					}
					break;
				}
				case 'team_expert_started': {
					if (!session.selectedTaskId) {
						session.selectedTaskId = payload.taskId;
					}
					const task = session.tasks.find((candidate) => candidate.id === payload.taskId);
					if (task) {
						task.status = 'in_progress';
						task.logs = clampLogs(task.logs, 'Started');
					}
					break;
				}
				case 'team_expert_progress': {
					const detail = payload.message ?? payload.delta ?? '';
					const task = session.tasks.find((candidate) => candidate.id === payload.taskId);
					if (task && detail) {
						task.logs = clampLogs(task.logs, detail);
					}
					needFlush = false;
					break;
				}
				case 'team_expert_done': {
					const task = session.tasks.find((candidate) => candidate.id === payload.taskId);
					if (task) {
						task.status = payload.success ? 'completed' : 'failed';
						task.result = payload.result;
						if (payload.result) {
							task.logs = clampLogs(task.logs, payload.result);
						}
					}
					break;
				}
				case 'team_plan_summary':
					session.planSummary = payload.summary;
					session.leaderMessage = extractTeamLeadNarrative(payload.summary) || session.leaderMessage;
					break;
				case 'team_review':
					session.reviewVerdict = payload.verdict;
					session.reviewSummary = normalizeTeamSummary(payload.summary);
					break;
				case 'team_preflight_review':
					session.preflightVerdict = payload.verdict;
					session.preflightSummary = normalizeTeamSummary(payload.summary);
					break;
				case 'team_plan_proposed':
					session.planProposal = {
						proposalId: payload.proposalId,
						summary: payload.summary,
						tasks: payload.tasks.map((t) => ({
							expert: t.expert,
							expertName: t.expertName,
							roleType: (t.roleType as TeamRoleType) || 'custom',
							task: t.task,
							dependencies: t.dependencies ?? [],
							acceptanceCriteria: t.acceptanceCriteria ?? [],
						})),
						preflightSummary: payload.preflightSummary
							? normalizeTeamSummary(payload.preflightSummary)
							: undefined,
						preflightVerdict: payload.preflightVerdict,
						awaitingApproval: true,
					};
					break;
				case 'team_plan_decision':
					if (session.planProposal && session.planProposal.proposalId === payload.proposalId) {
						session.planProposal = {
							...session.planProposal,
							awaitingApproval: false,
							decision: payload.approved ? 'approved' : 'rejected',
						};
					}
					break;
				default:
					return;
			}

			session.updatedAt = Date.now();
			scheduleFlush(threadId, needFlush);
		},
		[scheduleFlush]
	);

	const startTeamSession = useCallback((threadId: string, userRequest: string) => {
		const session = emptySession();
		session.originalUserRequest = userRequest;
		session.updatedAt = Date.now();
		sessionsRef.current[threadId] = session;
		setSessionsByThread((prev) => ({
			...prev,
			[threadId]: snapshotSession(session),
		}));
	}, []);

	const setSelectedTask = useCallback((threadId: string, taskId: string | null) => {
		const session = sessionsRef.current[threadId];
		if (session) {
			session.selectedTaskId = taskId;
			session.updatedAt = Date.now();
		}
		setSessionsByThread((prev) => {
			const current = prev[threadId] ?? emptySession();
			return {
				...prev,
				[threadId]: { ...current, selectedTaskId: taskId, updatedAt: Date.now() },
			};
		});
	}, []);

	const abortTeamSession = useCallback(
		(threadId: string) => {
			const session = sessionsRef.current[threadId];
			if (!session) {
				return;
			}
			let changed = false;
			for (const task of session.tasks) {
				if (task.status === 'in_progress' || task.status === 'pending') {
					task.status = 'failed';
					if (!task.result) {
						task.result = 'Aborted by user.';
					}
					changed = true;
				}
			}
			for (const workflow of Object.values(session.roleWorkflowByTaskId)) {
				if (workflow.awaitingReply) {
					workflow.awaitingReply = false;
					workflow.streaming = '';
					workflow.streamingThinking = '';
					workflow.liveBlocks = createEmptyLiveAgentBlocks();
					changed = true;
				}
			}
			if (session.leaderWorkflow?.awaitingReply) {
				session.leaderWorkflow.awaitingReply = false;
				session.leaderWorkflow.streaming = '';
				session.leaderWorkflow.streamingThinking = '';
				session.leaderWorkflow.liveBlocks = createEmptyLiveAgentBlocks();
				changed = true;
			}
			if (session.planProposal?.awaitingApproval) {
				session.planProposal = {
					...session.planProposal,
					awaitingApproval: false,
					decision: 'rejected',
				};
				changed = true;
			}
			if (changed) {
				session.updatedAt = Date.now();
				scheduleFlush(threadId, true);
			}
		},
		[scheduleFlush]
	);

	const markTeamPlanProposalDecided = useCallback(
		(threadId: string, proposalId: string, approved: boolean) => {
			const session = sessionsRef.current[threadId];
			if (!session?.planProposal) return;
			if (session.planProposal.proposalId !== proposalId) return;
			session.planProposal = {
				...session.planProposal,
				awaitingApproval: false,
				decision: approved ? 'approved' : 'rejected',
			};
			session.updatedAt = Date.now();
			scheduleFlush(threadId, true);
		},
		[scheduleFlush]
	);

	const clearTeamSession = useCallback((threadId: string) => {
		if (flushTimerRef.current) {
			clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		dirtyThreadsRef.current.delete(threadId);
		delete sessionsRef.current[threadId];
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

	const restoreTeamSession = useCallback(
		(threadId: string, snapshot: TeamSessionSnapshot) => {
			if (sessionsRef.current[threadId]) {
				return;
			}
			const session: TeamSessionState = {
				phase: snapshot.phase,
				tasks: snapshot.tasks.map((t) => ({
					id: t.id,
					expertId: t.expertId,
					expertAssignmentKey: t.expertAssignmentKey,
					expertName: t.expertName,
					roleType: (t.roleType as TeamRoleType) || 'custom',
					description: t.description,
					status: (t.status as TeamTaskStatus) || 'completed',
					dependencies: t.dependencies,
					acceptanceCriteria: t.acceptanceCriteria ?? [],
					result: t.result,
					logs: t.result ? [t.result] : [],
				})),
				originalUserRequest: '',
				leaderMessage: snapshot.leaderMessage,
				leaderWorkflow: null,
				planSummary: snapshot.planSummary,
				reviewSummary: normalizeTeamSummary(snapshot.reviewSummary),
				reviewVerdict: snapshot.reviewVerdict,
				preflightSummary: '',
				preflightVerdict: null,
				planProposal: null,
				selectedTaskId: snapshot.tasks[0]?.id ?? null,
				reviewerTaskId: null,
				roleWorkflowByTaskId: {},
				updatedAt: Date.now(),
			};
			sessionsRef.current[threadId] = session;
			setSessionsByThread((prev) => ({
				...prev,
				[threadId]: snapshotSession(session),
			}));
		},
		[]
	);

	return useMemo(
		() => ({
			sessionsByThread,
			applyTeamPayload,
			startTeamSession,
			setSelectedTask,
			clearTeamSession,
			abortTeamSession,
			getTeamSession,
			restoreTeamSession,
			markTeamPlanProposalDecided,
		}),
		[
			sessionsByThread,
			applyTeamPayload,
			startTeamSession,
			setSelectedTask,
			clearTeamSession,
			abortTeamSession,
			getTeamSession,
			restoreTeamSession,
			markTeamPlanProposalDecided,
		]
	);
}
