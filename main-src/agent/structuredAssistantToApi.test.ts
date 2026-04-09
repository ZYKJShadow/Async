import { describe, expect, it } from 'vitest';
import { parseAgentAssistantPayload, stringifyAgentAssistantPayload } from '../../src/agentStructuredMessage.js';
import {
	expandStructuredAssistantPayloadToAnthropic,
	expandStructuredAssistantPayloadToOpenAI,
} from './structuredAssistantToApi.js';

describe('structuredAssistantToApi', () => {
	it('expands text + tool + text to OpenAI with assistant after last tool', () => {
		const raw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{ type: 'text', text: 'Hi' },
				{
					type: 'tool',
					toolUseId: 'call_a',
					name: 'Read',
					args: { file_path: 'x.ts' },
					result: '1|ok',
					success: true,
				},
				{ type: 'text', text: 'Done.' },
			],
		});
		const p = parseAgentAssistantPayload(raw)!;
		const oa = expandStructuredAssistantPayloadToOpenAI(p);
		expect(oa.length).toBeGreaterThanOrEqual(3);
		expect(oa[0]).toMatchObject({ role: 'assistant', tool_calls: expect.any(Array) });
		expect(oa[1]).toMatchObject({ role: 'tool', tool_call_id: 'call_a' });
		expect(oa[oa.length - 1]).toMatchObject({ role: 'assistant', content: 'Done.' });
	});

	it('falls back to single assistant string when expansion ends on tool only', () => {
		const raw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{
					type: 'tool',
					toolUseId: 'call_b',
					name: 'Glob',
					args: { pattern: '**/*' },
					result: 'a\nb',
					success: true,
				},
			],
		});
		const p = parseAgentAssistantPayload(raw)!;
		const oa = expandStructuredAssistantPayloadToOpenAI(p);
		expect(oa).toHaveLength(1);
		expect(oa[0]!.role).toBe('assistant');
		expect(String((oa[0] as { content?: unknown }).content)).toContain('<tool_call');
	});

	it('Anthropic: tool-only payload falls back to legacy XML string', () => {
		const raw = stringifyAgentAssistantPayload({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{
					type: 'tool',
					toolUseId: 'tu_1',
					name: 'Grep',
					args: { pattern: 'x' },
					result: 'No matches found.',
					success: true,
				},
			],
		});
		const p = parseAgentAssistantPayload(raw)!;
		const am = expandStructuredAssistantPayloadToAnthropic(p);
		expect(am).toHaveLength(1);
		expect(am[0]!.role).toBe('assistant');
		expect(typeof (am[0] as { content: unknown }).content).toBe('string');
	});
});
