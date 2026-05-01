import { describe, expect, it } from 'vitest';
import type { AgentSessionSnapshotAgent } from './agentSessionTypes';
import { filterDuplicateSubAgentReplies } from './subAgentChatProjection';
import type { ChatMessage } from './threadTypes';

function agent(overrides: Partial<AgentSessionSnapshotAgent>): AgentSessionSnapshotAgent {
	return {
		id: 'agent-1',
		parentAgentId: null,
		parentToolCallId: 'tool-1',
		title: 'Investigate',
		runProfile: 'explore',
		background: true,
		status: 'completed',
		lastInputSummary: '',
		lastOutputSummary: '',
		lastResultSummary: '',
		transcriptPath: null,
		startedAt: 1,
		updatedAt: 2,
		closedAt: null,
		contextMode: 'none',
		contextTurns: null,
		childAgentIds: [],
		lastError: null,
		messages: [],
		...overrides,
	};
}

describe('sub-agent chat projection', () => {
	it('removes a latest-turn assistant bubble that duplicates a sub-agent reply', () => {
		const messages: ChatMessage[] = [
			{ role: 'user', content: 'please investigate' },
			{ role: 'assistant', content: 'same answer' },
		];
		const filtered = filterDuplicateSubAgentReplies(messages, {
			'agent-1': agent({
				messages: [
					{ role: 'user', content: 'task' },
					{ role: 'assistant', content: 'same answer' },
				],
			}),
		});

		expect(filtered).toEqual([{ role: 'user', content: 'please investigate' }]);
	});

	it('keeps older matching assistant messages from previous turns', () => {
		const messages: ChatMessage[] = [
			{ role: 'user', content: 'old' },
			{ role: 'assistant', content: 'same answer' },
			{ role: 'user', content: 'new' },
			{ role: 'assistant', content: 'different answer' },
		];
		const filtered = filterDuplicateSubAgentReplies(messages, {
			'agent-1': agent({
				messages: [
					{ role: 'user', content: 'task' },
					{ role: 'assistant', content: 'same answer' },
				],
			}),
		});

		expect(filtered).toBe(messages);
	});
});
