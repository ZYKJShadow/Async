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

export type SubAgentRunResponse =
	| { ok: true; resultText: string; toolLog: AiSubAgentToolEntry[]; collabActions: CollabAction[]; durationMs: number }
	| { ok: false; error: string; toolLog: AiSubAgentToolEntry[]; collabActions: CollabAction[]; durationMs: number };

/**
 * Run one employee agent turn to completion without streaming IPC deltas.
 * Used for delegated sub-agents so the renderer only receives the final payload.
 */
export async function runSubAgentEmployee(
	settings: ShellSettings,
	input: EmployeeChatInput
): Promise<SubAgentRunResponse> {
	const toolLog: AiSubAgentToolEntry[] = [];
	const collabActions: CollabAction[] = [];
	const inflight = new Map<
		string,
		{ name: string; args: Record<string, unknown>; startedAtMs: number; startedAtIso: string }
	>();

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
	}
}
