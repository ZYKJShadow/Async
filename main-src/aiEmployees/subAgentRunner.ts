import type { AiSubAgentToolEntry } from '../../shared/aiEmployeesSettings.js';
import type { EmployeeChatInput } from '../../shared/aiEmployeesPersona.js';
import type { ShellSettings } from '../settingsStore.js';
import { runEmployeeChat, type EmployeeChatHandlers } from './employeeChat.js';
import { isCollabTool, parseCollabAction, type CollabAction } from './collaborationTools.js';

const RESULT_MAX = 2000;
const TOOL_LOG_CAP = 50;

function truncateResult(text: string): string {
	if (text.length <= RESULT_MAX) {
		return text;
	}
	return `${text.slice(0, RESULT_MAX)}\n…[truncated]`;
}

export type AiEmployeesSubAgentEventPayload = {
	requestId: string;
	runId: string;
	jobId: string;
	employeeId: string;
	kind: 'tool_start' | 'tool_end';
	toolName: string;
	summary?: string;
};

export type SubAgentRunResponse =
	| { ok: true; resultText: string; toolLog: AiSubAgentToolEntry[]; collabActions: CollabAction[]; durationMs: number }
	| { ok: false; error: string; toolLog: AiSubAgentToolEntry[]; collabActions: CollabAction[]; durationMs: number };

function shortText(s: string, max: number): string {
	const t = s.trim();
	return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function summarizeToolCall(name: string, args: Record<string, unknown>): string {
	const pickStr = (...keys: string[]) => {
		for (const k of keys) {
			const v = args[k];
			if (typeof v === 'string' && v.trim()) {
				return v.trim();
			}
		}
		return '';
	};
	switch (name) {
		case 'Read': {
			const p = pickStr('file_path', 'path', 'target_file');
			return p ? `${name}: ${shortText(p, 52)}` : name;
		}
		case 'Grep': {
			const pat = pickStr('pattern', 'regex');
			const path = pickStr('path', 'include');
			return pat
				? `${name}: ${shortText(pat, 36)}${path ? ` · ${shortText(path, 28)}` : ''}`
				: name;
		}
		case 'Glob': {
			const pat = pickStr('glob_pattern', 'pattern');
			return pat ? `${name}: ${shortText(pat, 44)}` : name;
		}
		case 'Write':
		case 'Edit': {
			const p = pickStr('file_path', 'path');
			return p ? `${name}: ${shortText(p, 52)}` : name;
		}
		case 'Bash': {
			const cmd = pickStr('command', 'cmd');
			return cmd ? `${name}: ${shortText(cmd.replace(/\s+/g, ' '), 56)}` : name;
		}
		default:
			return name;
	}
}

function createPresenceEmitter(
	emit: ((p: AiEmployeesSubAgentEventPayload) => void) | undefined,
	input: EmployeeChatInput
) {
	const presence = input.subAgentPresence;
	if (!emit || !presence) {
		return {
			toolCall: (_name: string, _args: Record<string, unknown>, _toolUseId: string) => {},
			toolResult: (_name: string, _success: boolean, _toolUseId: string) => {},
			dispose: () => {},
		};
	}
	const base = {
		requestId: input.requestId,
		runId: presence.runId,
		jobId: presence.jobId,
		employeeId: presence.employeeId,
	};
	let pending: { toolName: string; summary: string } | null = null;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const flushPendingStart = () => {
		debounceTimer = null;
		if (!pending) {
			return;
		}
		emit({
			...base,
			kind: 'tool_start',
			toolName: pending.toolName,
			summary: pending.summary,
		});
		pending = null;
	};

	return {
		toolCall(name: string, args: Record<string, unknown>, _toolUseId: string) {
			if (isCollabTool(name)) {
				return;
			}
			pending = { toolName: name, summary: summarizeToolCall(name, args) };
			if (debounceTimer === null) {
				debounceTimer = setTimeout(flushPendingStart, 50);
			}
		},
		toolResult(name: string, _success: boolean, _toolUseId: string) {
			if (isCollabTool(name)) {
				return;
			}
			if (debounceTimer !== null) {
				clearTimeout(debounceTimer);
				debounceTimer = null;
			}
			flushPendingStart();
			emit({
				...base,
				kind: 'tool_end',
				toolName: name,
				summary: name,
			});
		},
		dispose() {
			if (debounceTimer !== null) {
				clearTimeout(debounceTimer);
				debounceTimer = null;
			}
			pending = null;
		},
	};
}

/**
 * Run one employee agent turn to completion without streaming IPC deltas.
 * Used for delegated sub-agents so the renderer only receives the final payload.
 */
export async function runSubAgentEmployee(
	settings: ShellSettings,
	input: EmployeeChatInput,
	emitSubAgentEvent?: (payload: AiEmployeesSubAgentEventPayload) => void
): Promise<SubAgentRunResponse> {
	const toolLog: AiSubAgentToolEntry[] = [];
	const collabActions: CollabAction[] = [];
	const inflight = new Map<
		string,
		{ name: string; args: Record<string, unknown>; startedAtMs: number; startedAtIso: string }
	>();
	const presence = createPresenceEmitter(emitSubAgentEvent, input);

	const started = Date.now();
	let resultText = '';
	/** Agent loop / stream often call `onError` then return without throwing — must not report ok: true. */
	let terminalError: string | undefined;

	const handlers: EmployeeChatHandlers = {
		onDelta: (text) => {
			resultText += text;
		},
		onDone: (text) => {
			if (text.trim()) {
				resultText = text;
			}
		},
		onError: (message: string) => {
			terminalError = message;
		},
		onToolCall: (name, args, toolUseId) => {
			presence.toolCall(name, args, toolUseId);
			inflight.set(toolUseId, {
				name,
				args,
				startedAtMs: Date.now(),
				startedAtIso: new Date().toISOString(),
			});
			if (isCollabTool(name)) {
				const action = parseCollabAction(name, args);
				if (action) {
					collabActions.push(action);
				}
			}
		},
		onToolResult: (name, success, toolUseId, resultPreview) => {
			presence.toolResult(name, success, toolUseId);
			const meta = inflight.get(toolUseId);
			if (!meta) {
				return;
			}
			inflight.delete(toolUseId);
			const durationMs = Date.now() - meta.startedAtMs;
			const entry: AiSubAgentToolEntry = {
				id: toolUseId,
				name: meta.name,
				args: meta.args,
				result: truncateResult(resultPreview ?? ''),
				success,
				startedAtIso: meta.startedAtIso,
				durationMs,
			};
			toolLog.push(entry);
			if (toolLog.length > TOOL_LOG_CAP) {
				toolLog.splice(0, toolLog.length - TOOL_LOG_CAP);
			}
		},
	};

	try {
		await runEmployeeChat(settings, input, handlers);
		if (terminalError) {
			return {
				ok: false,
				error: terminalError,
				toolLog,
				collabActions,
				durationMs: Date.now() - started,
			};
		}
		return {
			ok: true,
			resultText: resultText.trim(),
			toolLog,
			collabActions,
			durationMs: Date.now() - started,
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			error: msg,
			toolLog,
			collabActions,
			durationMs: Date.now() - started,
		};
	} finally {
		presence.dispose();
	}
}
