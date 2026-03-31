import type { ComposerMode } from './ComposerPlusMenu';

/** 与 main-src/settingsStore 一致 */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export const THINKING_EFFORT_IDS: Exclude<ThinkingLevel, 'off'>[] = ['low', 'medium', 'high', 'max'];

const ALL_THINKING: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'max'];

export function coerceThinkingLevel(v: unknown): ThinkingLevel {
	const s = typeof v === 'string' ? v.toLowerCase().trim() : 'off';
	if (s === 'minimal') return 'low';
	return ALL_THINKING.includes(s as ThinkingLevel) ? (s as ThinkingLevel) : 'off';
}

export function coerceThinkingByModelId(raw: unknown): Record<string, ThinkingLevel> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {};
	}
	const out: Record<string, ThinkingLevel> = {};
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		out[k] = coerceThinkingLevel(v);
	}
	return out;
}

/** Agent 审阅：主进程解析出的待应用 unified diff 块 */
export type AgentPendingPatch = {
	id: string;
	chunk: string;
	relPath: string | null;
};

export type ChatStreamPayload =
	| { threadId: string; type: 'delta'; text: string }
	| { threadId: string; type: 'done'; text: string; pendingAgentPatches?: AgentPendingPatch[] }
	| { threadId: string; type: 'error'; message: string }
	| { threadId: string; type: 'tool_call'; name: string; args: string }
	| { threadId: string; type: 'tool_result'; name: string; result: string; success: boolean }
	| { threadId: string; type: 'tool_input_delta'; name: string; partialJson: string; index: number }
	| { threadId: string; type: 'thinking_delta'; text: string }
	| {
			threadId: string;
			type: 'tool_approval_request';
			approvalId: string;
			toolName: string;
			command?: string;
			path?: string;
	  };

/** `chat:send` IPC 载荷（与主进程一致） */
export type ChatSendPayload = {
	threadId: string;
	text: string;
	mode?: ComposerMode;
	/** `auto` 或用户模型条目 id */
	modelId?: string;
};

/** `plan:save` IPC 载荷 */
export type PlanSavePayload = {
	filename: string;
	content: string;
};

/** `plan:save` IPC 返回值 */
export type PlanSaveResult = {
	ok: boolean;
	path?: string;
	error?: string;
};
