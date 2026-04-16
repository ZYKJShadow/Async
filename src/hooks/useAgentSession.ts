import { useCallback, useMemo, useState } from 'react';
import type {
	AgentSessionSnapshot,
	AgentSessionSnapshotAgent,
	AgentUserInputRequest,
} from '../agentSessionTypes';

export type AgentSessionState = {
	agentsById: Record<string, AgentSessionSnapshotAgent>;
	selectedAgentId: string | null;
	pendingUserInput: AgentUserInputRequest | null;
};

function emptyAgentSession(): AgentSessionState {
	return {
		agentsById: {},
		selectedAgentId: null,
		pendingUserInput: null,
	};
}

function normalizeSelectedAgentId(
	current: string | null,
	agentsById: Record<string, AgentSessionSnapshotAgent>
): string | null {
	if (current && agentsById[current]) {
		return current;
	}
	const agents = Object.values(agentsById).sort((a, b) => b.updatedAt - a.updatedAt);
	return agents[0]?.id ?? null;
}

export function useAgentSession() {
	const [sessionsByThread, setSessionsByThread] = useState<Record<string, AgentSessionState>>({});

	const restoreAgentSession = useCallback((threadId: string, snapshot: AgentSessionSnapshot | null | undefined) => {
		const nextAgentsById = snapshot?.agents ?? {};
		setSessionsByThread((prev) => {
			const current = prev[threadId] ?? emptyAgentSession();
			const pendingAgentId =
				snapshot?.pendingUserInput?.agentId && nextAgentsById[snapshot.pendingUserInput.agentId]
					? snapshot.pendingUserInput.agentId
					: null;
			const selectedAgentId = pendingAgentId ?? normalizeSelectedAgentId(current.selectedAgentId, nextAgentsById);
			return {
				...prev,
				[threadId]: {
					agentsById: nextAgentsById,
					selectedAgentId,
					pendingUserInput: snapshot?.pendingUserInput ?? null,
				},
			};
		});
	}, []);

	const clearAgentSession = useCallback((threadId: string) => {
		setSessionsByThread((prev) => {
			if (!prev[threadId]) {
				return prev;
			}
			const next = { ...prev };
			delete next[threadId];
			return next;
		});
	}, []);

	const setSelectedAgent = useCallback((threadId: string, agentId: string | null) => {
		setSessionsByThread((prev) => {
			const current = prev[threadId] ?? emptyAgentSession();
			return {
				...prev,
				[threadId]: {
					...current,
					selectedAgentId: agentId && current.agentsById[agentId] ? agentId : normalizeSelectedAgentId(agentId, current.agentsById),
				},
			};
		});
	}, []);

	const getAgentSession = useCallback(
		(threadId: string | null): AgentSessionState | null => {
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
			restoreAgentSession,
			clearAgentSession,
			setSelectedAgent,
			getAgentSession,
		}),
		[sessionsByThread, restoreAgentSession, clearAgentSession, setSelectedAgent, getAgentSession]
	);
}
