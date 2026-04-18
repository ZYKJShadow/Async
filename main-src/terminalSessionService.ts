/**
 * 全能终端：跨窗口共享的 pty 会话池。
 *
 * 与 `terminalPty.ts` 的区别：
 * - 会话不绑定创建者 sender；任何窗口 / agent tool 都可读写/订阅
 * - 维护每会话的环形输出缓冲（供窗口晚开、agent `read` 使用）
 * - 广播 `term:data` / `term:exit` / `term:listChanged` 到所有已订阅的 webContents
 */

import { BrowserWindow, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as pty from 'node-pty';
import { isWindows } from './platform.js';
import { appendTerminalAuthPromptTail, detectTerminalAuthPrompt, type TerminalSessionAuthPromptKind } from './terminalAuthPrompt.js';

const MAX_BUFFER_BYTES = 256 * 1024;
const MAX_PASSWORD_AUTOFILL_ATTEMPTS = 1;

export type TerminalSessionCreateOpts = {
	cwd?: string;
	shell?: string;
	args?: string[];
	env?: Record<string, string>;
	cols?: number;
	rows?: number;
	title?: string;
	passwordAutofill?: string;
};

export type TerminalSessionInfo = {
	id: string;
	title: string;
	cwd: string;
	shell: string;
	cols: number;
	rows: number;
	alive: boolean;
	bufferBytes: number;
	createdAt: number;
};

export type TerminalSessionAuthPrompt = {
	prompt: string;
	kind: TerminalSessionAuthPromptKind;
	seq: number;
};

type Session = {
	id: string;
	pty: pty.IPty;
	title: string;
	cwd: string;
	shell: string;
	cols: number;
	rows: number;
	alive: boolean;
	createdAt: number;
	buffer: string;
	seq: number;
	subscribers: Set<WebContents>;
	exitCode: number | null;
	passwordAutofill: string | null;
	passwordAutofillCount: number;
	recentOutputTail: string;
	pendingAuthPrompt: TerminalSessionAuthPrompt | null;
};

const sessions = new Map<string, Session>();

function safeSend(contents: WebContents, channel: string, ...args: unknown[]): void {
	if (!contents.isDestroyed()) {
		try {
			contents.send(channel, ...args);
		} catch {
			/* ignore */
		}
	}
}

function broadcastToSubscribers(s: Session, channel: string, ...args: unknown[]): void {
	for (const c of [...s.subscribers]) {
		if (c.isDestroyed()) {
			s.subscribers.delete(c);
			continue;
		}
		safeSend(c, channel, ...args);
	}
}

function broadcastListChanged(): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			safeSend(win.webContents, 'term:listChanged');
		}
	}
}

function appendBuffer(s: Session, chunk: string): void {
	const merged = s.buffer + chunk;
	if (merged.length <= MAX_BUFFER_BYTES) {
		s.buffer = merged;
	} else {
		s.buffer = merged.slice(merged.length - MAX_BUFFER_BYTES);
	}
}

function resolveShell(requested?: string): { shell: string; args: string[] } {
	const win = isWindows();
	if (requested && requested.trim()) {
		const trimmed = requested.trim();
		return {
			shell: trimmed,
			args: win ? ['/k', 'chcp 65001>nul'] : ['-i'],
		};
	}
	const shell = win ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/bash';
	const args = win ? ['/k', 'chcp 65001>nul'] : ['-i'];
	return { shell, args };
}

