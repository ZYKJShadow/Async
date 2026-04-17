/**
 * 模型上下文窗口与「发送前压缩」阈值：
 *
 * - {@link MODEL_CONTEXT_WINDOW_DEFAULT}、{@link COMPACT_MAX_OUTPUT_TOKENS}、{@link getContextWindowForModel}
 *   对应 `claude-code/src/utils/context.ts`
 * - {@link AUTOCOMPACT_BUFFER_TOKENS}、{@link getEffectiveContextWindowSizeForCompress}、{@link getAutoCompactThresholdForSend}
 *   对应 `claude-code/src/services/compact/autoCompact.ts`
 * - {@link getModelCapabilityFromCache}、{@link refreshOpenAiCompatibleModelCapabilitiesCache}
 *   对应 `claude-code/src/utils/model/modelCapabilities.ts`（Async 侧面向 OpenAI 兼容 `GET /v1/models`）
 *
 * 说明：发送端仍用 `chars/4` 粗估与阈值比较；该阈值在「估算 token」语义上与 CC 的 autocompact 阈值对齐。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import OpenAI from 'openai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getSettings, type ModelRequestParadigm } from '../settingsStore.js';
import { applyOpenAIProviderIdentity } from './providerIdentity.js';

// ─── context.ts 对齐常量 ───────────────────────────────────────────────────

/** CC `context.ts`：`MODEL_CONTEXT_WINDOW_DEFAULT` */
export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000;

/** CC `context.ts`：`COMPACT_MAX_OUTPUT_TOKENS`（摘要预留） */
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000;

// ─── autoCompact.ts 对齐常量 ───────────────────────────────────────────────

/** CC `autoCompact.ts`：`AUTOCOMPACT_BUFFER_TOKENS` */
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;

function isEnvTruthy(v: string | undefined): boolean {
	if (!v) return false;
	return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase().trim());
}

/** 对齐 CC `is1mContextDisabled`（env：`CLAUDE_CODE_DISABLE_1M_CONTEXT` → Async 前缀） */
export function is1mContextDisabled(): boolean {
	return isEnvTruthy(process.env.ASYNC_DISABLE_1M_CONTEXT);
}

/** 对齐 CC `has1mContext` */
export function has1mContext(model: string): boolean {
	if (is1mContextDisabled()) {
		return false;
	}
	return /\[1m\]/i.test(model);
}

function getCanonicalName(model: string): string {
	return model.trim().toLowerCase();
}

/** 对齐 CC `modelSupports1M` 中与检测相关的子串规则（精简版） */
export function modelSupports1M(model: string): boolean {
	if (is1mContextDisabled()) {
		return false;
	}
	const canonical = getCanonicalName(model);
	return canonical.includes('claude-sonnet-4') || canonical.includes('opus-4-6');
}

export type ModelContextResolveOpts = {
	/** 用户在模型条目中显式填写的上下文上限（tokens） */
	userContextWindowTokens?: number;
	paradigm?: ModelRequestParadigm;
};

// ─── modelCapabilities 缓存（OpenAI 兼容）────────────────────────────────────

export type ModelCapabilityRecord = {
	id: string;
	max_input_tokens?: number;
};

type CapabilitiesCacheFile = {
	models: ModelCapabilityRecord[];
	timestamp: number;
};

const CAPABILITIES_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function capabilitiesCachePath(): string | null {
	try {
		return join(app.getPath('userData'), '.async', 'cache', 'model-capabilities.json');
	} catch {
		return null;
	}
}

function sortCapabilitiesForMatching(models: ModelCapabilityRecord[]): ModelCapabilityRecord[] {
	return [...models].sort(
		(a, b) => b.id.length - a.id.length || a.id.localeCompare(b.id)
	);
}

/**
 * 对齐 CC `getModelCapability`：同步读本地缓存，按 id 精确或子串匹配。
 */
export function getModelCapabilityFromCache(model: string): ModelCapabilityRecord | undefined {
	const path = capabilitiesCachePath();
	if (!path) {
		return undefined;
	}
	let parsed: CapabilitiesCacheFile;
	try {
		const raw = readFileSync(path, 'utf8');
		parsed = JSON.parse(raw) as CapabilitiesCacheFile;
	} catch {
		return undefined;
	}
	const list = parsed?.models;
	if (!Array.isArray(list) || list.length === 0) {
		return undefined;
	}
	const m = model.toLowerCase();
	const sorted = sortCapabilitiesForMatching(list);
	const exact = sorted.find((c) => c.id.toLowerCase() === m);
	if (exact) {
		return exact;
	}
	return sorted.find((c) => m.includes(c.id.toLowerCase()));
}

