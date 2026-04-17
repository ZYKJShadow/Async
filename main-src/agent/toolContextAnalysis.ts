import { URL } from 'node:url';
import type { AgentToolDef } from './agentTools.js';
import { buildAnthropicToolSchemas, buildOpenAIToolSchemas } from './toolSchemaCache.js';

export type ToolContextAnalysis = {
	fullToolCount: number;
	visibleToolCount: number;
	deferredToolCount: number;
	fullSchemaChars: number;
	visibleSchemaChars: number;
	deferredSchemaChars: number;
	fullSchemaTokens: number;
	visibleSchemaTokens: number;
	deferredSchemaTokens: number;
	usedExactTokenCount: boolean;
};

export const DEFAULT_NATIVE_DEFER_THRESHOLD_RATIO = 0.1;

function isEnvTruthy(value: string | undefined): boolean {
	if (value == null) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isEnvFalsy(value: string | undefined): boolean {
	if (value == null) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off';
}

function stableEstimateTokens(chars: number): number {
	return Math.ceil(chars / 4);
}

function stableToolSchemaChars(
	provider: 'openai' | 'anthropic',
	tools: AgentToolDef[]
): number {
	if (tools.length === 0) {
		return 0;
	}
	const schemas =
		provider === 'anthropic'
			? buildAnthropicToolSchemas(tools)
			: buildOpenAIToolSchemas(tools);
	return JSON.stringify(schemas).length;
}

export async function analyzeToolContext(options: {
	provider: 'openai' | 'anthropic';
	fullToolPool: AgentToolDef[];
	visibleToolPool: AgentToolDef[];
	deferredToolPool: AgentToolDef[];
	exactDeferredTokenCounter?: (tools: AgentToolDef[]) => Promise<number | null>;
}): Promise<ToolContextAnalysis> {
	const fullSchemaChars = stableToolSchemaChars(options.provider, options.fullToolPool);
	const visibleSchemaChars = stableToolSchemaChars(options.provider, options.visibleToolPool);
	const deferredSchemaChars = stableToolSchemaChars(options.provider, options.deferredToolPool);
	const exactDeferredTokens =
		options.exactDeferredTokenCounter && options.deferredToolPool.length > 0
			? await options.exactDeferredTokenCounter(options.deferredToolPool)
			: null;
	const deferredSchemaTokens =
		exactDeferredTokens != null
			? exactDeferredTokens
			: stableEstimateTokens(deferredSchemaChars);
	return {
		fullToolCount: options.fullToolPool.length,
		visibleToolCount: options.visibleToolPool.length,
		deferredToolCount: options.deferredToolPool.length,
		fullSchemaChars,
		visibleSchemaChars,
		deferredSchemaChars,
		fullSchemaTokens: stableEstimateTokens(fullSchemaChars),
		visibleSchemaTokens: stableEstimateTokens(visibleSchemaChars),
		deferredSchemaTokens,
		usedExactTokenCount: exactDeferredTokens != null,
	};
}

export function modelSupportsAnthropicToolReference(model: string): boolean {
	return !/haiku/i.test(model);
}

function isAnthropicFirstPartyHost(baseURL?: string): boolean {
	const raw = String(baseURL ?? '').trim();
	if (!raw) {
		return true;
	}
	try {
		const host = new URL(raw).hostname.toLowerCase();
		return host === 'api.anthropic.com' || host.endsWith('.anthropic.com');
	} catch {
		return false;
	}
}

export function providerSupportsAnthropicNativeDefer(baseURL?: string): boolean {
	if (isEnvTruthy(process.env.ASYNC_ANTHROPIC_NATIVE_DEFER)) {
		return true;
	}
	if (isEnvFalsy(process.env.ASYNC_ANTHROPIC_NATIVE_DEFER)) {
		return false;
	}
	return isAnthropicFirstPartyHost(baseURL);
}

export function resolveNativeDeferThresholdRatio(): number {
	const raw = Number(process.env.ASYNC_NATIVE_DEFER_THRESHOLD_RATIO ?? DEFAULT_NATIVE_DEFER_THRESHOLD_RATIO);
	if (!Number.isFinite(raw) || raw < 0) {
		return DEFAULT_NATIVE_DEFER_THRESHOLD_RATIO;
	}
	return raw;
}

export function shouldEnableAnthropicNativeDefer(options: {
	model: string;
	baseURL?: string;
	contextWindowTokens?: number;
	analysis: ToolContextAnalysis;
}): boolean {
	if (!providerSupportsAnthropicNativeDefer(options.baseURL)) {
		return false;
	}
	if (!modelSupportsAnthropicToolReference(options.model)) {
		return false;
	}
	const contextWindowTokens = Number(options.contextWindowTokens ?? 0);
	if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
		return options.analysis.deferredToolCount > 0;
	}
	return (
		options.analysis.deferredToolCount > 0 &&
		options.analysis.deferredSchemaTokens >=
			Math.ceil(contextWindowTokens * resolveNativeDeferThresholdRatio())
	);
}
