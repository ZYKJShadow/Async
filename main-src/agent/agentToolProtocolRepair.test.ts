import { describe, expect, it } from 'vitest';
import { stripOrphanToolResultsFromAssistantContent } from './agentToolProtocolRepair.js';

describe('stripOrphanToolResultsFromAssistantContent (extended tool_call attrs)', () => {
	it('keeps paired tool_call with sub_parent/sub_depth and tool_result', () => {
		const content = [
			'\n<tool_call tool="Read" sub_parent="call-1" sub_depth="1">{"file_path":"a.ts"}</tool_call>\n',
			'<tool_result tool="Read" success="true">1|ok</tool_result>\n',
		].join('');
		expect(stripOrphanToolResultsFromAssistantContent(content)).toBe(content);
	});

	it('removes orphan tool_result when no preceding call', () => {
		const content = 'intro\n<tool_result tool="Read" success="true">orphan</tool_result>\ntrailing';
		const out = stripOrphanToolResultsFromAssistantContent(content);
		expect(out).not.toContain('tool_result');
		expect(out).toContain('intro');
		expect(out).toContain('trailing');
	});
});
