import type { ModelRequestParadigm, ShellSettings, UserLlmProvider, UserModelEntry } from '../settingsStore.js';
import { normalizeThinkingLevel, type ThinkingLevel } from './thinkingLevel.js';

export type ResolvedChatModel = {
	requestModelId: string;
	paradigm: ModelRequestParadigm;
};

/** 应用内默认上限；单条模型可覆盖；若网关限制更低请自行调小 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
const MIN_MAX_OUT = 1;
const MAX_MAX_OUT = 128_000;

export type ResolvedModelRequest =
	| {
			ok: true;
			entryId: string;
			requestModelId: string;
			paradigm: ModelRequestParadigm;
			maxOutputTokens: number;
			/** 与 Claude Code 模型上下文对齐；未配置时在 `modelContext` 中解析 */
			contextWindowTokens?: number;
			apiKey: string;
			baseURL?: string;
			/** 仅 OpenAI 兼容：来自提供商的 HTTP 代理 */
			proxyUrl?: string;
	  }
	| { ok: false; message: string };

function entryById(entries: UserModelEntry[], id: string): UserModelEntry | undefined {
	return entries.find((e) => e.id === id);
}

function providerById(providers: UserLlmProvider[], id: string): UserLlmProvider | undefined {
	return providers.find((p) => p.id === id);
}

function isUsable(e: UserModelEntry): boolean {
	return e.requestName.trim().length > 0;
}

export function clampMaxOutputTokens(n: number | undefined): number {
	const v = n ?? DEFAULT_MAX_OUTPUT_TOKENS;
	const floored = Math.floor(v);
	if (!Number.isFinite(floored)) {
		return DEFAULT_MAX_OUTPUT_TOKENS;
	}
	return Math.min(MAX_MAX_OUT, Math.max(MIN_MAX_OUT, floored));
}

function resolveProviderCredentials(
	provider: UserLlmProvider
): { ok: true; apiKey: string; baseURL?: string; proxyUrl?: string } | { ok: false; message: string } {
	if (provider.paradigm === 'openai-compatible') {
		const key = provider.apiKey?.trim() ?? '';
		if (!key) {
			return {
				ok: false,
				message:
					'未配置 OpenAI 兼容 API Key。请在设置 → 模型 → 对应提供商中填写 Base URL 与密钥。',
			};
		}
		const base = provider.baseURL?.trim() || undefined;
		const proxyUrl = provider.proxyUrl?.trim() || undefined;
		return { ok: true, apiKey: key, baseURL: base, proxyUrl };
	}

	if (provider.paradigm === 'anthropic') {
		const key = provider.apiKey?.trim() ?? '';
		if (!key) {
			return {
				ok: false,
				message: '未配置 Anthropic API Key。请在设置 → 模型 → 对应提供商中填写。',
			};
		}
		const base = provider.baseURL?.trim() || undefined;
		return { ok: true, apiKey: key, baseURL: base };
	}

	const key = provider.apiKey?.trim() ?? '';
	if (!key) {
		return {
			ok: false,
			message: '未配置 Google Gemini API Key。请在设置 → 模型 → 对应提供商中填写。',
		};
	}
	return { ok: true, apiKey: key, baseURL: undefined };
}

/**
 * 解析当前选择对应的模型 id、范式、输出上限与有效密钥（含按提供商的连接信息）。
 * @param selectionId 用户模型条目的 id（须非空）
 */
export function resolveModelRequest(settings: ShellSettings, selectionId: string): ResolvedModelRequest {
	const entries = settings.models?.entries ?? [];
	const providers = settings.models?.providers ?? [];
	const enabledIds = settings.models?.enabledIds ?? [];
	const enabledSet = new Set(enabledIds);

	const sid = selectionId.trim().toLowerCase();
	if (!sid || sid === 'auto') {
		return {
			ok: false,
			message:
				'未选择模型。请在输入区选择模型，或在设置 → 模型中添加提供商与模型并选择默认模型。',
		};
	}

	const e = entryById(entries, selectionId);
	if (!e || !enabledSet.has(e.id) || !isUsable(e)) {
		return {
			ok: false,
			message:
				'无法解析当前模型：该模型不存在、未在启用列表中或「请求名称」为空。请在设置 → 模型中检查。',
		};
	}
	const entry = e;

	const prov = providerById(providers, entry.providerId);
	if (!prov) {
		return {
			ok: false,
			message:
				'无法解析当前模型：该模型未关联到有效提供商。请在设置 → 模型中为模型指定提供商，或重新添加提供商。',
		};
	}

	const creds = resolveProviderCredentials(prov);
	if (!creds.ok) {
		return creds;
	}

	const ctx = entry.contextWindowTokens;
	const contextWindowTokens =
		ctx != null && Number.isFinite(ctx) && ctx > 0 ? Math.floor(ctx) : undefined;

	return {
		ok: true,
		entryId: entry.id,
		requestModelId: entry.requestName.trim(),
		paradigm: prov.paradigm,
		maxOutputTokens: clampMaxOutputTokens(entry.maxOutputTokens),
		...(contextWindowTokens != null ? { contextWindowTokens } : {}),
		apiKey: creds.apiKey,
		baseURL: creds.baseURL,
		proxyUrl: creds.proxyUrl,
	};
}

/**
 * @param selectionId 用户模型条目的 id（须非空）
 */
export function resolveChatModel(settings: ShellSettings, selectionId: string): ResolvedChatModel | null {
	const r = resolveModelRequest(settings, selectionId);
	if (!r.ok) {
		return null;
	}
	return { requestModelId: r.requestModelId, paradigm: r.paradigm };
}

/** 按模型选择器当前条目 id 解析思考强度；未选择或旧版 auto 时默认为 medium。 */
export function resolveThinkingLevelForSelection(settings: ShellSettings, selectionId: string): ThinkingLevel {
	const trimmed = String(selectionId ?? '').trim();
	if (!trimmed || trimmed.toLowerCase() === 'auto') {
		return 'medium';
	}
	const raw = settings.models?.thinkingByModelId?.[trimmed];
	return normalizeThinkingLevel(raw != null ? String(raw) : 'medium');
}
