import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { decodeTextBuffer, encodeTextBuffer, readTextFileSyncWithMetadata } from '../textEncoding.js';

const resolveTerminalToolExecCreateOptsMock = vi.fn();
const createTerminalSessionMock = vi.fn();
const startOneShotCommandSessionMock = vi.fn();
const runOneShotCommandMock = vi.fn();
const runTerminalSessionToExitMock = vi.fn();
const executeShellCommandMock = vi.fn();
const httpsRequestMock = vi.fn();

vi.mock('../terminalProfileStore.js', () => ({
	resolveTerminalToolExecCreateOpts: (...args: unknown[]) => resolveTerminalToolExecCreateOptsMock(...args),
}));

vi.mock('../terminalSessionService.js', () => ({
	createTerminalSession: (...args: unknown[]) => createTerminalSessionMock(...args),
	startOneShotCommandSession: (...args: unknown[]) => startOneShotCommandSessionMock(...args),
	runOneShotCommand: (...args: unknown[]) => runOneShotCommandMock(...args),
	runTerminalSessionToExit: (...args: unknown[]) => runTerminalSessionToExitMock(...args),
}));

vi.mock('../shell/commandExecutor.js', () => ({
	executeShellCommand: (...args: unknown[]) => executeShellCommandMock(...args),
}));

vi.mock('node:https', () => ({
	request: (...args: unknown[]) => httpsRequestMock(...args),
}));

import { executeTool } from './toolExecutor.js';

beforeEach(() => {
	vi.clearAllMocks();
	executeShellCommandMock.mockResolvedValue({
		command: '',
		executable: '',
		args: [],
		shellType: 'external',
		cwd: undefined,
		stdout: '',
		stderr: '',
		output: '',
		exitCode: 0,
		signal: null,
		timedOut: false,
		truncated: false,
	});
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

	it('blocks direct shell redirection writes', async () => {
		const result = await executeTool(
			{
				id: 'bash-write-1',
				name: 'Bash',
				arguments: { command: 'echo hello > notes.txt' },
			},
			undefined,
			{ workspaceRoot: process.cwd() }
		);

		expect(result.isError).toBe(true);
		expect(result.content).toContain('Blocked unsafe Bash command');
		expect(executeShellCommandMock).not.toHaveBeenCalled();
	});
});

