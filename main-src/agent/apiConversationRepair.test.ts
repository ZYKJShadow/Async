import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { repairAnthropicToolPairing, repairOpenAIToolPairing } from './apiConversationRepair.js';

describe('repairOpenAIToolPairing', () => {
	it('drops leading orphan tool messages', () => {
		const msgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{ role: 'system', content: 'sys' },
			{ role: 'tool', tool_call_id: 'x', content: 'orphan' },
			{ role: 'user', content: 'hi' },
		];
		const out = repairOpenAIToolPairing(msgs);
		expect(out.map((m) => m.role)).toEqual(['system', 'user']);
	});

	it('synthesizes missing tool responses after assistant tool_calls', () => {
		const msgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{
				role: 'assistant',
				content: null,
				tool_calls: [
					{ id: 'a', type: 'function', function: { name: 'fn', arguments: '{}' } },
					{ id: 'b', type: 'function', function: { name: 'fn2', arguments: '{}' } },
				],
			},
			{ role: 'tool', tool_call_id: 'a', content: 'ok' },
		];
		const out = repairOpenAIToolPairing(msgs);
		expect(out).toHaveLength(3);
		expect(out[1]).toMatchObject({ role: 'tool', tool_call_id: 'a' });
		expect(out[2]).toMatchObject({ role: 'tool', tool_call_id: 'b' });
		expect(String((out[2] as { content?: unknown }).content)).toContain('pairing repair');
	});
});

describe('repairAnthropicToolPairing', () => {
	it('adds user tool_result block when missing after tool_use', () => {
		const msgs: MessageParam[] = [
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 't' },
					{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.ts' } },
				],
			},
		];
		const out = repairAnthropicToolPairing(msgs);
		expect(out).toHaveLength(2);
		expect(out[1]!.role).toBe('user');
		const c = out[1]!.content;
		expect(Array.isArray(c)).toBe(true);
		const arr = c as { type: string; tool_use_id?: string; is_error?: boolean }[];
		expect(arr.some((b) => b.type === 'tool_result' && b.tool_use_id === 'tu_1')).toBe(true);
	});

	it('strips orphan user message that is only tool_results without preceding assistant', () => {
		const msgs: MessageParam[] = [
			{
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'ghost',
						content: 'x',
						is_error: false,
					},
				],
			},
			{ role: 'user', content: 'real question' },
		];
		const out = repairAnthropicToolPairing(msgs);
		expect(out).toHaveLength(2);
		expect(out[0]!.role).toBe('user');
		expect(Array.isArray(out[0]!.content)).toBe(true);
		expect(out[1]).toMatchObject({ role: 'user', content: 'real question' });
	});
});

describe('repairOpenAIToolPairing cross-message dedupe', () => {
	it('strips duplicate tool_call id in a later assistant (CC-1212)', () => {
		const msgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{
				role: 'assistant',
				content: null,
				tool_calls: [{ id: 'dup', type: 'function', function: { name: 'Read', arguments: '{}' } }],
			},
			{ role: 'tool', tool_call_id: 'dup', content: 'ok' },
			{
				role: 'assistant',
				content: null,
				tool_calls: [{ id: 'dup', type: 'function', function: { name: 'Read', arguments: '{}' } }],
			},
		];
		const out = repairOpenAIToolPairing(msgs);
		const secondAssist = out.find(
			(m, i) => m.role === 'assistant' && i > 1
		) as OpenAI.Chat.ChatCompletionAssistantMessageParam | undefined;
		expect(secondAssist?.tool_calls?.length ?? 0).toBe(0);
	});
});
