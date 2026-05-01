import type { AgentLifecycleStatus, AgentSessionSnapshotAgent } from './agentSessionTypes';
import type { ChatMessage } from './threadTypes';
import type { TFunction } from './i18n';

function normalizeReplyContent(content: string): string {
	return content.replace(/\r\n?/g, '\n').trim();
}

function latestAssistantReply(agent: AgentSessionSnapshotAgent): string | null {
	for (let i = agent.messages.length - 1; i >= 0; i--) {
		const message = agent.messages[i];
		if (message?.role !== 'assistant') {
			continue;
		}
		const normalized = normalizeReplyContent(message.content);
		if (normalized) {
			return normalized;
		}
	}
	return null;
}

function lastUserMessageIndex(messages: readonly ChatMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.role === 'user') {
			return i;
		}
	}
	return -1;
}

export function filterDuplicateSubAgentReplies(
	messages: readonly ChatMessage[],
	agentsById: Record<string, AgentSessionSnapshotAgent> | null | undefined
): ChatMessage[] {
	const agents = Object.values(agentsById ?? {});
	if (agents.length === 0 || messages.length === 0) {
		return messages as ChatMessage[];
	}
	const hiddenReplies = new Set<string>();
	for (const agent of agents) {
		const reply = latestAssistantReply(agent);
		if (reply) {
			hiddenReplies.add(reply);
		}
	}
	if (hiddenReplies.size === 0) {
		return messages as ChatMessage[];
	}
	const latestUserIndex = lastUserMessageIndex(messages);
	let changed = false;
	const filtered = messages.filter((message, index) => {
		if (index <= latestUserIndex || message.role !== 'assistant') {
			return true;
		}
		const normalized = normalizeReplyContent(message.content);
		if (normalized && hiddenReplies.has(normalized)) {
			changed = true;
			return false;
		}
		return true;
	});
	return changed ? filtered : messages as ChatMessage[];
}

export function subAgentCardBodyLabel(t: TFunction, status: AgentLifecycleStatus): string {
	switch (status) {
		case 'running':
			return t('agent.session.card.running');
		case 'waiting_input':
			return t('agent.session.card.waiting');
		case 'completed':
			return t('agent.session.card.completed');
		case 'failed':
			return t('agent.session.card.failed');
		case 'closed':
			return t('agent.session.card.closed');
		default:
			return t('agent.session.card.default');
	}
}
