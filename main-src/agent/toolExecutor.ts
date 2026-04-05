/**
 * 工具执行引擎 — 接收工具调用并在工作区内安全执行。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getWorkspaceRoot, resolveWorkspacePath, isPathInsideRoot } from '../workspace.js';
import { formatSymbolSearchResults, searchWorkspaceSymbols } from '../workspaceSymbolIndex.js';
import type { ToolCall, ToolResult } from './agentTools.js';
import { TsLspSession } from '../lsp/tsLspSession.js';
import type { AgentLoopOptions, AgentLoopHandlers } from './agentLoop.js';
import type { ShellSettings } from '../settingsStore.js';
import { getMcpManager } from '../mcp/index.js';
import type { McpToolResult } from '../mcp/mcpTypes.js';
import type { NestedAgentStreamEmit } from '../ipc/nestedAgentStream.js';
import { appendSubagentTranscript } from '../threadStore.js';
import { assembleAgentToolPool } from './agentToolPool.js';
import { executeAskPlanQuestionTool } from './planQuestionTool.js';
import type { ComposerMode } from '../llm/composerMode.js';
import { buildSubagentSystemAppend, findConfiguredSubagent, resolveSubagentProfile } from './subagentProfile.js';
import { shouldRunAgentInBackground } from './agentForkPolicy.js';
import { windowsCmdUtf8Prefix, windowsPowerShellUtf8Command } from '../winUtf8.js';
import { ensureAgentMemoryDirExists, loadAgentMemoryPrompt } from './agentMemory.js';
import { buildRelevantMemoryContextBlock } from '../memdir/findRelevantMemories.js';
import { extractMemoriesToDir } from '../services/extractMemories/extractMemories.js';

/** 工具执行器持有的 LSP 会话引用（由 register.ts 通过 setToolLspSession 注入）。 */
let _lspSession: TsLspSession | null = null;

export function setToolLspSession(session: TsLspSession): void {
	_lspSession = session;
}

export type SubAgentBackgroundDonePayload = {
	parentToolCallId: string;
	result: string;
	success: boolean;
};

/** Agent / delegate_task 嵌套子循环上下文（由 register.ts 注入）。 */
let _delegateContext: {
	settings: ShellSettings;
	options: Omit<AgentLoopOptions, 'signal'>;
	parentSignal: AbortSignal;
	nestedEmit?: (evt: NestedAgentStreamEmit) => void;
	threadId: string | null;
	onSubAgentBackgroundDone?: (payload: SubAgentBackgroundDonePayload) => void;
} | null = null;

export function setDelegateContext(
	settings: ShellSettings,
	options: Omit<AgentLoopOptions, 'signal'>,
	parentSignal: AbortSignal,
	nestedEmit?: (evt: NestedAgentStreamEmit) => void,
	threadId?: string | null,
	onSubAgentBackgroundDone?: (payload: SubAgentBackgroundDonePayload) => void
): void {
	_delegateContext = {
		settings,
		options,
		parentSignal,
		nestedEmit,
		threadId: threadId ?? null,
		onSubAgentBackgroundDone,
	};
}

export function clearDelegateContext(): void {
	_delegateContext = null;
}

const DELEGATE_TOOL_ALIASES = new Set(['Agent', 'Task', 'delegate_task']);

function coerceAgentDelegateArgs(call: ToolCall): {
	task: string;
	context: string;
	subagentType?: string;
	runInBackground: boolean;
} {
	const a = call.arguments;
	const task = String(a.task ?? a.prompt ?? a.description ?? '').trim();
	const context = String(a.context ?? '').trim();
	const subagentType = typeof a.subagent_type === 'string' && a.subagent_type.trim() ? a.subagent_type.trim() : undefined;
	const runInBackground = a.run_in_background === true || a.run_in_background === 'true';
	return { task, context, subagentType, runInBackground };
}