const refreshInFlightByKey = new Map<string, Promise<void>>();
const lastRefreshStartByKey = new Map<string, number>();
const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

function refreshKey(baseURL: string, apiKey: string): string {
	return `${baseURL.replace(/\/$/, '')}|${apiKey.slice(0, 8)}`;
}

/**
 * 拉取 OpenAI 兼容 `GET /v1/models`，将返回中的 `context_window`（若存在）写入
 * `max_input_tokens`，持久化到 userData（对齐 CC `refreshModelCapabilities` 思路）。
 */
export async function refreshOpenAiCompatibleModelCapabilitiesCache(params: {
	baseURL?: string;
	apiKey: string;
	proxyUrl?: string;
}): Promise<void> {
	const key = params.apiKey.trim() ? refreshKey(params.baseURL ?? 'https://api.openai.com/v1', params.apiKey) : '';
	if (!key) {
		return;
	}
	const existing = refreshInFlightByKey.get(key);
	if (existing) {
		return existing;
	}
	const p = (async () => {
		let httpAgent: InstanceType<typeof HttpsProxyAgent> | undefined;
		const proxyRaw = params.proxyUrl?.trim();
		if (proxyRaw) {
			try {
				httpAgent = new HttpsProxyAgent(proxyRaw);
			} catch {
				return;
			}
		}
		const client = new OpenAI(
			applyOpenAIProviderIdentity(getSettings(), {
				apiKey: params.apiKey,
				baseURL: params.baseURL?.trim() || undefined,
				httpAgent,
				maxRetries: 0,
				timeout: 45_000,
			})
		);
		const page = await client.models.list();
		const models: ModelCapabilityRecord[] = [];
		for (const row of page.data) {
			const ext = row as unknown as Record<string, unknown>;
			const cw = ext.context_window;
			if (typeof cw === 'number' && cw >= 4096) {
				models.push({ id: row.id, max_input_tokens: cw });
			}
		}
		if (models.length === 0) {
			return;
		}
		const path = capabilitiesCachePath();
		if (!path) {
			return;
		}
		const payload: CapabilitiesCacheFile = {
			models: sortCapabilitiesForMatching(models),
			timestamp: Date.now(),
		};
		try {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
		} catch {
			/* ignore */
		}
	})().finally(() => {
		refreshInFlightByKey.delete(key);
	});
	refreshInFlightByKey.set(key, p);
	return p;
}

/** 在冷却时间内最多触发一次后台刷新；用于 chat 路径不打断主流程 */
export function scheduleRefreshOpenAiModelCapabilitiesIfStale(params: {
	baseURL?: string;
	apiKey: string;
	proxyUrl?: string;
}): void {
	const path = capabilitiesCachePath();
	let stale = true;
	try {
		if (path) {
			const raw = readFileSync(path, 'utf8');
			const parsed = JSON.parse(raw) as CapabilitiesCacheFile;
			if (parsed?.timestamp && Date.now() - parsed.timestamp < CAPABILITIES_STALE_MS) {
				stale = false;
			}
		}
	} catch {
		stale = true;
	}
	if (!stale) {
		return;
	}
	const key = refreshKey(params.baseURL?.trim() || 'https://api.openai.com/v1', params.apiKey);
	const now = Date.now();
	if (now - (lastRefreshStartByKey.get(key) ?? 0) < REFRESH_COOLDOWN_MS) {
		return;
	}
	lastRefreshStartByKey.set(key, now);
	void refreshOpenAiCompatibleModelCapabilitiesCache(params).catch(() => {});
}

// ─── 启发式（无缓存、无用户填写时）──────────────────────────────────────────

function heuristicContextWindowTokens(model: string, paradigm?: ModelRequestParadigm): number | undefined {
	const m = getCanonicalName(model);
	if (paradigm === 'gemini') {
		if (m.includes('2.0') || m.includes('2.5') || m.includes('1.5')) {
			return 1_048_576;
		}
		return 1_000_000;
	}
	if (paradigm === 'anthropic') {
		if (m.includes('claude-3-opus')) {
			return 200_000;
		}
		if (m.includes('claude-3-sonnet') || m.includes('claude-3-haiku')) {
			return 200_000;
		}
		if (m.includes('sonnet-4') || m.includes('opus-4') || m.includes('haiku-4')) {
			return 200_000;
		}
		return 200_000;
	}
	// openai-compatible 常见 id
	if (m.includes('gpt-4o') || m.includes('gpt-4-turbo') || m.includes('o1') || m.includes('o3')) {
		return 128_000;
	}
	if (m.includes('gpt-3.5-turbo')) {
		return 16_385;
	}
	if (m.includes('gpt-4-32k')) {
		return 32_768;
	}
	if (m.includes('gpt-4')) {
		return 8192;
	}
	return undefined;
}

