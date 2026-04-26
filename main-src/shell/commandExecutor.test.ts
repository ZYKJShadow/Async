import { describe, expect, it } from 'vitest';
import { executeShellCommand } from './commandExecutor.js';

describe('executeShellCommand output decoding', () => {
	it('decodes UTF-16LE stdout bytes instead of mojibake', async () => {
		const text = '适用于 Linux 的 Windows 子系统没有已安装的分发。\n';
		const hex = Buffer.from(text, 'utf16le').toString('hex');
		const result = await executeShellCommand('utf16le fixture', {
			shell: process.execPath,
			args: ['-e', `process.stdout.write(Buffer.from(${JSON.stringify(hex)}, 'hex'))`],
			timeoutMs: 10_000,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(text);
		expect(result.output).toBe(text);
	});
});