const BACKGROUND_AGENT_TOOL_RESULT =
	'[Background] Sub-agent started (Claude Code–style fork). Nested activity streams above; you will get a UI notice when it finishes. / 后台子 Agent 已启动，过程见上方嵌套区域，结束后会弹出提示。';

const execFileAsync = promisify(execFile);

const MAX_READ_SIZE = 200_000;
const MAX_SEARCH_RESULTS = 80;

export type ToolWriteSnapshot = {
	path: string;
	previousContent: string | null;
};

export type ToolAfterWriteSnapshot = {
	path: string;
	previousContent: string | null;
	nextContent: string;
};

export type ToolExecutionHooks = {
	beforeWrite?: (snapshot: ToolWriteSnapshot) => void | Promise<void>;
	afterWrite?: (snapshot: ToolAfterWriteSnapshot) => void | Promise<void>;
};

function formatMcpToolResultForAgent(result: McpToolResult): string {
	const parts: string[] = [];
	for (const block of result.content ?? []) {
		if (block.type === 'text' && block.text != null && block.text !== '') {
			parts.push(block.text);
		} else if (block.type === 'image') {
			parts.push(
				block.data
					? `[image${block.mimeType ? ` ${block.mimeType}` : ''}, base64 ${Math.min(block.data.length, 64)} chars…]`
					: '[image]'
			);
		} else if (block.type === 'resource') {
			parts.push('[resource]');
		} else {
			parts.push(JSON.stringify(block));
		}
	}
	const text = parts.join('\n\n').trim();
	return text || '(empty MCP result)';
}

const MAX_MCP_RESOURCE_LIST_CHARS = 100_000;

async function executeListMcpResources(call: ToolCall): Promise<ToolResult> {
	const filter = String(call.arguments.server ?? '').trim();
	const mgr = getMcpManager();
	const clients = mgr.getConnectedClients();
	let targets = clients;
	if (filter) {
		targets = clients.filter((c) => c.config.id === filter || c.config.name === filter);
		if (targets.length === 0) {
			return {
				toolCallId: call.id,
				name: call.name,
				content: `No connected MCP server matches "${filter}".`,
				isError: true,
			};
		}
	}
	const rows: Array<{
		uri: string;
		name: string;
		server: string;
		mimeType?: string;
		description?: string;
	}> = [];
	for (const c of targets) {
		const st = c.getServerStatus();
		for (const r of st.resources) {
			rows.push({
				uri: r.uri,
				name: r.name,
				server: c.config.name,
				mimeType: r.mimeType,
				description: r.description,
			});
		}
	}
	let text = JSON.stringify(rows, null, 2);
	if (text.length > MAX_MCP_RESOURCE_LIST_CHARS) {
		text = text.slice(0, MAX_MCP_RESOURCE_LIST_CHARS) + '\n... (truncated)';
	}
	return { toolCallId: call.id, name: call.name, content: text || '[]', isError: false };
}

async function executeReadMcpResource(call: ToolCall): Promise<ToolResult> {
	const server = String(call.arguments.server ?? '').trim();
	const uri = String(call.arguments.uri ?? '').trim();
	if (!server || !uri) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'Error: server and uri are required',
			isError: true,
		};
	}
	const client = getMcpManager().getClientByServerRef(server);
	if (!client) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `MCP server not found: ${server}`,
			isError: true,
		};
	}
	if (client.getServerStatus().status !== 'connected') {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `MCP server not connected: ${server}`,
			isError: true,
		};
	}
	try {
		const raw = await client.readResource(uri);
		const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
		const clipped =
			text.length > MAX_READ_SIZE ? text.slice(0, MAX_READ_SIZE) + '\n... (truncated)' : text;
		return { toolCallId: call.id, name: call.name, content: clipped, isError: false };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			toolCallId: call.id,
			name: call.name,
			content: `MCP resources/read failed: ${msg}`,
			isError: true,
		};
	}
}

