import { describe, expect, it } from 'vitest';

import { createEmptyLiveAgentBlocks } from './liveAgentBlocks';
import { buildTeamWorkflowItems } from './teamWorkflowItems';
import type { TeamSessionState } from './hooks/useTeamSession';

function buildSession(overrides: Partial<TeamSessionState> = {}): TeamSessionState {
	return {
		phase: 'planning',
		tasks: [],
		originalUserRequest: '',
		leaderMessage: '',
		leaderWorkflow: null,
		planSummary: '',
		finalSummary: '',
		reviewSummary: '',
		reviewVerdict: null,
		preflightSummary: '',
		preflightVerdict: null,
		planProposal: null,
		planRevisions: [],
		pendingQuestion: null,
		pendingQuestionRequestId: null,
		pendingUserInput: null,
		selectedTaskId: null,
		reviewerTaskId: null,
		roleWorkflowByTaskId: {},
		timelineEntries: [],
		updatedAt: 0,
		...overrides,
	};
}

describe('buildTeamWorkflowItems', () => {
	it('does not synthesize a reviewer card from summary text alone', () => {
		const items = buildTeamWorkflowItems(
			buildSession({
				tasks: [
					{
						id: 'task-1',
						expertId: 'frontend',
						expertAssignmentKey: 'frontend',
						expertName: 'Frontend',
						roleType: 'frontend',
						description: 'Inspect the chat area',
						status: 'completed',
						dependencies: [],
						acceptanceCriteria: [],
						logs: [],
					},
				],
				reviewSummary: 'All tasks completed successfully.',
				reviewVerdict: 'approved',
				preflightSummary: 'The request looked actionable.',
				preflightVerdict: 'ok',
			})
		);

		expect(items.map((item) => item.roleKind)).toEqual(['specialist']);
	});

	it('keeps the reviewer card when an actual reviewer workflow exists', () => {
		const items = buildTeamWorkflowItems(
			buildSession({
				tasks: [
					{
						id: 'task-1',
						expertId: 'frontend',
						expertAssignmentKey: 'frontend',
						expertName: 'Frontend',
						roleType: 'frontend',
						description: 'Inspect the chat area',
						status: 'completed',
						dependencies: [],
						acceptanceCriteria: [],
						logs: [],
					},
				],
				reviewerTaskId: 'reviewer-reviewer',
				reviewSummary: 'Approved after checking the result.',
				reviewVerdict: 'approved',
				roleWorkflowByTaskId: {
					'reviewer-reviewer': {
						taskId: 'reviewer-reviewer',
						expertId: 'reviewer',
						expertName: 'Reviewer',
						roleType: 'reviewer',
						roleKind: 'reviewer',
						streaming: '',
						streamingThinking: '',
						liveBlocks: createEmptyLiveAgentBlocks(),
						messages: [],
						lastTurnUsage: null,
						awaitingReply: false,
						lastUpdatedAt: 0,
					},
				},
			})
		);

		expect(items.map((item) => item.roleKind)).toEqual(['specialist', 'reviewer']);
	});
});
