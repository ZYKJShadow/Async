/**
 * Agent 实时回合的块级状态：避免依赖整条 streaming 字符串反复 segmentAssistantContentUnified。
 */
import type { TFunction } from './i18n';
import {
	buildStreamingToolSegments,
	finalizeAssistantSegmentsForRender,
	segmentsFromClosedToolRound,
	segmentsFromPendingToolCall,
	type AssistantSegment,
	type StreamingToolPreview,
} from './agentChatSegments';

let blockSeq = 0;
function nextId(prefix: string): string {
	blockSeq += 1;
	return `${prefix}-${blockSeq}`;
}

export type LiveToolPhase = 'streaming_args' | 'running' | 'done';

export type LiveToolBlock = {
	id: string;
	type: 'tool';
	/** OpenAI/Anthropic tool_use id；流式参数阶段可能为空串 */
	toolUseId: string;
	streamIndex: number;
	name: string;
	partialJson: string;
	argsJson: string;
	phase: LiveToolPhase;
	success?: boolean;
	resultText?: string;
};

export type LiveAgentBlock =
	| { id: string; type: 'text'; text: string }
	| { id: string; type: 'thinking'; text: string; sealed?: boolean; startedAt: number; endedAt?: number }
	| { id: string; type: 'sub_agent_delta'; parentToolCallId: string; depth: number; text: string }
	| { id: string; type: 'sub_agent_thinking'; parentToolCallId: string; depth: number; text: string }
	| LiveToolBlock
	| { id: string; type: 'tool_progress'; toolName: string; phase: string; detail?: string };

export type LiveAgentBlocksState = {
	blocks: LiveAgentBlock[];
};

export function createEmptyLiveAgentBlocks(): LiveAgentBlocksState {
	return { blocks: [] };
}

/** 块列表中 afterIndex 之后是否仅有根级 thinking（无工具/子 Agent 等），用于正文与思考交错流式时合并到同一段正文。 */
function onlyThinkingSuffixAfter(blocks: LiveAgentBlock[], afterIndex: number): boolean {
	for (let k = afterIndex + 1; k < blocks.length; k++) {
		if (blocks[k]!.type !== 'thinking') {
			return false;
		}
	}
	return true;
}

function appendRootText(blocks: LiveAgentBlock[], piece: string): LiveAgentBlock[] {
	if (!piece) return blocks;
	const last = blocks[blocks.length - 1];
	if (last?.type === 'text') {
		const copy = blocks.slice(0, -1);
		copy.push({ ...last, text: last.text + piece });
		return copy;
	}
	/**
	 * 思考与正文 IPC 交错时，若仅在「某段正文」与当前末尾之间插入了 thinking 块，
	 * 原先会把后续 delta 落成新的 text 块。每个 text 对应独立 ReactMarkdown + flex 子项，
	 * 在「平滑流式」逐字揭示时会出现一字一行。此处把新正文合并回仍被尾部 thinking「挡住」的上一段 text。
	 */
	for (let i = blocks.length - 1; i >= 0; i--) {
		const b = blocks[i]!;
		if (b.type !== 'text') {
			continue;
		}
		if (!onlyThinkingSuffixAfter(blocks, i)) {
			continue;
		}
		const copy = blocks.slice();
		copy[i] = { ...b, text: b.text + piece };
		return copy;
	}
	return [...blocks, { id: nextId('txt'), type: 'text', text: piece }];
}

const THINKING_SOFT_CHUNK = 180;
const THINKING_HARD_CHUNK = 260;

function shouldSealThinkingChunk(text: string): boolean {
	if (!text.trim()) {
		return false;
	}
	if (text.endsWith('\n\n')) {
		return true;
	}
	const trimmed = text.trimEnd();
	if (trimmed.length < THINKING_SOFT_CHUNK) {
		return false;
	}
	if (/[。！？.!?]$/.test(trimmed)) {
		return true;
	}
	if (/\n$/.test(text)) {
		return true;
	}
	return text.length >= THINKING_HARD_CHUNK && /[\s)]$/.test(text);
}

function appendRootThinking(blocks: LiveAgentBlock[], piece: string): LiveAgentBlock[] {
	if (!piece) return blocks;
	const base = blocks.slice();
	const stamp = Date.now();
	const lastBlock = base[base.length - 1];
	let current =
		lastBlock?.type === 'thinking' && !lastBlock.sealed
			? ({ ...lastBlock } as Extract<LiveAgentBlock, { type: 'thinking' }>)
			: null;

	if (current) {
		base[base.length - 1] = current;
	}

	for (const char of piece) {
		if (!current) {
			current = {
				id: nextId('think'),
				type: 'thinking',
				text: '',
				sealed: false,
				startedAt: stamp,
			};
			base.push(current);
		}
		current.text += char;
		if (shouldSealThinkingChunk(current.text)) {
			current.sealed = true;
			current.endedAt = stamp;
			current = null;
		}
	}

	return base;
}