export function createTerminalSession(opts: TerminalSessionCreateOpts = {}): TerminalSessionInfo {
	const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : process.cwd();
	const { shell, args } = resolveShell(opts.shell);
	const cols = Math.max(2, Math.floor(opts.cols ?? 120));
	const rows = Math.max(1, Math.floor(opts.rows ?? 30));
	const id = randomUUID();
	const mergedEnv = opts.env
		? ({ ...(process.env as Record<string, string>), ...opts.env } as { [key: string]: string })
		: (process.env as { [key: string]: string });
	const proc = pty.spawn(shell, opts.args ?? args, {
		name: 'xterm-256color',
		cwd,
		env: mergedEnv,
		cols,
		rows,
	});
	const session: Session = {
		id,
		pty: proc,
		title: opts.title?.trim() || defaultTitleForShell(shell),
		cwd,
		shell,
		cols,
		rows,
		alive: true,
		createdAt: Date.now(),
		buffer: '',
		seq: 0,
		subscribers: new Set(),
		exitCode: null,
		passwordAutofill: opts.passwordAutofill || null,
		passwordAutofillCount: 0,
		recentOutputTail: '',
		pendingAuthPrompt: null,
	};
	sessions.set(id, session);
	proc.onData((data) => {
		session.seq += 1;
		appendBuffer(session, data);
		const authPrompt = maybeHandleAuthPrompt(session, data);
		broadcastToSubscribers(session, 'term:data', id, data, session.seq);
		if (authPrompt) {
			broadcastToSubscribers(session, 'term:authPrompt', id, authPrompt);
		}
	});
	proc.onExit(({ exitCode }) => {
		session.alive = false;
		session.exitCode = typeof exitCode === 'number' ? exitCode : null;
		session.pendingAuthPrompt = null;
		broadcastToSubscribers(session, 'term:exit', id, session.exitCode);
		broadcastListChanged();
	});
	broadcastListChanged();
	return toInfo(session);
}

export function writeTerminalSession(id: string, data: string): boolean {
	const s = sessions.get(id);
	if (!s || !s.alive) {
		return false;
	}
	try {
		resetSessionAuthPromptState(s);
		s.pty.write(data);
		return true;
	} catch {
		return false;
	}
}

export function respondToTerminalSessionAuthPrompt(id: string, data: string): boolean {
	const s = sessions.get(id);
	if (!s || !s.alive || !s.pendingAuthPrompt) {
		return false;
	}
	try {
		resetSessionAuthPromptState(s);
		s.pty.write(data);
		return true;
	} catch {
		return false;
	}
}

export function clearTerminalSessionAuthPrompt(id: string): boolean {
	const s = sessions.get(id);
	if (!s) {
		return false;
	}
	resetSessionAuthPromptState(s);
	return true;
}

export function resizeTerminalSession(id: string, cols: number, rows: number): boolean {
	const s = sessions.get(id);
	if (!s || !s.alive) {
		return false;
	}
	const c = Math.max(2, Math.floor(cols));
	const r = Math.max(1, Math.floor(rows));
	try {
		s.pty.resize(c, r);
		s.cols = c;
		s.rows = r;
		return true;
	} catch {
		return false;
	}
}

export function killTerminalSession(id: string): boolean {
	const s = sessions.get(id);
	if (!s) {
		return false;
	}
	try {
		s.pty.kill();
	} catch {
		/* ignore */
	}
	sessions.delete(id);
	broadcastListChanged();
	return true;
}

export function listTerminalSessions(): TerminalSessionInfo[] {
	return [...sessions.values()].map(toInfo);
}

export function getTerminalSession(id: string): TerminalSessionInfo | null {
	const s = sessions.get(id);
	return s ? toInfo(s) : null;
}

export type TerminalBufferSlice = {
	id: string;
	content: string;
	seq: number;
	alive: boolean;
	exitCode: number | null;
	bufferBytes: number;
	authPrompt: TerminalSessionAuthPrompt | null;
};

export function getTerminalBuffer(id: string, maxBytes?: number): TerminalBufferSlice | null {
	const s = sessions.get(id);
	if (!s) {
		return null;
	}
	const cap = Math.max(256, Math.min(Math.floor(maxBytes ?? 16_384), MAX_BUFFER_BYTES));
	const content = s.buffer.length <= cap ? s.buffer : s.buffer.slice(s.buffer.length - cap);
	return {
		id: s.id,
		content,
		seq: s.seq,
		alive: s.alive,
		exitCode: s.exitCode,
		bufferBytes: Buffer.byteLength(s.buffer, 'utf8'),
		authPrompt: s.pendingAuthPrompt,
	};
}

const destroyedHandlersByContents = new WeakMap<WebContents, () => void>();

export function subscribeToSession(id: string, contents: WebContents): TerminalBufferSlice | null {
	const s = sessions.get(id);
	if (!s) {
		return null;
	}
	s.subscribers.add(contents);
	if (!destroyedHandlersByContents.has(contents)) {
		const cleanup = () => {
			for (const session of sessions.values()) {
				session.subscribers.delete(contents);
			}
			destroyedHandlersByContents.delete(contents);
		};
		destroyedHandlersByContents.set(contents, cleanup);
		contents.once('destroyed', cleanup);
	}
	return {
		id: s.id,
		content: s.buffer,
		seq: s.seq,
		alive: s.alive,
		exitCode: s.exitCode,
		bufferBytes: Buffer.byteLength(s.buffer, 'utf8'),
		authPrompt: s.pendingAuthPrompt,
	};
}

