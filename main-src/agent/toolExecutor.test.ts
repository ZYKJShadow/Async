import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const resolveTerminalToolExecCreateOptsMock = vi.fn();
const createTerminalSessionMock = vi.fn();
const startOneShotCommandSessionMock = vi.fn();
const runOneShotCommandMock = vi.fn();
const runTerminalSessionToExitMock = vi.fn();

vi.mock('../terminalProfileStore.js', () => ({
	resolveTerminalToolExecCreateOpts: (...args: unknown[]) => resolveTerminalToolExecCreateOptsMock(...args),
}));

vi.mock('../terminalSessionService.js', () => ({
	createTerminalSession: (...args: unknown[]) => createTerminalSessionMock(...args),
	startOneShotCommandSession: (...args: unknown[]) => startOneShotCommandSessionMock(...args),
	runOneShotCommand: (...args: unknown[]) => runOneShotCommandMock(...args),
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

describe('executeTool view_image', () => {
	it('loads a local workspace image without using the browser tool', async () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'async-view-image-'));
		const imagePath = path.join(workspaceRoot, 'tiny.png');
		fs.writeFileSync(
			imagePath,
			Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX6QAAAAASUVORK5CYII=',
				'base64'
			)
		);

		const result = await executeTool(
			{
				id: 'view-image-1',
				name: 'view_image',
				arguments: { path: 'tiny.png' },
			},
			undefined,
			{ workspaceRoot }
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('"relPath": "tiny.png"');
		expect(Array.isArray(result.structuredContent)).toBe(true);
		const blocks = result.structuredContent as Array<{ type: string; source?: { media_type?: string } }>;
		expect(blocks.some((block) => block.type === 'image' && block.source?.media_type === 'image/png')).toBe(true);
	});
});

describe('executeTool Terminal exec', () => {
	it('waits for a saved SSH profile command to finish', async () => {
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
			sessionKept: false,
			alive: false,
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
			preserveOnTimeout: true,
			preserveOnAuthPrompt: true,
		});
		expect(result.isError).toBe(false);
		expect(result.content).toContain('profile=Prod SSH');
		expect(result.content).toContain('Linux host 6.8.0');
	});

	it('can start a saved SSH profile command in the background and return a session id immediately', async () => {
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
		createTerminalSessionMock.mockReturnValue({
			id: 'term-bg-1',
			title: 'Prod SSH',
			cwd: process.cwd(),
			shell: 'ssh',
			cols: 120,
			rows: 30,
			alive: true,
			bufferBytes: 0,
			createdAt: Date.now(),
		});

		const result = await executeTool({
			id: 'terminal-exec-bg-1',
			name: 'Terminal',
			arguments: {
				action: 'exec',
				profile_id: 'ssh-prod',
				command: 'uname -a',
				run_in_background: true,
			},
		});

		expect(createTerminalSessionMock).toHaveBeenCalledWith({
			shell: 'ssh',
			args: ['user@example.com', "sh -lc 'uname -a'"],
			title: 'Prod SSH',
			cwd: undefined,
			cols: undefined,
			rows: undefined,
		});
		expect(result.isError).toBe(false);
		expect(result.content).toContain('session_id=term-bg-1');
		expect(result.content).toContain('profile "Prod SSH"');
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
			sessionKept: true,
			alive: true,
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
		expect(result.content).toContain('session_id=term-2');
		expect(result.content).toContain('Interactive prompt blocked completion');
		expect(result.content).toContain('Password:');
	});

	it('keeps the session alive when foreground exec times out', async () => {
		resolveTerminalToolExecCreateOptsMock.mockReturnValue({
			createOpts: {
				shell: 'ssh',
				args: ['user@example.com', "sh -lc 'npm install'"],
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
			id: 'term-timeout-1',
			exitCode: null,
			output: 'Downloading packages...',
			timedOut: true,
			authPrompt: null,
			sessionKept: true,
			alive: true,
		});

		const result = await executeTool({
			id: 'terminal-exec-timeout-1',
			name: 'Terminal',
			arguments: {
				action: 'exec',
				profile_id: 'ssh-prod',
				command: 'npm install',
				timeout_ms: 1000,
			},
		});

		expect(result.isError).toBe(false);
		expect(result.content).toContain('session_id=term-timeout-1');
		expect(result.content).toContain('Downloading packages...');
	});
});