function closeTrailingRootThinking(blocks: LiveAgentBlock[], endedAt = Date.now()): LiveAgentBlock[] {
	let changed = false;
	const copy = blocks.slice();
	for (let i = copy.length - 1; i >= 0; i -= 1) {
		const block = copy[i];
		if (block?.type !== 'thinking') {
			break;
		}
		if (block.sealed && block.endedAt != null) {
			continue;
		}
		copy[i] = {
			...block,
			sealed: true,
			endedAt: block.endedAt ?? endedAt,
		};
		changed = true;
	}
	return changed ? copy : blocks;
}

function appendSubAgentDelta(
	blocks: LiveAgentBlock[],
	parent: string,
	depth: number,
	piece: string
): LiveAgentBlock[] {
	if (!piece) return blocks;
	const last = blocks[blocks.length - 1];
	if (last?.type === 'sub_agent_delta' && last.parentToolCallId === parent && last.depth === depth) {
		const copy = blocks.slice(0, -1);
		copy.push({ ...last, text: last.text + piece });
		return copy;
	}
	return [...blocks, { id: nextId('sub'), type: 'sub_agent_delta', parentToolCallId: parent, depth, text: piece }];
}

function appendSubAgentThinking(
	blocks: LiveAgentBlock[],
	parent: string,
	depth: number,
	piece: string
): LiveAgentBlock[] {
	if (!piece) return blocks;
	const last = blocks[blocks.length - 1];
	if (last?.type === 'sub_agent_thinking' && last.parentToolCallId === parent && last.depth === depth) {
		const copy = blocks.slice(0, -1);
		copy.push({ ...last, text: last.text + piece });
		return copy;
	}
	return [...blocks, { id: nextId('subt'), type: 'sub_agent_thinking', parentToolCallId: parent, depth, text: piece }];
}

function upsertToolStreaming(blocks: LiveAgentBlock[], index: number, name: string, partialJson: string): LiveAgentBlock[] {
	const i = blocks.findIndex(
		(b): b is LiveToolBlock => b.type === 'tool' && b.streamIndex === index && b.phase === 'streaming_args'
	);
	if (i >= 0) {
		const copy = blocks.slice();
		const cur = copy[i] as LiveToolBlock;
		copy[i] = { ...cur, name, partialJson };
		return copy;
	}
	return [
		...blocks,
		{
			id: nextId('tool'),
			type: 'tool',
			toolUseId: '',
			streamIndex: index,
			name,
			partialJson,
			argsJson: '',
			phase: 'streaming_args' as const,
		},
	];
}

function findToolBlockIndexByUseId(blocks: LiveAgentBlock[], toolUseId: string): number {
	if (!toolUseId) {
		return -1;
	}
	return blocks.findIndex((b): b is LiveToolBlock => b.type === 'tool' && b.toolUseId === toolUseId);
}

function applyToolCallRoot(
	blocks: LiveAgentBlock[],
	name: string,
	argsJson: string,
	toolUseId: string
): LiveAgentBlock[] {
	const existingIdx = findToolBlockIndexByUseId(blocks, toolUseId);
	if (existingIdx >= 0) {
		const copy = blocks.slice();
		const cur = copy[existingIdx] as LiveToolBlock;
		copy[existingIdx] = {
			...cur,
			name,
			argsJson,
			partialJson: argsJson,
			toolUseId: toolUseId || cur.toolUseId,
			phase: cur.phase === 'done' ? 'done' : 'running',
		};
		return copy;
	}

	let idx = -1;
	for (let j = blocks.length - 1; j >= 0; j--) {
		const b = blocks[j];
		if (b?.type === 'tool' && b.phase === 'streaming_args') {
			idx = j;
			break;
		}
	}
	if (idx >= 0) {
		const cur = blocks[idx] as LiveToolBlock;
		const copy = blocks.slice();
		copy[idx] = {
			...cur,
			name,
			argsJson,
			partialJson: argsJson,
			phase: 'running',
			toolUseId: toolUseId || cur.toolUseId,
		};
		return copy;
	}
	return [
		...blocks,
		{
			id: nextId('tool'),
			type: 'tool',
			toolUseId,
			streamIndex: -1,
			name,
			partialJson: argsJson,
			argsJson,
			phase: 'running' as const,
		},
	];
}

