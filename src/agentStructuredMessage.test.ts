import { describe, expect, it } from 'vitest';
import {
	budgetStructuredAssistantToolResults,
	dedupeStructuredAssistantToolUseIds,
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
