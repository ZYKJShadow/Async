import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from './threadStore.js';
import {
	clearSummaryCacheForTests,
	pruneSummaryCache,
	summarizeThreadForSidebar,
} from './threadListSummary.js';

function thread(messages: ChatMessage[], options?: { id?: string; updatedAt?: number }) {
	return {
		id: options?.id ?? 'thread-1',
		updatedAt: options?.updatedAt ?? 1,
		messages,
	};
}

function diffAssistant(addedLine: string): ChatMessage {
	return {
		role: 'assistant',
		content: [
			'Done.',
			'```diff',
			'diff --git a/file.txt b/file.txt',
			'--- a/file.txt',
			'+++ b/file.txt',
			'@@ -1 +1 @@',
			'-old',
			`+${addedLine}`,
			'```',
		].join('\n'),
	};
}

describe('summarizeThreadForSidebar', () => {
	beforeEach(() => {
		clearSummaryCacheForTests();
	});

	it('reuses the cached summary when only updatedAt changes', () => {
		const messages: ChatMessage[] = [
			{ role: 'system', content: 'hidden' },
			{ role: 'user', content: 'Please edit file.txt' },
			diffAssistant('new'),
		];

		const first = summarizeThreadForSidebar(thread(messages, { updatedAt: 1 }), 'D:/work/a');
		const second = summarizeThreadForSidebar(thread(messages, { updatedAt: 2 }), 'D:/work/a');

		expect(second).toBe(first);
		expect(second.previewCount).toBe(2);
		expect(second.hasUserMessages).toBe(true);
	});

	it('invalidates the cache when the assistant diff changes without updatedAt changing', () => {
		const first = summarizeThreadForSidebar(
			thread([
				{ role: 'user', content: 'Please edit file.txt' },
				diffAssistant('new'),
			]),
			'D:/work/a'
		);
		const second = summarizeThreadForSidebar(
			thread([
				{ role: 'user', content: 'Please edit file.txt' },
				diffAssistant('newer'),
			]),
			'D:/work/a'
		);

		expect(second).not.toBe(first);
		expect(second.hasAgentDiff).toBe(true);
		expect(second.filePaths).toEqual(['file.txt']);
	});

	it('prunes only the requested workspace cache', () => {
		const messages: ChatMessage[] = [
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi' },
		];
		const wsA = 'D:/work/a';
		const wsB = 'D:/work/b';

		const firstA = summarizeThreadForSidebar(thread(messages), wsA);
		const firstB = summarizeThreadForSidebar(thread(messages), wsB);
		pruneSummaryCache(new Set(), wsA);

		const secondA = summarizeThreadForSidebar(thread(messages), wsA);
		const secondB = summarizeThreadForSidebar(thread(messages), wsB);

		expect(secondA).not.toBe(firstA);
		expect(secondB).toBe(firstB);
	});
});
