/**
 * 工具执行引擎 — 接收工具调用并在工作区内安全执行。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getWorkspaceRoot, resolveWorkspacePath, isPathInsideRoot } from '../workspace.js';
import { formatSymbolSearchResults, searchWorkspaceSymbols } from '../workspaceSymbolIndex.js';
import type { ToolCall, ToolResult } from './agentTools.js';

const execFileAsync = promisify(execFile);

const MAX_READ_SIZE = 200_000;
const MAX_SEARCH_RESULTS = 80;

export type ToolWriteSnapshot = {
	path: string;
	previousContent: string | null;
};

export type ToolExecutionHooks = {
	beforeWrite?: (snapshot: ToolWriteSnapshot) => void | Promise<void>;
};

export async function executeTool(call: ToolCall, hooks: ToolExecutionHooks = {}): Promise<ToolResult> {
	try {
		switch (call.name) {
			case 'read_file':
				return executeReadFile(call);
			case 'write_to_file':
				return executeWriteToFile(call, hooks);
			case 'str_replace':
				return executeStrReplace(call, hooks);
			case 'list_dir':
				return executeListDir(call);
			case 'search_files':
				return await executeSearchFiles(call);
			case 'execute_command':
				return await executeCommand(call);
			default:
				return { toolCallId: call.id, name: call.name, content: `Unknown tool: ${call.name}`, isError: true };
		}
	} catch (e) {
		return { toolCallId: call.id, name: call.name, content: `Error: ${e instanceof Error ? e.message : String(e)}`, isError: true };
	}
}

function requireWorkspace(): string {
	const root = getWorkspaceRoot();
	if (!root) throw new Error('No workspace folder open.');
	return root;
}

function safePath(relPath: string): string {
	const root = requireWorkspace();
	const full = resolveWorkspacePath(relPath);
	if (!isPathInsideRoot(full, root)) throw new Error('Path escapes workspace boundary.');
	return full;
}

function executeReadFile(call: ToolCall): ToolResult {
	const relPath = String(call.arguments.path ?? '');
	if (!relPath) return { toolCallId: call.id, name: call.name, content: 'Error: path is required', isError: true };

	const full = safePath(relPath);
	if (!fs.existsSync(full)) {
		return { toolCallId: call.id, name: call.name, content: `File not found: ${relPath}`, isError: true };
	}

	const buf = fs.readFileSync(full);
	if (buf.includes(0)) {
		return { toolCallId: call.id, name: call.name, content: `Skipped binary file: ${relPath}`, isError: true };
	}

	let content = buf.toString('utf8').replace(/\r\n/g, '\n');
	if (content.length > MAX_READ_SIZE) {
		content = content.slice(0, MAX_READ_SIZE) + '\n... (truncated)';
	}

	const lines = content.split('\n');
	const startLine = Math.max(1, Number(call.arguments.start_line) || 1);
	const endLine = Math.min(lines.length, Number(call.arguments.end_line) || lines.length);

	const slice = lines.slice(startLine - 1, endLine);
	const numbered = slice.map((l, i) => `${String(startLine + i).padStart(6)}|${l}`).join('\n');

	return { toolCallId: call.id, name: call.name, content: numbered, isError: false };
}

function executeWriteToFile(call: ToolCall, hooks: ToolExecutionHooks): ToolResult {
	const relPath = String(call.arguments.path ?? '');
	const content = String(call.arguments.content ?? '');
	if (!relPath) return { toolCallId: call.id, name: call.name, content: 'Error: path is required', isError: true };

	const full = safePath(relPath);
	const existed = fs.existsSync(full);
	const previousContent = existed ? fs.readFileSync(full, 'utf8') : null;
	void hooks.beforeWrite?.({ path: relPath, previousContent });
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content, 'utf8');

	const lineCount = content.split('\n').length;
	return {
		toolCallId: call.id,
		name: call.name,
		content: `${existed ? 'Updated' : 'Created'} ${relPath} (${lineCount} lines)`,
		isError: false,
	};
}

function executeStrReplace(call: ToolCall, hooks: ToolExecutionHooks): ToolResult {
	const relPath = String(call.arguments.path ?? '');
	const rawOldStr = String(call.arguments.old_str ?? '');
	const rawNewStr = String(call.arguments.new_str ?? '');
	if (!relPath) return { toolCallId: call.id, name: call.name, content: 'Error: path is required', isError: true };
	if (!rawOldStr) return { toolCallId: call.id, name: call.name, content: 'Error: old_str is required and must not be empty', isError: true };

	const full = safePath(relPath);
	if (!fs.existsSync(full)) {
		return { toolCallId: call.id, name: call.name, content: `File not found: ${relPath}`, isError: true };
	}

	const buf = fs.readFileSync(full);
	if (buf.includes(0)) {
		return { toolCallId: call.id, name: call.name, content: `Skipped binary file: ${relPath}`, isError: true };
	}

	const source = buf.toString('utf8');
	const fileHasCRLF = source.includes('\r\n');

	const oldStr = fileHasCRLF
		? rawOldStr.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
		: rawOldStr.replace(/\r\n/g, '\n');
	const newStr = fileHasCRLF
		? rawNewStr.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
		: rawNewStr.replace(/\r\n/g, '\n');

	let idx = source.indexOf(oldStr);
	let matchLen = oldStr.length;

	// Fallback 1: strip trailing whitespace per line
	if (idx === -1) {
		const stripped = stripTrailingSpacesPerLine(oldStr);
		const sourceStripped = stripTrailingSpacesPerLine(source);
		const fallbackIdx = sourceStripped.indexOf(stripped);
		if (fallbackIdx !== -1) {
			const secondFb = sourceStripped.indexOf(stripped, fallbackIdx + 1);
			if (secondFb === -1) {
				const origSlice = source.slice(fallbackIdx, fallbackIdx + stripped.length);
				const charDelta = source.length - sourceStripped.length;
				const adjustedIdx = charDelta === 0 ? fallbackIdx : source.indexOf(origSlice);
				if (adjustedIdx !== -1) idx = adjustedIdx;
			}
		}
	}

	// Fallback 2: LF-normalized search — handles CRLF/LF/mixed-ending mismatches
	if (idx === -1) {
		const srcLF = source.replace(/\r\n/g, '\n');
		const oldLF = rawOldStr.replace(/\r\n/g, '\n');
		const lfIdx = srcLF.indexOf(oldLF);
		if (lfIdx !== -1 && srcLF.indexOf(oldLF, lfIdx + 1) === -1) {
			idx = lfPosToOriginal(source, lfIdx);
			matchLen = lfPosToOriginal(source, lfIdx + oldLF.length) - idx;
		}
	}

	if (idx === -1) {
		const preview = rawOldStr.length > 200 ? rawOldStr.slice(0, 200) + '...' : rawOldStr;
		const hint = fileHasCRLF ? ' (note: file uses CRLF line endings)' : '';
		return {
			toolCallId: call.id,
			name: call.name,
			content: `old_str not found in ${relPath}${hint}. Make sure the string matches exactly including whitespace and indentation.\nSearched for: ${preview}`,
			isError: true,
		};
	}

	const verifySecond = source.indexOf(oldStr, idx + 1);
	if (verifySecond !== -1) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `old_str appears multiple times in ${relPath}. Include more surrounding context to make it unique.`,
			isError: true,
		};
	}

	const lineNumber = source.slice(0, idx).split('\n').length;
	const patched = source.slice(0, idx) + newStr + source.slice(idx + matchLen);
	void hooks.beforeWrite?.({ path: relPath, previousContent: source });
	fs.writeFileSync(full, patched, 'utf8');

	return {
		toolCallId: call.id,
		name: call.name,
		content: `Applied edit to ${relPath} at line ${lineNumber}`,
		isError: false,
	};
}

function stripTrailingSpacesPerLine(s: string): string {
	return s.replace(/[ \t]+(\r?\n)/g, '$1').replace(/[ \t]+$/, '');
}

/** Map a position in the LF-normalized string back to the original (potentially CRLF) string. */
function lfPosToOriginal(original: string, lfPos: number): number {
	let origIdx = 0;
	let lfIdx = 0;
	while (lfIdx < lfPos && origIdx < original.length) {
		if (original[origIdx] === '\r' && original[origIdx + 1] === '\n') {
			origIdx += 2;
		} else {
			origIdx += 1;
		}
		lfIdx += 1;
	}
	return origIdx;
}

