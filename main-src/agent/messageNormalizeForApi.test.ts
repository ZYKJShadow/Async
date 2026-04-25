import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import {
	mergeAdjacentAnthropicUserMessages,
	normalizeAnthropicMessagesForApi,
	normalizeOpenAIMessagesForApi,
	stripOrphanAnthropicServerToolUsesInAssistant,
} from './messageNormalizeForApi.js';

describe('mergeAdjacentAnthropicUserMessages', () => {
	it('merges consecutive string users', () => {
		const msgs: MessageParam[] = [
			{ role: 'user', content: 'a' },
			{ role: 'user', content: 'b' },
		];
		const out = mergeAdjacentAnthropicUserMessages(msgs);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ role: 'user' });
		const c = out[0]!.content;
		expect(Array.isArray(c)).toBe(true);
		const arr = c as { type: string; text?: string }[];
		expect(arr[0]!.type).toBe('text');
		expect(arr[0]!.text).toBe('a\n');
		expect(arr[1]!.text).toBe('b');
	});

	it('hoists tool_result before text when merging block users', () => {
		const msgs: MessageParam[] = [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'ctx' },
					{ type: 'tool_result', tool_use_id: 'x', content: 'r', is_error: false },
				],
			},
			{ role: 'user', content: 'more' },
		];
		const out = mergeAdjacentAnthropicUserMessages(msgs);
		expect(out).toHaveLength(1);
		const arr = out[0]!.content as { type: string }[];
		expect(arr[0]!.type).toBe('tool_result');
	});
});

describe('stripOrphanAnthropicServerToolUsesInAssistant', () => {
	it('removes server_tool_use without matching tool_use_id in same message', () => {
		const blocks = [
			{ type: 'server_tool_use' as const, id: 'srv1', name: 'web_search', input: {} },
			{ type: 'text' as const, text: 'hi' },
		] as unknown as import('@anthropic-ai/sdk/resources/messages').ContentBlockParam[];
		const out = stripOrphanAnthropicServerToolUsesInAssistant(blocks);
		expect(out).toHaveLength(1);
		expect((out[0] as { type: string }).type).toBe('text');
	});

	it('keeps server_tool_use when a block references tool_use_id', () => {
		const blocks = [
			{ type: 'server_tool_use' as const, id: 'srv1', name: 'web_search', input: {} },
			{
				type: 'tool_result' as const,
				tool_use_id: 'srv1',
				content: 'done',
				is_error: false,
			},
		] as unknown as import('@anthropic-ai/sdk/resources/messages').ContentBlockParam[];
		const out = stripOrphanAnthropicServerToolUsesInAssistant(blocks);
		expect(out).toHaveLength(2);
	});
});

describe('normalizeAnthropicMessagesForApi', () => {
	it('merges consecutive plain-string assistants', () => {
		const msgs: MessageParam[] = [
			{ role: 'assistant', content: 'part1' },
			{ role: 'assistant', content: 'part2' },
		];
		const out = normalizeAnthropicMessagesForApi(msgs);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ role: 'assistant', content: 'part1\n\npart2' });
	});
});

describe('normalizeOpenAIMessagesForApi', () => {
	it('merges adjacent string users and plain assistants', () => {
		const msgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{ role: 'user', content: 'u1' },
			{ role: 'user', content: 'u2' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'assistant', content: 'a2' },
		];
		const out = normalizeOpenAIMessagesForApi(msgs);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({ role: 'user', content: 'u1\n\nu2' });
		expect(out[1]).toMatchObject({ role: 'assistant', content: 'a1\n\na2' });
	});
});
