import { useCallback, useMemo, useState } from 'react';
import type { ChatStreamPayload } from '../ipcTypes';

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

export type TeamSessionState = {
	phase: TeamSessionPhase;
	tasks: TeamTask[];
	planSummary: string;
	reviewSummary: string;
	reviewVerdict: 'approved' | 'revision_needed' | null;
	selectedExpertId: string | null;
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
		selectedExpertId: null,
		userInputRequest: null,
		updatedAt: Date.now(),
	};
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
		if (!payload.threadId || !String(payload.type).startsWith('team_')) {
			return;
		}
		const threadId = payload.threadId;
		setSessionsByThread((prev) => {
			const session = prev[threadId] ?? emptySession();
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
					next = { ...session, tasks: upsertTask(session.tasks, created) };
					break;
				}
				case 'team_expert_started': {
					next = {
						...session,
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

	const setSelectedExpert = useCallback((threadId: string, expertId: string | null) => {
		setSessionsByThread((prev) => {
			const cur = prev[threadId] ?? emptySession();
			return {
				...prev,
				[threadId]: { ...cur, selectedExpertId: expertId, updatedAt: Date.now() },
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
			setSelectedExpert,
			clearTeamSession,
			getTeamSession,
		}),
		[sessionsByThread, applyTeamPayload, setSelectedExpert, clearTeamSession, getTeamSession]
	);
}
