/**
 * 用户可调的「思考强度」：映射到各协议实际参数（Anthropic extended thinking / OpenAI reasoning_effort）。
 * UI 侧 Effort 为 low / medium / high / max；off 表示关闭扩展思考。
 */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'max'];

/** 仅「开启思考」时的档位（用于模型选择器右栏） */
export const THINKING_EFFORT_LEVELS: readonly ThinkingLevel[] = ['low', 'medium', 'high', 'max'];

export function normalizeThinkingLevel(raw: string | undefined | null): ThinkingLevel {
	const s = String(raw ?? 'off').toLowerCase();
	if (s === 'minimal') return 'low';
	return THINKING_LEVELS.includes(s as ThinkingLevel) ? (s as ThinkingLevel) : 'off';
}

/** Anthropic: budget_tokens，须 < max_tokens 且 ≥ 1024 */
export function anthropicThinkingBudget(level: ThinkingLevel): number | null {
	switch (level) {
		case 'off':
			return null;
		case 'low':
			return 4096;
		case 'medium':
			return 8192;
		case 'high':
			return 16_384;
		case 'max':
			return 32_000;
		default:
			return null;
	}
}

/** 含 thinking 时输出上限需大于 budget */
export function anthropicMaxTokensWithThinking(budget: number): number {
	return Math.min(64_000, Math.max(budget + 16_384, 24_576));
}

/**
 * 在用户配置的输出上限与 Anthropic thinking 约束之间取合法 `max_tokens`。
 * 若用户上限过小导致 ≤ budget，则抬到 budget+1024（仍不超过 64k），以满足 API 要求。
 */
export function anthropicEffectiveMaxTokens(thinkBudget: number | null, userCap: number): number {
	const computed = thinkBudget !== null ? anthropicMaxTokensWithThinking(thinkBudget) : userCap;
	let maxTokens = Math.min(computed, userCap);
	if (thinkBudget !== null && maxTokens <= thinkBudget) {
		maxTokens = Math.min(64_000, thinkBudget + 1024);
	}
	return maxTokens;
}

/**
 * Anthropic extended thinking 开启时，API 仅接受 `temperature: 1`。
 * 普通模式继续沿用现有温度策略。
 */
export function anthropicEffectiveTemperature(defaultTemperature: number, thinkBudget: number | null): number {
	return thinkBudget !== null ? 1 : defaultTemperature;
}

export function normalizeUserModelTemperature(raw: unknown): number | undefined {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return undefined;
	}
	if (raw < 0 || raw > 2) {
		return undefined;
	}
	return Math.round(raw * 1000) / 1000;
}

export function resolveRequestedTemperature(
	defaultTemperature: number,
	temperatureMode: 'auto' | 'custom' | undefined,
	customTemperature: number | undefined
): number {
	const normalized = normalizeUserModelTemperature(customTemperature);
	if (temperatureMode === 'custom' && normalized != null) {
		return normalized;
	}
	return defaultTemperature;
}

function isFixedTemperatureOneOpenAIModel(model: string): boolean {
	const m = model.trim().toLowerCase();
	return (
		m.includes('gpt-5') ||
		m.includes('o1') ||
		m.includes('o3') ||
		m.includes('o4')
	);
}

/**
 * 部分 OpenAI / OpenAI-compatible 推理模型（常见如 GPT-5 / o1 / o3 / o4）
 * 在 Chat Completions 兼容接口上仅接受 `temperature: 1`。
 * 其余模型继续沿用调用方给定温度。
 */
export function openAICompatibleEffectiveTemperature(model: string, requestedTemperature: number): number {
	return isFixedTemperatureOneOpenAIModel(model) ? 1 : requestedTemperature;
}

/** OpenAI Chat Completions reasoning_effort（非推理模型会忽略或报错由网关决定） */
export function openAIReasoningEffort(level: ThinkingLevel): 'low' | 'medium' | 'high' | undefined {
	switch (level) {
		case 'off':
			return undefined;
		case 'low':
			return 'low';
		case 'medium':
			return 'medium';
		case 'high':
		case 'max':
			return 'high';
		default:
			return undefined;
	}
}
