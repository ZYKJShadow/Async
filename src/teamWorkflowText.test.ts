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

	it('keeps plain narrative text untouched when there is no fenced payload', () => {
		const input = '请先明确你要优化的是性能、代码质量还是用户体验。';

		expect(extractTeamLeadNarrative(input)).toBe(input);
	});

	it('removes html details blocks from team lead narrative text', () => {
		const input = `这里是最终建议。

<details><summary>初始分派说明</summary>
这段折叠细节不应该直接展示给用户。
</details>`;

		expect(extractTeamLeadNarrative(input)).toBe('这里是最终建议。');
	});

	it('unwraps structured assistant payloads before extracting the narrative', () => {
		const input = JSON.stringify({
			_asyncAssistant: 1,
			v: 1,
			parts: [
				{
					type: 'text',
					text: '请先明确你想优化的模块和目标。',
				},
			],
		});

		expect(extractTeamLeadNarrative(input)).toBe('请先明确你想优化的模块和目标。');
	});
});
