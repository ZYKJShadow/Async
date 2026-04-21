import type {
	TeamPlanProposalState,
	TeamPlanRevisionState,
	TeamSessionState,
	TeamTimelineEntry,
} from './hooks/useTeamSession';
import type { ChatMessage } from './threadTypes';
import type { TeamWorkflowListItem } from './teamWorkflowItems';
import { buildTeamWorkflowItems } from './teamWorkflowItems';
import { extractTeamLeadNarrative } from './teamWorkflowText';

function normalizeLeaderText(text: string): string {
	return extractTeamLeadNarrative(text) || String(text ?? '').trim();
}

export function normalizeTeamLeaderText(text: string): string {
	return normalizeLeaderText(text);
}

export function shouldHideTeamPlanProposalSummary(
	proposal: TeamPlanProposalState | null,
	seenLeaderTexts: Set<string>
): boolean {
	if (!proposal) {
		return false;
	}
	const summary = normalizeLeaderText(proposal.summary);
	if (!summary) {
		return true;
	}
	return seenLeaderTexts.has(summary);
}

export type TeamConversationTimelineEntry =
	| {
			id: string;
			kind: 'leader_message';
			content: string;
	  }
	| {
			id: string;
			kind: 'plan_proposal';
			proposal: TeamPlanProposalState;
			hideSummary: boolean;
	  }
	| {
			id: string;
			kind: 'plan_revision';
			revision: TeamPlanRevisionState;
	  }
	| {
			id: string;
			kind: 'task_card';
			item: TeamWorkflowListItem;
	  };

export type TeamConversationTimeline = {
	entries: TeamConversationTimelineEntry[];
	currentLeaderMessage: string;
};

function isLeaderMessageEntry(
	entry: TeamTimelineEntry
): entry is Extract<TeamTimelineEntry, { kind: 'leader_message' }> {
	return entry.kind === 'leader_message';
}

function lastVisibleAssistantContent(displayMessages: ChatMessage[]): string {
	return [...displayMessages].reverse().find((message) => message.role === 'assistant')?.content?.trim() || '';
}

export function buildTeamConversationTimeline(
	session: TeamSessionState | null,
	displayMessages: ChatMessage[]
): TeamConversationTimeline {
	if (!session) {
		return { entries: [], currentLeaderMessage: '' };
	}

	const suppressTaskCardsUntilPlanApproval = Boolean(session.planProposal?.awaitingApproval);
	const workflowItems = suppressTaskCardsUntilPlanApproval ? [] : buildTeamWorkflowItems(session);
	const itemsById = new Map(workflowItems.map((item) => [item.id, item]));
	const seenLeaderTexts = new Set<string>();
	const seenTaskIds = new Set<string>();
	const entries: TeamConversationTimelineEntry[] = [];
	const trailingAssistant = lastVisibleAssistantContent(displayMessages);
	const hideTerminalDuplicate = session.phase === 'delivering' && session.tasks.length === 0;
	let hasPlanProposalEntry = false;
	let seenRevisionIds = new Set<string>();

	const pushLeaderEntry = (id: string, rawContent: string) => {
		const content = normalizeLeaderText(rawContent);
		if (!content) {
			return;
		}
		if (hideTerminalDuplicate && content === trailingAssistant) {
			return;
		}
		if (seenLeaderTexts.has(content)) {
			return;
		}
		seenLeaderTexts.add(content);
		entries.push({
			id,
			kind: 'leader_message',
			content,
		});
	};

	for (const timelineEntry of session.timelineEntries) {
		if (isLeaderMessageEntry(timelineEntry)) {
			pushLeaderEntry(timelineEntry.id, timelineEntry.content);
			continue;
		}
		if (timelineEntry.kind === 'plan_proposal') {
			if (!session.planProposal || session.planProposal.proposalId !== timelineEntry.proposalId) {
				continue;
			}
			entries.push({
				id: timelineEntry.id,
				kind: 'plan_proposal',
				proposal: session.planProposal,
				hideSummary: shouldHideTeamPlanProposalSummary(session.planProposal, seenLeaderTexts),
			});
			hasPlanProposalEntry = true;
			continue;
		}
		if (timelineEntry.kind === 'plan_revision') {
			const revision = session.planRevisions.find((item) => item.revisionId === timelineEntry.revisionId);
			if (!revision || seenRevisionIds.has(revision.revisionId)) {
				continue;
			}
			seenRevisionIds.add(revision.revisionId);
			entries.push({
				id: timelineEntry.id,
				kind: 'plan_revision',
				revision,
			});
			continue;
		}
		if (suppressTaskCardsUntilPlanApproval) {
			continue;
		}
		const item = itemsById.get(timelineEntry.taskId);
		if (!item || seenTaskIds.has(item.id)) {
			continue;
		}
		seenTaskIds.add(item.id);
		entries.push({
			id: timelineEntry.id,
			kind: 'task_card',
			item,
		});
	}

	if (!hasPlanProposalEntry && session.planProposal) {
		entries.push({
			id: `team-plan-proposal-${session.planProposal.proposalId}`,
			kind: 'plan_proposal',
			proposal: session.planProposal,
			hideSummary: shouldHideTeamPlanProposalSummary(session.planProposal, seenLeaderTexts),
		});
	}

	for (const revision of session.planRevisions) {
		if (seenRevisionIds.has(revision.revisionId)) {
			continue;
		}
		seenRevisionIds.add(revision.revisionId);
		entries.push({
			id: `team-plan-revision-${revision.revisionId}`,
			kind: 'plan_revision',
			revision,
		});
	}

	for (const item of workflowItems) {
		if (seenTaskIds.has(item.id)) {
			continue;
		}
		seenTaskIds.add(item.id);
		entries.push({
			id: `team-task-fallback-${item.id}`,
			kind: 'task_card',
			item,
		});
	}

	const hasLeaderEntry = entries.some((entry) => entry.kind === 'leader_message');
	const workflow = session.leaderWorkflow;
	const hasActiveLeaderStream =
		Boolean(workflow?.awaitingReply) ||
		(workflow?.liveBlocks.blocks.length ?? 0) > 0 ||
		Boolean(workflow?.streamingThinking);
	let currentLeaderMessage = normalizeLeaderText(session.leaderMessage);
	if (hideTerminalDuplicate && currentLeaderMessage === trailingAssistant) {
		currentLeaderMessage = '';
	}
	if (currentLeaderMessage && seenLeaderTexts.has(currentLeaderMessage)) {
		currentLeaderMessage = '';
	}
	if (!hasLeaderEntry && currentLeaderMessage && !hasActiveLeaderStream) {
		entries.unshift({
			id: 'team-leader-fallback-current',
			kind: 'leader_message',
			content: currentLeaderMessage,
		});
		currentLeaderMessage = '';
	}

	return {
		entries,
		currentLeaderMessage,
	};
}