function executeListDir(call: ToolCall): ToolResult {
	const root = requireWorkspace();
	const relPath = String(call.arguments.path ?? '').trim();
	const full = relPath ? safePath(relPath) : root;

	if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
		return { toolCallId: call.id, name: call.name, content: `Not a directory: ${relPath || '.'}`, isError: true };
	}

	const entries = fs.readdirSync(full, { withFileTypes: true });
	const sorted = entries
		.filter((e) => e.name !== '.' && e.name !== '..')
		.sort((a, b) => {
			if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
			return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
		});

	const lines = sorted.map((e) => (e.isDirectory() ? `[dir]  ${e.name}/` : `[file] ${e.name}`));
	return { toolCallId: call.id, name: call.name, content: lines.join('\n') || '(empty directory)', isError: false };
}

async function executeSearchFiles(call: ToolCall): Promise<ToolResult> {
	const root = requireWorkspace();
	const pattern = String(call.arguments.pattern ?? '');
	if (!pattern) return { toolCallId: call.id, name: call.name, content: 'Error: pattern is required', isError: true };

	const symbolMode =
		call.arguments.symbol === true ||
		call.arguments.search_symbols === true ||
		call.arguments.mode === 'symbol';
	if (symbolMode) {
		const hits = searchWorkspaceSymbols(pattern, MAX_SEARCH_RESULTS);
		return {
			toolCallId: call.id,
			name: call.name,
			content: formatSymbolSearchResults(hits),
			isError: false,
		};
	}

	const subPath = String(call.arguments.path ?? '').trim();
	const searchDir = subPath ? safePath(subPath) : root;

	try {
		const isWin = process.platform === 'win32';
		const shell = isWin ? process.env.ComSpec || 'cmd.exe' : '/bin/bash';
		const grepCmd = `rg --line-number --max-count=5 --max-filesize=1M --no-heading --color=never -e ${JSON.stringify(pattern)} .`;
		const args = isWin ? ['/d', '/s', '/c', grepCmd] : ['-lc', grepCmd];
		const { stdout } = await execFileAsync(shell, args, {
			cwd: searchDir,
			windowsHide: true,
			maxBuffer: 2 * 1024 * 1024,
			timeout: 30_000,
		});
		const lines = (stdout || '').split('\n').filter(Boolean);
		if (lines.length > MAX_SEARCH_RESULTS) {
			const truncated = lines.slice(0, MAX_SEARCH_RESULTS);
			truncated.push(`... and ${lines.length - MAX_SEARCH_RESULTS} more matches`);
			return { toolCallId: call.id, name: call.name, content: truncated.join('\n'), isError: false };
		}
		return { toolCallId: call.id, name: call.name, content: lines.join('\n') || 'No matches found.', isError: false };
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string; code?: number };
		if (err.code === 1 && !err.stdout?.trim()) {
			return { toolCallId: call.id, name: call.name, content: 'No matches found.', isError: false };
		}
		if (err.stdout?.trim()) {
			const lines = err.stdout.split('\n').filter(Boolean);
			if (lines.length > MAX_SEARCH_RESULTS) {
				return { toolCallId: call.id, name: call.name, content: lines.slice(0, MAX_SEARCH_RESULTS).join('\n') + `\n... truncated`, isError: false };
			}
			return { toolCallId: call.id, name: call.name, content: lines.join('\n'), isError: false };
		}
		return { toolCallId: call.id, name: call.name, content: `Search failed: ${err.stderr || String(e)}`, isError: true };
	}
}