async function executeMcpAgentTool(call: ToolCall): Promise<ToolResult> {
	try {
		const raw = await getMcpManager().callTool(call.name, call.arguments);
		const content = formatMcpToolResultForAgent(raw);
		return {
			toolCallId: call.id,
			name: call.name,
			content,
			isError: !!raw.isError,
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			toolCallId: call.id,
			name: call.name,
			content: `MCP tool error: ${msg}`,
			isError: true,
		};
	}
}

export type ToolExecutionContext = {
	delegateExecutionDepth?: number;
};

export async function executeTool(
	call: ToolCall,
	hooks: ToolExecutionHooks = {},
	execCtx: ToolExecutionContext = {}
): Promise<ToolResult> {
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
		case 'get_diagnostics':
			return await executeGetDiagnostics(call);
		case 'Agent':
		case 'Task':
		case 'delegate_task':
			return await executeAgentDelegate(call, execCtx);
		case 'ListMcpResourcesTool':
			return await executeListMcpResources(call);
		case 'ReadMcpResourceTool':
			return await executeReadMcpResource(call);
		case 'ask_plan_question':
			return await executeAskPlanQuestionTool(call);
		default:
			if (getMcpManager().isMcpTool(call.name)) {
				return await executeMcpAgentTool(call);
			}
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
	void hooks.afterWrite?.({ path: relPath, previousContent, nextContent: content });

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
	void hooks.afterWrite?.({ path: relPath, previousContent: source, nextContent: patched });

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
		const cmdLine = isWin ? windowsCmdUtf8Prefix(grepCmd) : grepCmd;
		const args = isWin ? ['/d', '/s', '/c', cmdLine] : ['-lc', cmdLine];
		const { stdout } = await execFileAsync(shell, args, {
			cwd: searchDir,
			windowsHide: true,
			maxBuffer: 2 * 1024 * 1024,
			timeout: 30_000,
			encoding: 'utf8',
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
	const psCommand = isWin ? windowsPowerShellUtf8Command(command) : command;
	const args = isWin
		? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCommand]
		: ['-lc', command];

	try {
		const { stdout, stderr } = await execFileAsync(shell, args, {
			cwd: root,
			windowsHide: true,
			maxBuffer: 5 * 1024 * 1024,
			timeout: 120_000,
			encoding: 'utf8',
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

const SEVERITY_LABEL: Record<number, string> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };

async function executeAgentDelegate(call: ToolCall, execCtx: ToolExecutionContext = {}): Promise<ToolResult> {
	const { task, context, subagentType, runInBackground } = coerceAgentDelegateArgs(call);
	if (!task) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'Error: prompt/task is required (use `prompt` or `task`).',
			isError: true,
		};
	}

	if (!_delegateContext) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'Agent tool is not available in this context.',
			isError: true,
		};
	}

	const depth = execCtx.delegateExecutionDepth ?? 0;
	if (depth >= 1) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'Nested Agent calls are not allowed (max nesting depth: 1).',
			isError: true,
		};
	}

	const { runAgentLoop } = await import('./agentLoop.js');
	const subMessages: import('../threadStore.js').ChatMessage[] = [
		{ role: 'user', content: context ? `${task}\n\nContext:\n${context}` : task },
	];

	const parentToolCallId = call.id;
	const nestingDepth = 1;
	const prevCtx = _delegateContext!;
	const emit = prevCtx.nestedEmit;
	const tid = prevCtx.threadId;
	const onBgDone = prevCtx.onSubAgentBackgroundDone;

	const profile = resolveSubagentProfile(subagentType);
	const subComposerMode: ComposerMode = profile === 'explore' ? 'plan' : prevCtx.options.composerMode;
	const subAppend = buildSubagentSystemAppend(prevCtx.settings, subagentType);
	const matchedSubagent = findConfiguredSubagent(prevCtx.settings, subagentType);

	let baseToolDefs = assembleAgentToolPool(subComposerMode, {
		mcpToolDenyPrefixes: prevCtx.settings.mcpToolDenyPrefixes,
	});
	baseToolDefs = baseToolDefs.filter((d) => !DELEGATE_TOOL_ALIASES.has(d.name));

	const childDepth = depth + 1;
	const useBackgroundFork = shouldRunAgentInBackground({
		backgroundForkAgentSetting: prevCtx.settings.agent?.backgroundForkAgent,
		envAsyncAgentBackgroundFork: process.env.ASYNC_AGENT_BACKGROUND_FORK,
		subagentType,
		runInBackground,
	});

	const logTranscript = (chunk: string) => {
		if (tid) {
			appendSubagentTranscript(tid, parentToolCallId, chunk);
		}
	};

	const runSubAgent = async (): Promise<{ output: string; errorMsg: string }> => {
		let output = '';
		let errorMsg = '';
		let agentMemoryAppend = '';
		let agentMemoryDir: string | null = null;
		if (matchedSubagent?.memoryScope && subagentType) {
			try {
				agentMemoryDir = await ensureAgentMemoryDirExists(subagentType, matchedSubagent.memoryScope, getWorkspaceRoot());
				agentMemoryAppend =
					loadAgentMemoryPrompt(subagentType, matchedSubagent.memoryScope, getWorkspaceRoot())?.trim() ?? '';
			} catch {
				agentMemoryAppend = '';
				agentMemoryDir = null;
			}
		}
		let relevantAgentMemories = '';
		if (agentMemoryDir) {
			try {
				const agentQuery = `${task}\n\n${context}`.trim();
				relevantAgentMemories =
					(await buildRelevantMemoryContextBlock({
						query: agentQuery,
						settings: prevCtx.settings,
						modelSelection: prevCtx.options.modelSelection ?? '',
						memoryDirOverride: agentMemoryDir,
						label: 'Relevant agent memories',
					})) ?? '';
			} catch {
				relevantAgentMemories = '';
			}
		}
		const mergedAppend = [
			prevCtx.options.agentSystemAppend?.trim(),
			subAppend?.trim(),
			agentMemoryAppend,
			relevantAgentMemories.trim(),
		]
			.filter(Boolean)
			.join('\n\n');
		const handlers: AgentLoopHandlers = {
			onTextDelta: (text) => {
				output += text;
				logTranscript(text);
				emit?.({
					type: 'delta',
					text,
					parentToolCallId,
					nestingDepth,
				});
			},
			onToolInputDelta: (p) => {
				emit?.({
					type: 'tool_input_delta',
					name: p.name,
					partialJson: p.partialJson,
					index: p.index,
					parentToolCallId,
					nestingDepth,
				});
			},
			onThinkingDelta: (text) => {
				logTranscript(text);
				emit?.({
					type: 'thinking_delta',
					text,
					parentToolCallId,
					nestingDepth,
				});
			},
			onToolCall: (name, args, toolUseId) => {
				const line = `\n[tool] ${name} ${JSON.stringify(args).slice(0, 200)}\n`;
				logTranscript(line);
				emit?.({
					type: 'tool_call',
					name,
					args: JSON.stringify(args),
					toolCallId: toolUseId,
					parentToolCallId,
					nestingDepth,
				});
			},
			onToolResult: (name, result, success, toolUseId) => {
				const line = `\n[result] ${name} success=${success}\n`;
				logTranscript(line);
				emit?.({
					type: 'tool_result',
					name,
					result,
					success,
					toolCallId: toolUseId,
					parentToolCallId,
					nestingDepth,
				});
			},
			onToolProgress: (p) => {
				emit?.({
					type: 'tool_progress',
					name: p.name,
					phase: p.phase,
					detail: p.detail,
					parentToolCallId,
					nestingDepth,
				});
			},
			onDone: () => {},
			onError: (msg) => {
				errorMsg = msg;
			},
		};

		try {
			const baseHooks = prevCtx.options.toolHooks;
			const hooksForSub =
				subComposerMode === 'agent' || !baseHooks
					? baseHooks
					: { ...baseHooks, afterWrite: undefined };
			await runAgentLoop(
				prevCtx.settings,
				subMessages,
				{
					...prevCtx.options,
					signal: prevCtx.parentSignal,
					composerMode: subComposerMode,
					toolPoolOverride: baseToolDefs,
					delegateExecutionDepth: childDepth,
					toolHooks: hooksForSub,
					...(mergedAppend ? { agentSystemAppend: mergedAppend } : {}),
				},
				handlers
			);
			if (!errorMsg && agentMemoryDir) {
				await extractMemoriesToDir({
					memoryDir: agentMemoryDir,
					workspaceRootForEntrypoint: null,
					messages: [
						subMessages[0]!,
						{ role: 'assistant', content: output || '(sub-agent completed with no output)' },
					],
					runtimeModel: {
						requestModelId: prevCtx.options.requestModelId,
						paradigm: prevCtx.options.paradigm,
						requestApiKey: prevCtx.options.requestApiKey,
						requestBaseURL: prevCtx.options.requestBaseURL,
						requestProxyUrl: prevCtx.options.requestProxyUrl,
						thinkingLevel: prevCtx.options.thinkingLevel,
					},
				});
			}
		} catch (e) {
			errorMsg = String(e);
		}
		return { output, errorMsg };
	};

	if (useBackgroundFork) {
		void (async () => {
			const { output, errorMsg } = await runSubAgent();
			onBgDone?.({
				parentToolCallId,
				result: errorMsg ? `Sub-agent error: ${errorMsg}` : output || '(sub-agent completed with no output)',
				success: !errorMsg,
			});
		})();

		return {
			toolCallId: call.id,
			name: call.name,
			content: BACKGROUND_AGENT_TOOL_RESULT,
			isError: false,
		};
	}

	const { output, errorMsg } = await runSubAgent();
	if (errorMsg) {
		return { toolCallId: call.id, name: call.name, content: `Sub-agent error: ${errorMsg}`, isError: true };
	}
	return { toolCallId: call.id, name: call.name, content: output || '(sub-agent completed with no output)', isError: false };
}

