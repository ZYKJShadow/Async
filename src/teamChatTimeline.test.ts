import { describe, expect, it } from 'vitest';

import { createEmptyLiveAgentBlocks } from './liveAgentBlocks';
import {
	buildTeamConversationTimeline,
	normalizeTeamLeaderText,
	shouldHideTeamPlanProposalSummary,
} from './teamChatTimeline';
import type { TeamPlanProposalState, TeamSessionState } from './hooks/useTeamSession';

function buildSession(overrides: Partial<TeamSessionState> = {}): TeamSessionState {
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

function buildProposal(summary: string): TeamPlanProposalState {
	return {
		proposalId: 'proposal-1',
		summary,
		tasks: [],
		awaitingApproval: true,
	};
}

describe('teamChatTimeline', () => {
	it('keeps leader kickoff before the delegated task card and keeps a newer leader reply trailing after cards', () => {
		const session = buildSession({
			tasks: [
				{
					id: 'task-1',
					expertId: 'frontend',
					expertName: 'Frontend',
					roleType: 'frontend',
					description: 'Inspect chat timeline rendering',
					status: 'pending',
					dependencies: [],
					acceptanceCriteria: [],
					logs: [],
				},
			],
			leaderMessage: '我已经拿到结果，接下来给你汇总。',
			leaderWorkflow: {
				taskId: 'team-lead',
				expertId: 'lead',
				expertName: 'Leader',
				roleType: 'team_lead',
				roleKind: 'lead',
				streaming: '',
				streamingThinking: '',
				liveBlocks: createEmptyLiveAgentBlocks(),
				messages: [{ role: 'assistant', content: '我先安排前端同学检查聊天区时间线。' }],
				lastTurnUsage: null,
				awaitingReply: false,
				lastUpdatedAt: 0,
			},
			timelineEntries: [
				{ id: 'leader-1', kind: 'leader_message', content: '我先安排前端同学检查聊天区时间线。' },
				{ id: 'task-1', kind: 'task_card', taskId: 'task-1' },
			],
		});

		const timeline = buildTeamConversationTimeline(session, [{ role: 'user', content: '修一下 team 时间线' }]);

		expect(timeline.entries.map((entry) => entry.kind)).toEqual(['leader_message', 'task_card']);
		expect(timeline.currentLeaderMessage).toBe('我已经拿到结果，接下来给你汇总。');
	});

	it('hides the duplicated leader terminal summary when the final assistant message already shows it', () => {
		const session = buildSession({
			phase: 'delivering',
			leaderMessage: '请先明确目标范围，再继续 team 分派。',
			leaderWorkflow: {
				taskId: 'team-lead',
				expertId: 'lead',
				expertName: 'Leader',
				roleType: 'team_lead',
				roleKind: 'lead',
				streaming: '',
				streamingThinking: '',
				liveBlocks: createEmptyLiveAgentBlocks(),
				messages: [{ role: 'assistant', content: '请先明确目标范围，再继续 team 分派。' }],
				lastTurnUsage: null,
				awaitingReply: false,
				lastUpdatedAt: 0,
			},
			timelineEntries: [
				{ id: 'leader-1', kind: 'leader_message', content: '请先明确目标范围，再继续 team 分派。' },
			],
		});

		const timeline = buildTeamConversationTimeline(session, [
			{ role: 'user', content: '优化一下项目' },
			{ role: 'assistant', content: '请先明确目标范围，再继续 team 分派。' },
		]);

		expect(timeline.entries).toEqual([]);
		expect(timeline.currentLeaderMessage).toBe('');
	});

	it('normalizes proposal summaries and hides them when leader text already shows the same content', () => {
		const seenLeaderTexts = new Set(['请先明确你想优化的是性能、代码质量还是用户体验。']);

		expect(
			shouldHideTeamPlanProposalSummary(
				buildProposal('请先明确你想优化的是性能、代码质量还是用户体验。'),
				seenLeaderTexts
			)
		).toBe(true);
		expect(normalizeTeamLeaderText('请先明确你想优化的是性能、代码质量还是用户体验。')).toBe(
			'请先明确你想优化的是性能、代码质量还是用户体验。'
		);
	});
});