describe('executeTool file encoding', () => {
	it('preserves UTF-16LE BOM when Write overwrites an existing text file', async () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'async-write-encoding-'));
		const file = path.join(workspaceRoot, 'utf16.txt');
		fs.writeFileSync(file, encodeTextBuffer('旧内容', 'utf16le-bom'));

		const result = await executeTool(
			{
				id: 'write-utf16-1',
				name: 'Write',
				arguments: { file_path: 'utf16.txt', content: '新内容' },
			},
			undefined,
			{ workspaceRoot }
		);

		expect(result.isError).toBe(false);
		const raw = fs.readFileSync(file);
		expect([...raw.subarray(0, 2)]).toEqual([0xff, 0xfe]);
		expect(readTextFileSyncWithMetadata(file).text).toBe('新内容');
	});

	it('preserves GB18030 when Edit modifies an existing legacy-encoded file', async () => {
		const previous = process.env.ASYNC_LEGACY_TEXT_ENCODING;
		process.env.ASYNC_LEGACY_TEXT_ENCODING = 'gb18030';
		try {
			const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'async-edit-encoding-'));
			const file = path.join(workspaceRoot, 'gbk.txt');
			fs.writeFileSync(file, encodeTextBuffer('中文 old', 'gb18030'));

			const result = await executeTool(
				{
					id: 'edit-gb18030-1',
					name: 'Edit',
					arguments: { file_path: 'gbk.txt', old_string: 'old', new_string: 'new' },
				},
				undefined,
				{ workspaceRoot }
			);

			expect(result.isError).toBe(false);
			const decoded = decodeTextBuffer(fs.readFileSync(file), { preferredLegacyEncoding: 'gb18030' });
			expect(decoded.text).toBe('中文 new');
			expect(decoded.encoding).toBe('gb18030');
		} finally {
			if (previous === undefined) {
				delete process.env.ASYNC_LEGACY_TEXT_ENCODING;
			} else {
				process.env.ASYNC_LEGACY_TEXT_ENCODING = previous;
			}
		}
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
		executeShellCommandMock.mockResolvedValue({
			command: 'uname -a',
			executable: 'ssh',
			args: ['user@example.com', "sh -lc 'uname -a'"],
			shellType: 'external',
			cwd: undefined,
			stdout: 'Linux host 6.8.0',
			stderr: '',
			output: 'Linux host 6.8.0',
			exitCode: 0,
			signal: null,
			timedOut: false,
			truncated: false,
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
		expect(executeShellCommandMock).toHaveBeenCalledWith('uname -a', {
			shell: 'ssh',
			args: ['user@example.com', "sh -lc 'uname -a'"],
			cwd: undefined,
			env: undefined,
			timeoutMs: undefined,
			signal: undefined,
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

	it('surfaces failed foreground exec output', async () => {
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
		executeShellCommandMock.mockResolvedValue({
			command: 'hostname',
			executable: 'ssh',
			args: ['user@example.com', "sh -lc 'hostname'"],
			shellType: 'external',
			cwd: undefined,
			stdout: '',
			stderr: 'Permission denied',
			output: 'Permission denied',
			exitCode: null,
			signal: null,
			timedOut: true,
			truncated: false,
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
		expect(result.content).toContain('profile=Prod SSH');
		expect(result.content).toContain('timed_out=true');
		expect(result.content).toContain('Permission denied');
	});

	it('marks foreground exec timeouts as errors', async () => {
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
		executeShellCommandMock.mockResolvedValue({
			command: 'npm install',
			executable: 'ssh',
			args: ['user@example.com', "sh -lc 'npm install'"],
			shellType: 'external',
			cwd: undefined,
			stdout: 'Downloading packages...',
			stderr: '',
			output: 'Downloading packages...',
			exitCode: null,
			signal: null,
			timedOut: true,
			truncated: false,
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

		expect(result.isError).toBe(true);
		expect(result.content).toContain('timed_out=true');
		expect(result.content).toContain('Downloading packages...');
	});
});

describe('executeTool Fetch', () => {
	beforeEach(() => {
		httpsRequestMock.mockImplementation((_url, _options, callback) => {
			const res = new EventEmitter() as any;
			res.statusCode = 200;
			res.statusMessage = 'OK';
			res.headers = { 'content-type': 'application/json' };
			res.destroy = vi.fn();

			const req = {
				write: vi.fn(),
				end: vi.fn(),
				destroy: vi.fn(),
				on: vi.fn(),
			};

			process.nextTick(() => {
				const cb = callback as (res: any) => void;
				cb(res);
				res.emit('data', Buffer.from('{"test": true}'));
				res.emit('end');
			});

			return req;
		});
	});

	afterEach(() => {
		httpsRequestMock.mockClear();
	});

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

	it('marks foreground run timeouts as errors', async () => {
		executeShellCommandMock.mockResolvedValue({
			command: 'npm install',
			executable: 'bash',
			args: ['-lc', 'npm install'],
			shellType: 'bash',
			cwd: process.cwd(),
			stdout: 'Downloading packages...',
			stderr: '',
			output: 'Downloading packages...',
			exitCode: null,
			signal: null,
			timedOut: true,
			truncated: false,
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

		expect(executeShellCommandMock).toHaveBeenCalledWith('npm install', {
			cwd: process.cwd(),
			shell: undefined,
			timeoutMs: 1000,
			signal: undefined,
		});
		expect(result.isError).toBe(true);
		expect(result.content).toContain('timed_out=true');
		expect(result.content).toContain('Downloading packages...');
	});
});
