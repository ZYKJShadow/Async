import type { AgentToolDef, ToolResult } from './agentTools.js';
import { maxResultSizeCharsForTool, persistToolResultToDisk } from './toolResultPersistence.js';
import type { ToolExecutionContext } from './toolExecutor.js';

export type ToolResultReplacementRecord = {
	toolUseId: string;
	toolName: string;
	replacement: string;
	originalSize: number;
};

export type ToolResultReplacementState = {
	seenToolUseIds: string[];
	replacements: ToolResultReplacementRecord[];
};

type BudgetCandidate = {
	index: number;
	result: ToolResult;
	toolDef: AgentToolDef | null;
	size: number;
};

const DEFAULT_TURN_RESULT_BUDGET_CHARS = 200_000;

function normalizeUnique(values: Iterable<string>): string[] {
	return [...new Set(Array.from(values).map((value) => String(value ?? '').trim()).filter(Boolean))].sort((a, b) =>
		a.localeCompare(b)
	);
}

export function normalizeToolResultReplacementState(
	state?: ToolResultReplacementState | null
): ToolResultReplacementState {
	const replacementMap = new Map<string, ToolResultReplacementRecord>();
	for (const record of state?.replacements ?? []) {
		const toolUseId = String(record?.toolUseId ?? '').trim();
		if (!toolUseId) {
			continue;
		}
		replacementMap.set(toolUseId, {
			toolUseId,
			toolName: String(record.toolName ?? '').trim(),
			replacement: String(record.replacement ?? ''),
			originalSize: Math.max(0, Math.floor(Number(record.originalSize ?? 0) || 0)),
		});
	}
	return {
		seenToolUseIds: normalizeUnique(state?.seenToolUseIds ?? []),
		replacements: [...replacementMap.values()].sort((a, b) => a.toolUseId.localeCompare(b.toolUseId)),
	};
}

export function resolveTurnToolResultBudgetChars(): number {
	const raw = Number(process.env.ASYNC_TOOL_RESULT_BUDGET_CHARS ?? DEFAULT_TURN_RESULT_BUDGET_CHARS);
	if (!Number.isFinite(raw) || raw <= 0) {
		return DEFAULT_TURN_RESULT_BUDGET_CHARS;
	}
	return Math.floor(raw);
}

export async function applyTurnToolResultBudget(
	results: ToolResult[],
	toolDefsByName: Map<string, AgentToolDef>,
	state: ToolResultReplacementState,
	execCtx: ToolExecutionContext
): Promise<{
	results: ToolResult[];
	state: ToolResultReplacementState;
}> {
	const normalizedState = normalizeToolResultReplacementState(state);
	const seenIds = new Set(normalizedState.seenToolUseIds);
	const replacementsById = new Map(
		normalizedState.replacements.map((record) => [record.toolUseId, record] as const)
	);
	const adjusted = results.map((result) => ({ ...result }));
	const freshCandidates: BudgetCandidate[] = [];
	let totalChars = 0;

	for (let index = 0; index < adjusted.length; index++) {
		const result = adjusted[index]!;
		const replacement = replacementsById.get(result.toolCallId);
		if (replacement) {
			result.content = replacement.replacement;
			result.structuredContent = undefined;
			totalChars += result.content.length;
			continue;
		}
		totalChars += result.content.length;
		if (seenIds.has(result.toolCallId)) {
			continue;
		}
		const toolDef = toolDefsByName.get(result.name) ?? null;
		const threshold = maxResultSizeCharsForTool(result.name, toolDef);
		if (threshold == null || result.content.length <= threshold) {
			continue;
		}
		freshCandidates.push({
			index,
			result,
			toolDef,
			size: result.content.length,
		});
	}

	const limit = resolveTurnToolResultBudgetChars();
	if (totalChars > limit && freshCandidates.length > 0) {
		const sorted = [...freshCandidates].sort((a, b) => b.size - a.size || a.index - b.index);
		for (const candidate of sorted) {
			if (totalChars <= limit) {
				break;
			}
			try {
				const persisted = await persistToolResultToDisk(candidate.result, execCtx);
				adjusted[candidate.index] = {
					...candidate.result,
					content: persisted.content,
					structuredContent: undefined,
				};
				totalChars = totalChars - candidate.size + persisted.content.length;
				replacementsById.set(candidate.result.toolCallId, {
					toolUseId: candidate.result.toolCallId,
					toolName: candidate.result.name,
					replacement: persisted.content,
					originalSize: persisted.originalSize,
				});
			} catch {
				/* keep original content when persistence fails */
			}
		}
	}

	for (const result of adjusted) {
		seenIds.add(result.toolCallId);
	}

	return {
		results: adjusted,
		state: {
			seenToolUseIds: normalizeUnique(seenIds),
			replacements: [...replacementsById.values()].sort((a, b) => a.toolUseId.localeCompare(b.toolUseId)),
		},
	};
}
