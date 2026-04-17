import { describe, expect, it } from 'vitest';
import {
	budgetStructuredAssistantToolResults,
	dedupeStructuredAssistantToolUseIds,
	extractBotReplyImagePaths,
	extractBotReplyText,
	flattenAssistantTextPartsForSearch,
	formatChatMessageForCompactionSummary,
	isStructuredAssistantMessage,
	parseAgentAssistantPayload,
	stringifyAgentAssistantPayload,
	structuredToLegacyAgentXml,
} from './agentStructuredMessage';

describe('agentStructuredMessage', () => {
	it('roundtrips parse/stringify', () => {
		const payload = {
			_asyncAssistant: 1 as const,
			v: 1 as const,
			parts: [
				{ type: 'text' as const, text: 'Hello\n' },
				{
					type: 'tool' as const,
					toolUseId: 'call_1',
					name: 'Grep',
					args: { pattern: 'foo' },
					result: 'No matches found.',
					success: true,
				},
			],
		};
		const raw = stringifyAgentAssistantPayload(payload);
		expect(isStructuredAssistantMessage(raw)).toBe(true);
		expect(parseAgentAssistantPayload(raw)).toEqual(payload);
	});

	it('structuredToLegacyAgentXml contains tool markers', () => {
		const p = parseAgentAssistantPayload(
			stringifyAgentAssistantPayload({
				_asyncAssistant: 1,
				v: 1,
				parts: [
					{
						type: 'tool',
						toolUseId: 'x',
						name: 'Read',
						args: { file_path: 'a.ts' },
						result: '1|ok',
						success: true,
					},
				],
			})
		)!;
		const xml = structuredToLegacyAgentXml(p);
		expect(xml).toContain('<tool_call tool="Read"');
		expect(xml).toContain('<tool_result tool="Read"');
	});

	it('flattenAssistantTextPartsForSearch ignores tool bodies', () => {
		const raw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{ type: 'text', text: 'Intro\n\n```diff\n+ x\n```' },
				{
					type: 'tool',
					toolUseId: 't',
					name: 'run',
					args: {},
					result: 'out',
					success: true,
				},
			],
		});
		expect(flattenAssistantTextPartsForSearch(raw)).toContain('```diff');
		expect(flattenAssistantTextPartsForSearch(raw)).not.toContain('out');
	});

	it('dedupeStructuredAssistantToolUseIds keeps first tool per id', () => {
		const raw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{
					type: 'tool',
					toolUseId: 'dup',
					name: 'x',
					args: {},
					result: 'first',
					success: true,
				},
				{
					type: 'tool',
					toolUseId: 'dup',
					name: 'x',
					args: {},
					result: 'second',
					success: true,
				},
			],
		});
		const out = dedupeStructuredAssistantToolUseIds(raw);
		const p = parseAgentAssistantPayload(out)!;
		expect(p.parts.filter((x) => x.type === 'tool')).toHaveLength(1);
		expect((p.parts[0] as { result: string }).result).toBe('first');
	});

	it('formatChatMessageForCompactionSummary flattens structured tools', () => {
		const raw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{ type: 'text', text: 'Searching.' },
				{
					type: 'tool',
					toolUseId: 't',
					name: 'grep',
					args: {},
					result: 'No matches found.',
					success: true,
				},
			],
		});
		const line = formatChatMessageForCompactionSummary('assistant', raw, { maxChars: 2000 });
		expect(line).toContain('[ASSISTANT]');
		expect(line).toContain('[tool grep ok]');
		expect(line).not.toContain('_asyncAssistant');
	});

	it('budgetStructuredAssistantToolResults truncates tool result', () => {
		const long = 'x'.repeat(100);
		const raw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [{ type: 'tool', toolUseId: 't', name: 'x', args: {}, result: long, success: true }],
		});
		const b = budgetStructuredAssistantToolResults(raw, 20);
		const p = parseAgentAssistantPayload(b)!;
		expect(p.parts[0]).toMatchObject({ type: 'tool' });
		if (p.parts[0]!.type === 'tool') {
			expect(p.parts[0].result.length).toBeLessThan(long.length);
		}
	});
});