async function executeGetDiagnostics(call: ToolCall): Promise<ToolResult> {
	const relPath = String(call.arguments.path ?? '').trim();
	if (!relPath) {
		return { toolCallId: call.id, name: call.name, content: 'Error: path is required', isError: true };
	}

	const ext = path.extname(relPath).toLowerCase();
	if (!['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].includes(ext)) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `Diagnostics are only supported for TypeScript/JavaScript files. Got: ${ext || '(no extension)'}`,
			isError: true,
		};
	}

	if (!_lspSession?.isRunning) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'TypeScript language server is not running. Open a workspace with TypeScript files to start it.',
			isError: true,
		};
	}

	const full = safePath(relPath);
	if (!fs.existsSync(full)) {
		return { toolCallId: call.id, name: call.name, content: `File not found: ${relPath}`, isError: true };
	}

	const text = fs.readFileSync(full, 'utf-8');
	const uri = pathToFileURL(full).href;

	try {
		const items = await _lspSession!.diagnostics(uri, text);
		if (items === null) {
			return {
				toolCallId: call.id,
				name: call.name,
				content: 'Pull diagnostics not supported by the current language server. Try running tsc manually.',
				isError: false,
			};
		}
		if (items.length === 0) {
			return { toolCallId: call.id, name: call.name, content: `No diagnostics found in ${relPath}. The file looks clean.`, isError: false };
		}
		const lines = items.map((d) => {
			const sev = SEVERITY_LABEL[d.severity ?? 1] ?? 'error';
			const line = (d.range.start.line ?? 0) + 1;
			const col = (d.range.start.character ?? 0) + 1;
			return `[${sev}] ${relPath}:${line}:${col} — ${d.message}`;
		});
		return { toolCallId: call.id, name: call.name, content: lines.join('\n'), isError: false };
	} catch (e) {
		return { toolCallId: call.id, name: call.name, content: `Diagnostics error: ${e instanceof Error ? e.message : String(e)}`, isError: true };
	}
}