const UNIX_INSPECT_RE = /^\s*(ls\b|cat\b|head\b|tail\b|wc\b|file\b|stat\b|less\b|more\b|sed\b|awk\b|find\s)/;
const UNIX_REDIRECT: Record<string, string> = {
	ls: 'Use list_dir to list directories, or read_file to inspect a file.',
	cat: 'Use read_file to read file contents.',
	head: 'Use read_file with start_line=1 and end_line=N to read the first N lines.',
	tail: 'Use read_file with start_line and end_line to read the last portion of a file.',
	wc: 'Use read_file to get the file content, then count in your response.',
	file: 'Use read_file to inspect file contents.',
	stat: 'Use list_dir to check if a file exists.',
	less: 'Use read_file to read file contents.',
	more: 'Use read_file to read file contents.',
	sed: 'Use str_replace to make targeted edits to files.',
	awk: 'Use read_file then process the content in your response.',
	find: 'Use list_dir or search_files instead.',
};

async function executeCommand(call: ToolCall): Promise<ToolResult> {
	const root = requireWorkspace();
	const command = String(call.arguments.command ?? '').trim();
	if (!command) return { toolCallId: call.id, name: call.name, content: 'Error: command is required', isError: true };

	if (process.platform === 'win32') {
		const unixMatch = command.match(UNIX_INSPECT_RE);
		if (unixMatch) {
			const cmd = unixMatch[1]!.trim();
			const hint = UNIX_REDIRECT[cmd] ?? 'Use the dedicated tools (read_file, list_dir, search_files) instead.';
			return {
				toolCallId: call.id,
				name: call.name,
				content: `"${cmd}" is a Unix command and will not work on this Windows system. ${hint}`,
				isError: true,
			};
		}
	}

	const isWin = process.platform === 'win32';
	const shell = isWin ? 'powershell.exe' : '/bin/bash';
	const args = isWin
		? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
		: ['-lc', command];

	try {
		const { stdout, stderr } = await execFileAsync(shell, args, {
			cwd: root,
			windowsHide: true,
			maxBuffer: 5 * 1024 * 1024,
			timeout: 120_000,
		});
		let output = '';
		if (stdout) output += stdout;
		if (stderr) output += (output ? '\n--- stderr ---\n' : '') + stderr;
		if (!output.trim()) output = '(command completed with no output)';
		if (output.length > MAX_READ_SIZE) {
			output = output.slice(0, MAX_READ_SIZE) + '\n... (truncated)';
		}
		return { toolCallId: call.id, name: call.name, content: output, isError: false };
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string; message?: string; code?: number };
		let output = '';
		if (err.stdout) output += err.stdout;
		if (err.stderr) output += (output ? '\n--- stderr ---\n' : '') + err.stderr;
		if (!output.trim()) output = err.message ?? String(e);
		if (output.length > MAX_READ_SIZE) {
			output = output.slice(0, MAX_READ_SIZE) + '\n... (truncated)';
		}
		return { toolCallId: call.id, name: call.name, content: `Exit code ${err.code ?? 'unknown'}\n${output}`, isError: true };
	}
}
