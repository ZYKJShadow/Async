import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { windowsCmdUtf8Prefix } from '../../winUtf8.js';
import { senderWorkspaceRoot } from '../agentRuntime.js';

const execFileAsync = promisify(execFile);

/**
 * `terminal:execLine` IPC：在工作区目录下用宿主 shell 执行单行命令。
 *
 * Windows 走 cmd.exe + UTF-8 prefix；其他平台走 bash -lc。
 * 5 MB 输出上限、120 秒超时；行为与原 register.ts 完全一致。
 *
 * 注意：交互式 PTY 终端走 `terminalSessionIpc`，此 handler 仅用于 composer
 * 等"一次性命令片段执行"场景。
 */
export function registerTerminalExecHandlers(): void {
	ipcMain.handle('terminal:execLine', async (event, line: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		const trimmed = line.trim();
		if (!trimmed) {
			return { ok: true as const, stdout: '', stderr: '' };
		}
		try {
			const isWin = process.platform === 'win32';
			const shell = isWin ? process.env.ComSpec || 'cmd.exe' : '/bin/bash';
			const cmdLine = isWin ? windowsCmdUtf8Prefix(trimmed) : trimmed;
			const args = isWin ? ['/d', '/s', '/c', cmdLine] : ['-lc', cmdLine];
			const { stdout, stderr } = await execFileAsync(shell, args, {
				cwd: root,
				windowsHide: true,
				maxBuffer: 5 * 1024 * 1024,
				timeout: 120_000,
				encoding: 'utf8',
			});
			return { ok: true as const, stdout: stdout || '', stderr: stderr || '' };
		} catch (e: unknown) {
			const err = e as { stdout?: string; stderr?: string; message?: string };
			return {
				ok: false as const,
				error: err.message ?? String(e),
				stdout: err.stdout ?? '',
				stderr: err.stderr ?? '',
			};
		}
	});
}