export function unsubscribeFromSession(id: string, contents: WebContents): void {
	const s = sessions.get(id);
	if (!s) {
		return;
	}
	s.subscribers.delete(contents);
}

export function renameTerminalSession(id: string, title: string): boolean {
	const s = sessions.get(id);
	if (!s) {
		return false;
	}
	const next = title.trim();
	if (!next) {
		return false;
	}
	s.title = next;
	broadcastListChanged();
	return true;
}

/**
 * 启动一个短命会话、等待其退出（或超时后强杀），返回完整输出。
 * 适合 agent `Terminal run` 动作：不需要持续交互时无副作用地执行命令。
 */
export async function runOneShotCommand(opts: {
	command: string;
	cwd?: string;
	shell?: string;
	timeoutMs?: number;
	cols?: number;
	rows?: number;
}): Promise<{ id: string; exitCode: number | null; output: string; timedOut: boolean }> {
	const info = createTerminalSession({
		cwd: opts.cwd,
		shell: opts.shell,
		cols: opts.cols,
		rows: opts.rows,
		title: '(one-shot) ' + opts.command.slice(0, 40),
	});
	const session = sessions.get(info.id)!;
	const timeoutMs = Math.max(500, Math.min(opts.timeoutMs ?? 120_000, 600_000));
	return await new Promise<{ id: string; exitCode: number | null; output: string; timedOut: boolean }>((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			try {
				session.pty.kill();
			} catch {
				/* ignore */
			}
			const slice = getTerminalBuffer(info.id, MAX_BUFFER_BYTES);
			sessions.delete(info.id);
			resolve({ id: info.id, exitCode: null, output: slice?.content ?? '', timedOut: true });
		}, timeoutMs);
		const disposeExit = session.pty.onExit(({ exitCode }) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			disposeExit.dispose();
			const slice = getTerminalBuffer(info.id, MAX_BUFFER_BYTES);
			sessions.delete(info.id);
			resolve({
				id: info.id,
				exitCode: typeof exitCode === 'number' ? exitCode : null,
				output: slice?.content ?? '',
				timedOut: false,
			});
		});
		try {
			const cr = isWindows() ? '\r\n' : '\n';
			session.pty.write(opts.command + cr + (isWindows() ? 'exit\r\n' : 'exit\n'));
		} catch {
			clearTimeout(timer);
			disposeExit.dispose();
			sessions.delete(info.id);
			resolve({ id: info.id, exitCode: null, output: '', timedOut: false });
		}
	});
}

function toInfo(s: Session): TerminalSessionInfo {
	return {
		id: s.id,
		title: s.title,
		cwd: s.cwd,
		shell: s.shell,
		cols: s.cols,
		rows: s.rows,
		alive: s.alive,
		bufferBytes: Buffer.byteLength(s.buffer, 'utf8'),
		createdAt: s.createdAt,
	};
}

function defaultTitleForShell(shellPath: string): string {
	const base = shellPath.replace(/\\/g, '/').split('/').pop() ?? shellPath;
	return base.replace(/\.exe$/i, '');
}

function maybeHandleAuthPrompt(session: Session, chunk: string): TerminalSessionAuthPrompt | null {
	session.recentOutputTail = appendTerminalAuthPromptTail(session.recentOutputTail, chunk);
	const detected = detectTerminalAuthPrompt(session.recentOutputTail);
	if (!detected) {
		session.pendingAuthPrompt = null;
		return null;
	}

	if (session.passwordAutofill && session.passwordAutofillCount < MAX_PASSWORD_AUTOFILL_ATTEMPTS) {
		try {
			session.passwordAutofillCount += 1;
			resetSessionAuthPromptState(session);
			session.pty.write(session.passwordAutofill + '\r');
			return null;
		} catch {
			/* ignore */
		}
	}

	const nextPrompt: TerminalSessionAuthPrompt = {
		prompt: detected.prompt,
		kind: detected.kind,
		seq: session.seq,
	};
	session.pendingAuthPrompt = nextPrompt;
	return nextPrompt;
}

function resetSessionAuthPromptState(session: Session): void {
	session.pendingAuthPrompt = null;
	session.recentOutputTail = '';
}
