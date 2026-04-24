import { spawn } from 'node:child_process';
import { getShellProvider } from './detectShell.js';
import { createBashProviderWithPath } from './bashProvider.js';
import { createPowerShellProviderWithPath } from './powershellProvider.js';
import type { ShellProvider, ShellType } from './shellProvider.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

export type CommandExecutorOptions = {
	cwd?: string;
	shell?: string;
	args?: string[];
	env?: Record<string, string>;
	timeoutMs?: number;
	signal?: AbortSignal;
	maxOutputBytes?: number;
};

export type CommandExecutorResult = {
	command: string;
	executable: string;
	args: string[];
	shellType: ShellType | 'external';
	cwd?: string;
	stdout: string;
	stderr: string;
	output: string;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	timedOut: boolean;
	truncated: boolean;
};

function clampTimeout(timeoutMs: number | undefined): number {
	if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) {
		return DEFAULT_TIMEOUT_MS;
	}
	return Math.max(500, Math.min(Math.floor(timeoutMs), MAX_TIMEOUT_MS));
}

function isPowerShellShell(shell: string): boolean {
	return /(?:^|[\\/])(pwsh|powershell)(?:\.exe)?$/i.test(shell) || /^(pwsh|powershell)(?:\.exe)?$/i.test(shell);
}

function isBashLikeShell(shell: string): boolean {
	return /(?:^|[\\/])(bash|zsh|sh)(?:\.exe)?$/i.test(shell) || /^(bash|zsh|sh)(?:\.exe)?$/i.test(shell);
}

async function resolveCommand(
	command: string,
	opts: CommandExecutorOptions
): Promise<{ executable: string; args: string[]; shellType: ShellType | 'external' }> {
	if (opts.args) {
		if (!opts.shell) {
			throw new Error('shell is required when args are provided.');
		}
		return { executable: opts.shell, args: opts.args, shellType: 'external' };
	}

	let provider: ShellProvider;
	if (opts.shell && isPowerShellShell(opts.shell)) {
		provider = createPowerShellProviderWithPath(opts.shell);
	} else if (opts.shell && isBashLikeShell(opts.shell)) {
		provider = createBashProviderWithPath(opts.shell);
	} else if (opts.shell) {
		const shellType: ShellType = process.platform === 'win32' ? 'cmd' : 'bash';
		const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
		return { executable: opts.shell, args, shellType };
	} else {
		provider = await getShellProvider();
	}

	const built = provider.buildCommand(command, { cwd: opts.cwd });
	return { executable: built.command, args: built.args, shellType: provider.type };
}

function appendChunk(current: string, chunk: string, maxBytes: number): { value: string; truncated: boolean } {
	const next = current + chunk;
	if (Buffer.byteLength(next, 'utf8') <= maxBytes) {
		return { value: next, truncated: false };
	}
	let value = next;
	while (Buffer.byteLength(value, 'utf8') > maxBytes && value.length > 0) {
		value = value.slice(Math.max(1, value.length - maxBytes));
	}
	return { value, truncated: true };
}

export async function executeShellCommand(command: string, opts: CommandExecutorOptions = {}): Promise<CommandExecutorResult> {
	const built = await resolveCommand(command, opts);
	const timeoutMs = clampTimeout(opts.timeoutMs);
	const maxOutputBytes = Math.max(1024, Math.floor(opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES));

	return await new Promise<CommandExecutorResult>((resolve, reject) => {
		if (opts.signal?.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}

		let stdout = '';
		let stderr = '';
		let truncated = false;
		let timedOut = false;
		let settled = false;

		const child = spawn(built.executable, built.args, {
			cwd: opts.cwd,
			env: opts.env ? { ...(process.env as Record<string, string>), ...opts.env } : process.env,
			shell: false,
			windowsHide: true,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		const cleanupFns: Array<() => void> = [];
		const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
			if (settled) {
				return;
			}
			settled = true;
			for (const cleanup of cleanupFns) cleanup();
			const output = stdout + (stderr ? `${stdout ? '\n--- stderr ---\n' : ''}${stderr}` : '');
			resolve({
				command,
				executable: built.executable,
				args: built.args,
				shellType: built.shellType,
				cwd: opts.cwd,
				stdout,
				stderr,
				output,
				exitCode,
				signal,
				timedOut,
				truncated,
			});
		};

		const killChild = (): void => {
			try {
				child.kill();
			} catch {
				/* ignore */
			}
		};

		const timeout = setTimeout(() => {
			timedOut = true;
			killChild();
		}, timeoutMs);
		cleanupFns.push(() => clearTimeout(timeout));

		const abort = (): void => {
			if (settled) {
				return;
			}
			settled = true;
			for (const cleanup of cleanupFns) cleanup();
			killChild();
			reject(new DOMException('Aborted', 'AbortError'));
		};
		opts.signal?.addEventListener('abort', abort, { once: true });
		cleanupFns.push(() => opts.signal?.removeEventListener('abort', abort));

		child.stdout?.setEncoding('utf8');
		child.stderr?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => {
			const next = appendChunk(stdout, chunk, maxOutputBytes);
			stdout = next.value;
			truncated ||= next.truncated;
		});
		child.stderr?.on('data', (chunk: string) => {
			const next = appendChunk(stderr, chunk, maxOutputBytes);
			stderr = next.value;
			truncated ||= next.truncated;
		});
		child.once('error', (error) => {
			if (settled) return;
			settled = true;
			for (const cleanup of cleanupFns) cleanup();
			reject(error);
		});
		child.once('close', finish);
		child.stdin?.end();
	});
}