describe('executeTool Fetch', () => {
	it('returns error when url is missing', async () => {
		const result = await executeTool({
			id: 'fetch-1',
			name: 'Fetch',
			arguments: {},
		});
		expect(result.isError).toBe(true);
		expect(result.content).toContain('url is required');
	});

	it('returns error for invalid URL', async () => {
		const result = await executeTool({
			id: 'fetch-2',
			name: 'Fetch',
			arguments: { url: 'not-a-url' },
		});
		expect(result.isError).toBe(true);
		expect(result.content).toContain('invalid URL');
	});

	it('returns error for non-HTTP protocols', async () => {
		const result = await executeTool({
			id: 'fetch-3',
			name: 'Fetch',
			arguments: { url: 'ftp://example.com/file.txt' },
		});
		expect(result.isError).toBe(true);
		expect(result.content).toContain('only HTTP and HTTPS URLs are supported');
	});

	it('returns error for unsupported HTTP method', async () => {
		const result = await executeTool({
			id: 'fetch-4',
			name: 'Fetch',
			arguments: { url: 'https://example.com', method: 'TRACE' },
		});
		expect(result.isError).toBe(true);
		expect(result.content).toContain('unsupported HTTP method');
	});

	it('successfully fetches a public HTTPS endpoint', async () => {
		const result = await executeTool({
			id: 'fetch-5',
			name: 'Fetch',
			arguments: { url: 'https://httpbin.org/get' },
		});
		expect(result.isError).toBe(false);
		expect(result.content).toContain('HTTP 200');
		expect(result.content).toContain('Body:');
	});

	it('successfully sends a POST with body and headers', async () => {
		const result = await executeTool({
			id: 'fetch-6',
			name: 'Fetch',
			arguments: {
				url: 'https://httpbin.org/post',
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Test-Header': 'hello' },
				body: JSON.stringify({ test: true }),
			},
		});
		expect(result.isError).toBe(false);
		expect(result.content).toContain('HTTP 200');
		expect(result.content).toContain('"test": true');
	});
});

describe('executeTool Terminal run', () => {
	it('can start a local one-shot command in the background', async () => {
		startOneShotCommandSessionMock.mockReturnValue({
			id: 'term-run-bg-1',
			title: '(one-shot) npm install',
			cwd: process.cwd(),
			shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
			cols: 120,
			rows: 30,
			alive: true,
			bufferBytes: 0,
			createdAt: Date.now(),
		});

		const result = await executeTool(
			{
				id: 'terminal-run-bg-1',
				name: 'Terminal',
				arguments: {
					action: 'run',
					command: 'npm install',
					run_in_background: true,
				},
			},
			undefined,
			{ workspaceRoot: process.cwd() }
		);

		expect(startOneShotCommandSessionMock).toHaveBeenCalledWith({
			command: 'npm install',
			cwd: process.cwd(),
			shell: undefined,
			cols: undefined,
			rows: undefined,
		});
		expect(result.isError).toBe(false);
		expect(result.content).toContain('session_id=term-run-bg-1');
		expect(result.content).toContain('Started background terminal command.');
	});

	it('keeps the session alive when foreground run times out', async () => {
		runOneShotCommandMock.mockResolvedValue({
			id: 'term-run-timeout-1',
			exitCode: null,
			output: 'Downloading packages...',
			timedOut: true,
			sessionKept: true,
			alive: true,
		});

		const result = await executeTool(
			{
				id: 'terminal-run-timeout-1',
				name: 'Terminal',
				arguments: {
					action: 'run',
					command: 'npm install',
					timeout_ms: 1000,
				},
			},
			undefined,
			{ workspaceRoot: process.cwd() }
		);

		expect(runOneShotCommandMock).toHaveBeenCalledWith({
			command: 'npm install',
			cwd: process.cwd(),
			shell: undefined,
			timeoutMs: 1000,
			cols: undefined,
			rows: undefined,
			preserveOnTimeout: true,
		});
		expect(result.isError).toBe(false);
		expect(result.content).toContain('session_id=term-run-timeout-1');
		expect(result.content).toContain('Downloading packages...');
	});
});