function applyToolResultRoot(
	blocks: LiveAgentBlock[],
	toolUseId: string,
	name: string,
	result: string,
	success: boolean
): LiveAgentBlock[] {
	const copy = blocks.slice();
	let j = findToolBlockIndexByUseId(copy, toolUseId);
	if (j < 0) {
		j = copy.findIndex(
			(b): b is LiveToolBlock => b.type === 'tool' && b.phase === 'running' && b.name === name
		);
	}
	if (j < 0) {
		j = copy.findIndex((b): b is LiveToolBlock => b.type === 'tool' && b.phase === 'running');
	}
	if (j >= 0) {
		const cur = copy[j] as LiveToolBlock;
		copy[j] = {
			...cur,
			name: cur.name || name,
			phase: 'done',
			success,
			resultText: result,
			toolUseId: toolUseId || cur.toolUseId,
		};
		return copy;
	}
	return [
		...copy,
		{
			id: nextId('tool'),
			type: 'tool',
			toolUseId: toolUseId || nextId('orphan'),
			streamIndex: -2,
			name,
			partialJson: '',
			argsJson: '{}',
			phase: 'done',
			success,
			resultText: result,
		},
	];
}

export type LiveAgentChatPayload =
	| { type: 'delta'; text: string; parentToolCallId?: string; nestingDepth?: number }
	| { type: 'thinking_delta'; text: string; parentToolCallId?: string; nestingDepth?: number }
	| { type: 'tool_input_delta'; name: string; partialJson: string; index: number; parentToolCallId?: string }
	| { type: 'tool_call'; name: string; args: string; toolCallId: string; parentToolCallId?: string }
	| {
			type: 'tool_result';
			name: string;
			result: string;
			success: boolean;
			toolCallId: string;
			parentToolCallId?: string;
	  }
	| { type: 'tool_progress'; name: string; phase: string; detail?: string; parentToolCallId?: string };

/** 将 IPC 流事件折叠进块列表（根线程；嵌套工具仅 sub_agent 文本进块） */
export function applyLiveAgentChatPayload(
	state: LiveAgentBlocksState,
	payload: LiveAgentChatPayload
): LiveAgentBlocksState {
	let { blocks } = state;
	if (payload.type !== 'thinking_delta' || payload.parentToolCallId) {
		blocks = closeTrailingRootThinking(blocks);
	}

	if (payload.type === 'delta') {
		if (payload.parentToolCallId) {
			blocks = appendSubAgentDelta(blocks, payload.parentToolCallId, payload.nestingDepth ?? 1, payload.text);
		} else {
			blocks = appendRootText(blocks, payload.text);
		}
		return { blocks };
	}

	if (payload.type === 'thinking_delta') {
		if (!payload.parentToolCallId) {
			blocks = appendRootThinking(blocks, payload.text);
			return { blocks };
		}
		blocks = appendSubAgentThinking(blocks, payload.parentToolCallId, payload.nestingDepth ?? 1, payload.text);
		return { blocks };
	}

	if (payload.type === 'tool_input_delta') {
		if (payload.parentToolCallId) return state;
		blocks = upsertToolStreaming(blocks, payload.index, payload.name, payload.partialJson);
		return { blocks };
	}

	if (payload.type === 'tool_call') {
		if (payload.parentToolCallId) return state;
		blocks = applyToolCallRoot(blocks, payload.name, payload.args, payload.toolCallId);
		return { blocks };
	}

	if (payload.type === 'tool_result') {
		if (payload.parentToolCallId) return state;
		blocks = applyToolResultRoot(blocks, payload.toolCallId, payload.name, payload.result, payload.success);
		return { blocks };
	}

	if (payload.type === 'tool_progress') {
		if (payload.parentToolCallId) return state;
		blocks = [
			...blocks,
			{
				id: nextId('prog'),
				type: 'tool_progress',
				toolName: payload.name,
				phase: payload.phase,
				detail: payload.detail,
			},
		];
		return { blocks };
	}

	return state;
}

export function getActiveStreamingToolPreviewFromBlocks(blocks: LiveAgentBlock[]): StreamingToolPreview | null {
	for (let i = blocks.length - 1; i >= 0; i--) {
		const b = blocks[i];
		if (b?.type === 'tool' && b.phase === 'streaming_args' && b.partialJson) {
			return { name: b.name, partialJson: b.partialJson, index: b.streamIndex };
		}
	}
	return null;
}

/**
 * Extract the latest TodoWrite todos from live agent blocks.
 * Scans all tool blocks, returns todos from the last TodoWrite call.
 */
