import type { ModelRequestParadigm } from './llmProvider';

/** 与主进程 `UserLlmProvider` 对齐 */
export type UserLlmProvider = {
	id: string;
	displayName: string;
	paradigm: ModelRequestParadigm;
	apiKey?: string;
	baseURL?: string;
	proxyUrl?: string;
};

/** 与主进程 `UserModelEntry` 对齐 */
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 16384;

export type UserModelEntry = {
	id: string;
	providerId: string;
	displayName: string;
	requestName: string;
	maxOutputTokens?: number;
	/** 上下文窗口 tokens；与主进程压缩阈值（Claude Code 风格）对齐，可选 */
	contextWindowTokens?: number;
};

function newId(): string {
	return typeof crypto !== 'undefined' && crypto.randomUUID
		? crypto.randomUUID()
		: `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createEmptyUserLlmProvider(): UserLlmProvider {
	return {
		id: newId(),
		displayName: '',
		paradigm: 'openai-compatible',
	};
}

export function createEmptyUserModel(providerId: string): UserModelEntry {
	return {
		id: newId(),
		providerId,
		displayName: '',
		requestName: '',
		maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
	};
}

export function sanitizeEnabledIds(entries: UserModelEntry[], enabledIds: string[] | undefined | null): string[] {
	const valid = new Set(entries.map((e) => e.id));
	return (enabledIds ?? []).filter((id) => valid.has(id));
}

/** 保留历史顺序，并将所有模型 id 纳入启用列表（新模型默认出现在选择器与 Auto 候选中） */
export function mergeEnabledIdsWithAllModels(
	entries: UserModelEntry[],
	preferredOrder: string[] | undefined | null
): string[] {
	const entryIds = entries.map((e) => e.id);
	const want = new Set(entryIds);
	const out: string[] = [];
	for (const id of preferredOrder ?? []) {
		if (want.has(id)) {
			out.push(id);
		}
	}
	for (const id of entryIds) {
		if (!out.includes(id)) {
			out.push(id);
		}
	}
	return out;
}

/** 若 defaultModel 无效、为空或为旧版 `auto`，返回空字符串（须用户显式选择模型） */
export function coerceDefaultModel(
	defaultModel: string | undefined,
	entries: UserModelEntry[],
	enabledIds: string[]
): string {
	const raw = (defaultModel ?? '').trim();
	if (!raw || raw.toLowerCase() === 'auto') {
		return '';
	}
	const en = new Set(enabledIds);
	const exists = entries.some((e) => e.id === raw && en.has(e.id));
	return exists ? raw : '';
}

export function paradigmLabel(p: ModelRequestParadigm): string {
	switch (p) {
		case 'openai-compatible':
			return 'OpenAI 兼容';
		case 'anthropic':
			return 'Anthropic';
		case 'gemini':
			return 'Gemini';
		default:
			return p;
	}
}

export function paradigmForModelEntry(
	entry: UserModelEntry,
	providers: UserLlmProvider[]
): ModelRequestParadigm | undefined {
	return providers.find((p) => p.id === entry.providerId)?.paradigm;
}

export function providerDisplayLabel(providerId: string, providers: UserLlmProvider[]): string {
	const p = providers.find((x) => x.id === providerId);
	const n = p?.displayName?.trim();
	return n || p?.id || '';
}
