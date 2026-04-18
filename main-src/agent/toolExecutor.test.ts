import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveTerminalToolExecCreateOptsMock = vi.fn();
const runTerminalSessionToExitMock = vi.fn();

vi.mock('../terminalProfileStore.js', () => ({
	resolveTerminalToolExecCreateOpts: (...args: unknown[]) => resolveTerminalToolExecCreateOptsMock(...args),
}));

vi.mock('../terminalSessionService.js', () => ({
	runTerminalSessionToExit: (...args: unknown[]) => runTerminalSessionToExitMock(...args),
}));

import { executeTool } from './toolExecutor.js';

beforeEach(() => {
	vi.clearAllMocks();
});

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

describe('executeTool Browser', () => {
	it('fails gracefully when no host window is attached', async () => {
		const result = await executeTool({
			id: 'browser-1',
			name: 'Browser',
			arguments: { action: 'get_config' },
		});

		expect(result.isError).toBe(true);
		expect(result.content).toContain('attached to an app window');
	});
});

describe('executeTool BrowserCapture', () => {
	it('fails gracefully when no host window is attached', async () => {
		const result = await executeTool({
			id: 'browser-capture-1',
			name: 'BrowserCapture',
			arguments: { action: 'get_state' },
		});

		expect(result.isError).toBe(true);
		expect(result.content).toContain('attached to an app window');
	});
});

describe('executeTool Terminal exec', () => {
	it('executes a saved SSH profile command in the background', async () => {
		resolveTerminalToolExecCreateOptsMock.mockReturnValue({
			createOpts: {
				shell: 'ssh',
				args: ['user@example.com', "sh -lc 'uname -a'"],
				title: 'Prod SSH',
			},
			profile: {
				id: 'ssh-prod',
				name: 'Prod SSH',
				kind: 'ssh',
				source: 'user',
				target: 'root@example.com',
				authMode: 'publicKey',
				hasStoredPassword: false,
				defaultProfile: false,
				hasRemoteCommand: false,
			},
		});
		runTerminalSessionToExitMock.mockResolvedValue({
			id: 'term-1',
			exitCode: 0,
			output: 'Linux host 6.8.0',
			timedOut: false,
			authPrompt: null,
		});

		const result = await executeTool({
			id: 'terminal-exec-1',
			name: 'Terminal',
			arguments: {
				action: 'exec',
				profile_id: 'ssh-prod',
				command: 'uname -a',
			},
		});

		expect(resolveTerminalToolExecCreateOptsMock).toHaveBeenCalledWith('ssh-prod', 'uname -a');
		expect(runTerminalSessionToExitMock).toHaveBeenCalledWith({
			createOpts: {
				shell: 'ssh',
				args: ['user@example.com', "sh -lc 'uname -a'"],
				title: 'Prod SSH',
				cwd: undefined,
				cols: undefined,
				rows: undefined,
			},
			timeoutMs: undefined,
		});
		expect(result.isError).toBe(false);
		expect(result.content).toContain('profile=Prod SSH');
		expect(result.content).toContain('Linux host 6.8.0');
	});

	it('surfaces background auth prompts as actionable errors', async () => {
		resolveTerminalToolExecCreateOptsMock.mockReturnValue({
			createOpts: {
				shell: 'ssh',
				args: ['user@example.com', "sh -lc 'hostname'"],
				title: 'Prod SSH',
			},
			profile: {
				id: 'ssh-prod',
				name: 'Prod SSH',
				kind: 'ssh',
				source: 'user',
				target: 'root@example.com',
				authMode: 'password',
				hasStoredPassword: false,
				defaultProfile: false,
				hasRemoteCommand: false,
			},
		});
		runTerminalSessionToExitMock.mockResolvedValue({
			id: 'term-2',
			exitCode: null,
			output: 'Password:',
			timedOut: false,
			authPrompt: {
				prompt: 'Password:',
				kind: 'password',
				seq: 3,
			},
		});

		const result = await executeTool({
			id: 'terminal-exec-2',
			name: 'Terminal',
			arguments: {
				action: 'exec',
				profile_id: 'ssh-prod',
				command: 'hostname',
			},
		});

		expect(result.isError).toBe(true);
		expect(result.content).toContain('Authentication prompt blocked background exec');
		expect(result.content).toContain('Password:');
	});
});
