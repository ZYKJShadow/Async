import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import {
	addAnthropicCacheBreakpoints,
	observeAnthropicPromptCacheUsage,
	resetAnthropicPromptCacheTracking,
	type AnthropicCacheBreakpointDecision,
} from './anthropicPromptCache.js';

function countCacheControls(value: unknown): number {
	if (Array.isArray(value)) return value.reduce<number>((sum, child) => sum + countCacheControls(child), 0);
	if (!value || typeof value !== 'object') return 0;
	const record = value as Record<string, unknown>;
	return (record.cache_control ? 1 : 0) + Object.values(record).reduce<number>((sum, child) => sum + countCacheControls(child), 0);
}

function markedMessageIndexes(messages: MessageParam[]): number[] {
	return messages
		.map((message, index) => countCacheControls(message) > 0 ? index : -1)
		.filter((index) => index >= 0);
}

afterEach(() => {
	resetAnthropicPromptCacheTracking();
	vi.restoreAllMocks();
});

describe('addAnthropicCacheBreakpoints', () => {
	it('places one marker on the stable prefix before a volatile user tail', () => {
		let decision: AnthropicCacheBreakpointDecision | undefined;
		const messages: MessageParam[] = [
			{ role: 'user', content: 'first request' },
			{ role: 'assistant', content: 'stable answer' },
			{ role: 'user', content: 'new request that changes every turn' },
		];

		const result = addAnthropicCacheBreakpoints(messages, true, {
			strategy: 'stable-prefix',
			onDecision: (next) => { decision = next; },
		});

		expect(markedMessageIndexes(result)).toEqual([1]);
		expect(decision?.reason).toBe('stable-prefix-before-new-user-tail');
		expect(countCacheControls(result)).toBe(1);
		expect(countCacheControls(messages)).toBe(0);
	});

	it('places one marker before a latest tool_result round', () => {
		let decision: AnthropicCacheBreakpointDecision | undefined;
		const messages: MessageParam[] = [
			{ role: 'user', content: 'inspect files' },
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'I will run a tool.' },
					{ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.ts' } },
				],
			},
			{
				role: 'user',
				content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file contents' }],
			},
		];

		const result = addAnthropicCacheBreakpoints(messages, true, {
			strategy: 'stable-prefix',
			onDecision: (next) => { decision = next; },
		});

		expect(markedMessageIndexes(result)).toEqual([1]);
		expect(decision?.reason).toBe('stable-prefix-before-tool-result');
		expect(countCacheControls(result)).toBe(1);
	});

	it('preserves Claude Code fork semantics for skipCacheWrite', () => {
		let decision: AnthropicCacheBreakpointDecision | undefined;
		const messages: MessageParam[] = [
			{ role: 'user', content: 'one' },
			{ role: 'assistant', content: 'two' },
			{ role: 'user', content: 'three' },
			{ role: 'assistant', content: 'four' },
		];

		const result = addAnthropicCacheBreakpoints(messages, true, {
			skipCacheWrite: true,
			strategy: 'stable-prefix',
			onDecision: (next) => { decision = next; },
		});

		expect(markedMessageIndexes(result)).toEqual([2]);
		expect(decision?.reason).toBe('skip-cache-write-shared-prefix');
		expect(countCacheControls(result)).toBe(1);
	});

	it('removes stale cache markers before applying the current marker', () => {
		const messages: MessageParam[] = [
			{
				role: 'user',
				content: [{ type: 'text', text: 'old', cache_control: { type: 'ephemeral' } }],
			},
			{
				role: 'assistant',
				content: [{ type: 'text', text: 'older', cache_control: { type: 'ephemeral' } }],
			},
			{ role: 'user', content: 'fresh tail' },
		];

		const result = addAnthropicCacheBreakpoints(messages, true, { strategy: 'stable-prefix' });

		expect(markedMessageIndexes(result)).toEqual([1]);
		expect(countCacheControls(result)).toBe(1);
	});

	it('falls back when an assistant tail only contains thinking blocks', () => {
		let decision: AnthropicCacheBreakpointDecision | undefined;
		const messages: MessageParam[] = [
			{ role: 'user', content: 'question' },
			{ role: 'assistant', content: [{ type: 'thinking', thinking: 'hidden', signature: 'sig' }] },
		];

		const result = addAnthropicCacheBreakpoints(messages, true, {
			strategy: 'tail',
			onDecision: (next) => { decision = next; },
		});

		expect(markedMessageIndexes(result)).toEqual([0]);
		expect(decision?.reason).toBe('fallback-marker-eligible-message');
		expect(countCacheControls(result)).toBe(1);
	});
});

describe('observeAnthropicPromptCacheUsage', () => {
	it('warns when cache read tokens drop sharply on a stable signature', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const decision: AnthropicCacheBreakpointDecision = {
			enabled: true,
			strategy: 'stable-prefix',
			messageCount: 3,
			markerIndex: 1,
			markerRole: 'assistant',
			reason: 'stable-prefix-before-new-user-tail',
			volatileTailMessages: 1,
		};

		observeAnthropicPromptCacheUsage({
			source: 'agent:test',
			model: 'claude-sonnet',
			usage: { cacheReadTokens: 20_000, cacheWriteTokens: 500 },
			decision,
			system: 'system',
			toolNames: ['Read', 'Write'],
		});
		observeAnthropicPromptCacheUsage({
			source: 'agent:test',
			model: 'claude-sonnet',
			usage: { cacheReadTokens: 12_000, cacheWriteTokens: 8_000 },
			decision,
			system: 'system',
			toolNames: ['Write', 'Read'],
		});

		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0]?.[0])).toContain('cache read dropped');
		expect(String(warn.mock.calls[0]?.[0])).toContain('signatureChanged=false');
	});
});
