import { describe, expect, it } from 'vitest';

import { executeTool } from './toolExecutor.js';

describe('executeTool Bash', () => {
	it('runs shell commands without crashing on missing hooks scope', async () => {
		const command = process.platform === 'win32' ? 'Get-Location' : 'pwd';
		const result = await executeTool(
			{
				id: 'bash-1',
				name: 'Bash',
				arguments: { command },
			},
			undefined,
			{ workspaceRoot: process.cwd() }
		);

		expect(result.isError).toBe(false);
		expect(result.content).not.toContain('hooks is not defined');
	});
});
