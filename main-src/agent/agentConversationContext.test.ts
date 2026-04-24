import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import {
	type AgentContextCompactState,
	compactAnthropicConversationForContext,
	compactOpenAIConversationForContext,
} from './agentConversationContext.js';

const large = (label: string) => `${label} ${'x'.repeat(5000)}`;

describe('compactOpenAIConversationForContext', () => {
	it('compacts old API rounds and preserves recent tool call pairs', async () => {
		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{ role: 'system', content: 'system prompt' },
		];
		for (let i = 0; i < 10; i++) {
			messages.push({ role: 'user', content: large(`user ${i}`) });
			messages.push({
				role: 'assistant',
				content: null,
				tool_calls: [{ id: `call_${i}`, type: 'function', function: { name: 'Shell', arguments: '{}' } }],
			});
			messages.push({ role: 'tool', tool_call_id: `call_${i}`, content: large(`result ${i}`) });
		}

		let savedState: AgentContextCompactState | undefined;
		const result = await compactOpenAIConversationForContext(messages, {
			model: 'test-model',
			apiKey: '',
			contextWindowTokens: 12_000,
			maxOutputTokens: 1_000,
			state: { failureCount: 3 },
			onStateChange: (state) => { savedState = state; },
			signal: new AbortController().signal,
		});

		expect(result.changed).toBe(true);
		expect(result.messages[0]).toMatchObject({ role: 'system' });
		expect(result.messages[1]).toMatchObject({ role: 'user' });
		expect(result.mode).toBe('fallback');
		expect(String((result.messages[1] as { content?: unknown }).content)).toContain('Conversation summary');
		expect(result.messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call_9')).toBe(true);
		expect(result.messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call_0')).toBe(false);
		expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore);
		expect(savedState?.lastSummary).toContain('Conversation summary');
	});
});

describe('compactAnthropicConversationForContext', () => {
	it('compacts old rounds without leaving orphan tool_result blocks', async () => {
		const messages: MessageParam[] = [];
		for (let i = 0; i < 10; i++) {
			messages.push({ role: 'user', content: [{ type: 'text', text: large(`user ${i}`) }] });
			messages.push({
				role: 'assistant',
				content: [{ type: 'tool_use', id: `tu_${i}`, name: 'Read', input: { file_path: `f${i}.ts` } }],
			});
			messages.push({
				role: 'user',
				content: [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: large(`result ${i}`) }],
			});
		}

		const result = await compactAnthropicConversationForContext(messages, {
			model: 'test-model',
			apiKey: '',
			contextWindowTokens: 12_000,
			maxOutputTokens: 1_000,
			state: { failureCount: 3 },
			signal: new AbortController().signal,
		});

		expect(result.changed).toBe(true);
		expect(result.messages[0]?.role).toBe('user');
		expect(JSON.stringify(result.messages[0]?.content)).toContain('Conversation summary');
		const liveMessages = JSON.stringify(result.messages.slice(1));
		expect(liveMessages).toContain('tu_9');
		expect(liveMessages).not.toContain('tu_0');
		expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore);
	});

	it('microcompacts old tool results before summarizing when enough', async () => {
		const messages: MessageParam[] = [];
		for (let i = 0; i < 14; i++) {
			messages.push({ role: 'user', content: [{ type: 'text', text: `user ${i}` }] });
			messages.push({
				role: 'assistant',
				content: [{ type: 'tool_use', id: `tu_${i}`, name: 'Read', input: { file_path: `f${i}.ts` } }],
			});
			messages.push({
				role: 'user',
				content: [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: i < 8 ? large(`huge result ${i}`) : `small result ${i}` }],
			});
		}

		const result = await compactAnthropicConversationForContext(messages, {
			model: 'test-model',
			apiKey: '',
			contextWindowTokens: 23_000,
			maxOutputTokens: 1_000,
			state: { failureCount: 3 },
			signal: new AbortController().signal,
		});

		expect(result.changed).toBe(true);
		expect(result.mode).toBe('microcompact');
		expect(result.clearedToolResults).toBeGreaterThan(0);
		expect(JSON.stringify(result.messages)).toContain('Old tool result content cleared');
	});
});
