import { describe, expect, it } from 'vitest';

import { extractTeamLeadNarrative } from './teamWorkflowText';

describe('extractTeamLeadNarrative', () => {
	it('removes fenced task payloads and keeps the narrative text', () => {
		const input = `我先安排团队分析。

\`\`\`json
[
  { "expert": "frontend", "task": "Audit UI" }
]
\`\`\``;

		expect(extractTeamLeadNarrative(input)).toBe('我先安排团队分析。');
	});

	it('removes trailing raw JSON blocks after the narrative text', () => {
		const input = `我先分配前端同学查看渲染链路。
[
  { "expert": "frontend", "task": "Audit UI" }
]`;

		expect(extractTeamLeadNarrative(input)).toBe('我先分配前端同学查看渲染链路。');
	});

	it('removes leading mode markers before showing the narrative text', () => {
		const input = `MODE: CLARIFY
请先明确你要优化的是性能、代码质量还是用户体验。`;

		expect(extractTeamLeadNarrative(input)).toBe('请先明确你要优化的是性能、代码质量还是用户体验。');
	});

	it('removes repeated standalone mode marker lines', () => {
		const input = `MODE: CLARIFY
MODE: CLARIFY
请先明确你要优化的是性能、代码质量还是用户体验。`;

		expect(extractTeamLeadNarrative(input)).toBe('请先明确你要优化的是性能、代码质量还是用户体验。');
	});

	it('strips MODE markers even when they are wrapped in markdown formatting', () => {
		const summary = [
			'**MODE: PLAN**',
			'',
			'我会先安排前端和后端分别处理各自的改动。',
			'',
			'```json',
			'[{"expert":"frontend","task":"..." }]',
			'```',
		].join('\n');

		expect(extractTeamLeadNarrative(summary)).toBe('我会先安排前端和后端分别处理各自的改动。');
	});
});