export function extractTodosFromLiveBlocks(
	blocks: LiveAgentBlock[]
): Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }> | null {
	let lastTodos: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }> | null = null;
	for (const b of blocks) {
		if (b.type !== 'tool' || b.name !== 'TodoWrite') continue;
		// 流式参数阶段的 partialJson 常会间歇性 parse 成功但语义错误（误显示已完成等）；只信 tool_call 落盘后的完整 args。
		if (b.phase === 'streaming_args') continue;

		let parsedArgs: Record<string, unknown> = {};
		try {
			parsedArgs = JSON.parse(b.argsJson || b.partialJson || '{}');
		} catch {
			/* ignore */
		}
		const todosRaw = Array.isArray(parsedArgs.todos) ? parsedArgs.todos : [];
		if (todosRaw.length > 0) {
			lastTodos = todosRaw.map((item: Record<string, unknown>, idx: number) => ({
				id: `live-todo-${idx}`,
				content: String(item.content ?? ''),
				status: (['pending', 'in_progress', 'completed'].includes(String(item.status))
					? String(item.status)
					: 'pending') as 'pending' | 'in_progress' | 'completed',
				activeForm: typeof item.activeForm === 'string' ? item.activeForm : undefined,
			}));
		}
	}
	return lastTodos;
}

/** 块列表 → 与 ChatMarkdown 一致的 AssistantSegment[]（不经由整段 content 解析） */
export function liveBlocksToAssistantSegments(blocks: LiveAgentBlock[], t: TFunction): AssistantSegment[] {
	const out: AssistantSegment[] = [];

	for (const b of blocks) {
		if (b.type === 'text' && b.text.trim()) {
			out.push({ type: 'markdown', text: b.text });
		} else if (b.type === 'thinking') {
			out.push({
				type: 'thinking',
				id: b.id,
				text: b.text,
				startedAt: b.startedAt,
				endedAt: b.endedAt,
			});
		} else if (b.type === 'sub_agent_delta') {
			out.push({
				type: 'sub_agent_markdown',
				parentToolCallId: b.parentToolCallId,
				depth: b.depth,
				text: b.text,
				variant: 'text',
			});
		} else if (b.type === 'sub_agent_thinking') {
			out.push({
				type: 'sub_agent_markdown',
				parentToolCallId: b.parentToolCallId,
				depth: b.depth,
				text: b.text,
				variant: 'thinking',
			});
		} else if (b.type === 'tool_progress') {
			const text =
				b.detail != null && b.detail !== ''
					? t('agent.toolProgress.detail', { name: b.toolName, detail: b.detail })
					: b.phase === 'executing'
						? t('agent.toolProgress.executing', { name: b.toolName })
						: `${b.toolName} (${b.phase})`;
			out.push({
				type: 'activity',
				text,
				status: 'info',
			});
		} else if (b.type === 'tool') {
			if (b.name === 'TodoWrite') {
				if (b.phase === 'streaming_args') {
					out.push({
						type: 'activity',
						text: t('agent.toolPending', { name: t('agent.tool.TodoWrite') }),
						status: 'pending',
					});
					continue;
				}
				let parsedArgs: Record<string, unknown> = {};
				try {
					parsedArgs = JSON.parse(b.argsJson || b.partialJson || '{}');
				} catch {
					/* ignore */
				}
				const todosRaw = Array.isArray(parsedArgs.todos) ? parsedArgs.todos : [];
				const todos = todosRaw.map((item: Record<string, unknown>, idx: number) => ({
					id: `live-todo-${idx}`,
					content: String(item.content ?? ''),
					status: (['pending', 'in_progress', 'completed'].includes(String(item.status))
						? String(item.status)
						: 'pending') as 'pending' | 'in_progress' | 'completed',
					activeForm: typeof item.activeForm === 'string' ? item.activeForm : undefined,
				}));
				if (todos.length > 0) {
					out.push({ type: 'plan_todo', todos });
				} else {
					out.push({
						type: 'activity',
						text:
							b.phase === 'running'
								? t('agent.toolPending', { name: t('agent.tool.TodoWrite') })
								: t('agent.todoWrite.updated'),
						status: b.phase === 'running' ? 'pending' : 'success',
					});
				}
				continue;
			}
			if (b.phase === 'streaming_args') {
				out.push(
					...buildStreamingToolSegments(
						{ name: b.name, partialJson: b.partialJson, index: b.streamIndex },
						{ t }
					)
				);
			} else if (b.phase === 'running') {
				out.push(...segmentsFromPendingToolCall(b.name, b.argsJson || b.partialJson || '{}', t));
			} else if (b.phase === 'done') {
				out.push(
					...segmentsFromClosedToolRound(
						b.name,
						b.argsJson || '{}',
						b.resultText ?? '',
						b.success !== false,
						t
					)
				);
			}
		}
	}

	return finalizeAssistantSegmentsForRender(out);
}