/**
 * 对齐 CC `getContextWindowForModel` 的解析顺序（按 Async 环境裁剪）：
 * 1. `ASYNC_MAX_CONTEXT_TOKENS` 全局覆盖
 * 2. 模型名 `[1m]` → 1M
 * 3. 用户条目 `userContextWindowTokens`
 * 4. 本地能力缓存 `max_input_tokens`（≥100k 时采用，与 CC 一致）
 * 5. 启发式
 * 6. `MODEL_CONTEXT_WINDOW_DEFAULT`
 */
export function getContextWindowForModel(model: string, opts?: ModelContextResolveOpts): number {
	const envMax = process.env.ASYNC_MAX_CONTEXT_TOKENS?.trim();
	if (envMax) {
		const o = parseInt(envMax, 10);
		if (!Number.isNaN(o) && o > 0) {
			return o;
		}
	}

	if (has1mContext(model)) {
		return 1_000_000;
	}

	const u = opts?.userContextWindowTokens;
	if (u != null && Number.isFinite(u) && u > 0) {
		return Math.floor(u);
	}

	const cap = getModelCapabilityFromCache(model);
	if (cap?.max_input_tokens && cap.max_input_tokens >= 100_000) {
		if (cap.max_input_tokens > MODEL_CONTEXT_WINDOW_DEFAULT && is1mContextDisabled()) {
			return MODEL_CONTEXT_WINDOW_DEFAULT;
		}
		return cap.max_input_tokens;
	}

	const h = heuristicContextWindowTokens(model, opts?.paradigm);
	if (h != null) {
		return h;
	}

	return MODEL_CONTEXT_WINDOW_DEFAULT;
}

/**
 * 对齐 CC `getEffectiveContextWindowSize`：`contextWindow - min(maxOutput, COMPACT_MAX_OUTPUT_TOKENS)`，
 * 并支持 `ASYNC_CODE_AUTO_COMPACT_WINDOW` 对窗口再 cap（对齐 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`）。
 */
export function getEffectiveContextWindowSizeForCompress(
	model: string,
	maxOutputTokens: number,
	opts?: ModelContextResolveOpts
): number {
	const reservedTokensForSummary = Math.min(maxOutputTokens, COMPACT_MAX_OUTPUT_TOKENS);
	let contextWindow = getContextWindowForModel(model, opts);
	const autoCompactWindow = process.env.ASYNC_CODE_AUTO_COMPACT_WINDOW?.trim();
	if (autoCompactWindow) {
		const parsed = parseInt(autoCompactWindow, 10);
		if (!Number.isNaN(parsed) && parsed > 0) {
			contextWindow = Math.min(contextWindow, parsed);
		}
	}
	return contextWindow - reservedTokensForSummary;
}

/**
 * 对齐 CC `getAutoCompactThreshold`：`effectiveWindow - AUTOCOMPACT_BUFFER_TOKENS`，
 * 支持 `ASYNC_AUTOCOMPACT_PCT_OVERRIDE`（对齐 `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`）。
 * 若算出的有效窗口过小，做下限钳制，避免负数或极端小模型导致逻辑异常。
 */
export function getAutoCompactThresholdForSend(
	model: string,
	maxOutputTokens: number,
	opts?: ModelContextResolveOpts
): number {
	const effectiveRaw = getEffectiveContextWindowSizeForCompress(model, maxOutputTokens, opts);
	const effectiveContextWindow = Math.max(8192, effectiveRaw);

	const autocompactThreshold = effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS;

	const envPercent = process.env.ASYNC_AUTOCOMPACT_PCT_OVERRIDE?.trim();
	if (envPercent) {
		const parsed = parseFloat(envPercent);
		if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 100) {
			const percentageThreshold = Math.floor(effectiveContextWindow * (parsed / 100));
			return Math.max(2048, Math.min(percentageThreshold, autocompactThreshold));
		}
	}

	return Math.max(2048, autocompactThreshold);
}