describe('extractBotReplyText', () => {
	it('returns plain text as-is', () => {
		expect(extractBotReplyText('Hello world')).toBe('Hello world');
	});

	it('returns empty string as-is', () => {
		expect(extractBotReplyText('')).toBe('');
	});

	it('extracts text from outer orchestrator payload with no run_async_task', () => {
		const raw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{ type: 'text', text: 'Direct orchestrator reply.' },
			],
		});
		expect(extractBotReplyText(raw)).toBe('Direct orchestrator reply.');
	});

	it('extracts inner task text from nested structured payload', () => {
		const innerPayload = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{ type: 'text', text: 'Here is the answer from the agent.' },
				{
					type: 'tool',
					toolUseId: 'tool_1',
					name: 'Read',
					args: { file_path: 'a.ts' },
					result: '1|ok',
					success: true,
				},
				{ type: 'text', text: '\nAll done!' },
			],
		});
		const outerRaw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{ type: 'text', text: '让我执行任务。' },
				{
					type: 'tool',
					toolUseId: 'call_run',
					name: 'run_async_task',
					args: { task: 'do something' },
					result: `workspace=D:\\Project\nmode=agent\nmodel=model-1\n\n${innerPayload}`,
					success: true,
				},
			],
		});
		const extracted = extractBotReplyText(outerRaw);
		expect(extracted).toBe('Here is the answer from the agent.\nAll done!');
		expect(extracted).not.toContain('_asyncAssistant');
		expect(extracted).not.toContain('让我执行任务');
		expect(extracted).not.toContain('workspace=');
	});

	it('extracts plain text from run_async_task when inner result is not structured', () => {
		const outerRaw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{
					type: 'tool',
					toolUseId: 'call_run',
					name: 'run_async_task',
					args: { task: 'hello' },
					result: 'workspace=(none)\nmode=agent\nmodel=m1\n\nThis is a plain text reply from ask mode.',
					success: true,
				},
			],
		});
		expect(extractBotReplyText(outerRaw)).toBe('This is a plain text reply from ask mode.');
	});

	it('strips metadata prefix correctly with all three lines', () => {
		const outerRaw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{
					type: 'tool',
					toolUseId: 'call_run',
					name: 'run_async_task',
					args: { task: 'test' },
					result: 'workspace=C:\\Work\nmode=agent\nmodel=abc-123\n\nActual content here.',
					success: true,
				},
			],
		});
		expect(extractBotReplyText(outerRaw)).toBe('Actual content here.');
	});

	it('handles run_async_task with no metadata prefix', () => {
		const outerRaw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{
					type: 'tool',
					toolUseId: 'call_run',
					name: 'run_async_task',
					args: { task: 'test' },
					result: 'No prefix, just raw content.',
					success: true,
				},
			],
		});
		expect(extractBotReplyText(outerRaw)).toBe('No prefix, just raw content.');
	});

	it('falls back to outer text when run_async_task result is empty', () => {
		const outerRaw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{ type: 'text', text: 'Orchestrator fallback text.' },
				{
					type: 'tool',
					toolUseId: 'call_run',
					name: 'run_async_task',
					args: { task: 'test' },
					result: 'workspace=(none)\nmode=agent\nmodel=m1\n\n',
					success: true,
				},
			],
		});
		expect(extractBotReplyText(outerRaw)).toBe('Orchestrator fallback text.');
	});

	it('joins multiple run_async_task results', () => {
		const outerRaw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{
					type: 'tool',
					toolUseId: 'call_1',
					name: 'run_async_task',
					args: { task: 'first' },
					result: 'workspace=W\nmode=agent\nmodel=m\n\nFirst result.',
					success: true,
				},
				{
					type: 'tool',
					toolUseId: 'call_2',
					name: 'run_async_task',
					args: { task: 'second' },
					result: 'workspace=W\nmode=agent\nmodel=m\n\nSecond result.',
					success: true,
				},
			],
		});
		const extracted = extractBotReplyText(outerRaw);
		expect(extracted).toContain('First result.');
		expect(extracted).toContain('Second result.');
	});

	it('ignores non-run_async_task tool parts', () => {
		const outerRaw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{ type: 'text', text: 'Main text.' },
				{
					type: 'tool',
					toolUseId: 'call_session',
					name: 'get_async_session',
					args: {},
					result: '{"some":"json"}',
					success: true,
				},
			],
		});
		expect(extractBotReplyText(outerRaw)).toBe('Main text.');
	});

	it('returns a short summary instead of raw JSON for tool-only bot replies', () => {
		const outerRaw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{
					type: 'tool',
					toolUseId: 'call_session',
					name: 'get_async_session',
					args: {},
					result: '{"workspace":"demo"}',
					success: true,
				},
			],
		});
		expect(extractBotReplyText(outerRaw)).toBe('已读取当前 Async 会话信息。');
	});

	it('returns raw input for invalid structured message', () => {
		const malformed = '{"_asyncAssistant":1,"v":1,"parts":"not-an-array"}';
		expect(extractBotReplyText(malformed)).toBe(malformed);
	});

	it('returns empty string when structured message has empty parts', () => {
		const raw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [],
		});
		expect(extractBotReplyText(raw)).toBe('');
	});
});

describe('extractBotReplyImagePaths', () => {
	it('extracts screenshot image paths from nested run_async_task results', () => {
		const innerPayload = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{
					type: 'tool',
					toolUseId: 'tool_browser',
					name: 'Browser',
					args: { action: 'screenshot_page' },
					result: JSON.stringify({
						path: 'D:\\Temp\\capture.png',
						format: 'png',
					}),
					success: true,
				},
			],
		});
		const outerRaw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{
					type: 'tool',
					toolUseId: 'call_run',
					name: 'run_async_task',
					args: { task: 'capture' },
					result: `workspace=D:\\Project\nmode=agent\nmodel=model-1\n\n${innerPayload}`,
					success: true,
				},
			],
		});

		expect(extractBotReplyImagePaths(outerRaw)).toEqual(['D:\\Temp\\capture.png']);
	});
});
