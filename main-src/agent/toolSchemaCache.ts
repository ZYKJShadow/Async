import type { AnthropicToolSchema } from '../llm/anthropicBeta.js';
import type { AgentToolDef } from './agentTools.js';

const MAX_SCHEMA_CACHE_ENTRIES = 64;

export type OpenAIToolSchema = {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
		strict?: boolean;
	};
};

type AnthropicToolBaseSchema = Omit<AnthropicToolSchema, 'defer_loading' | 'cache_control'>;

const openAiToolSchemaCache = new Map<string, OpenAIToolSchema[]>();
const anthropicToolSchemaCache = new Map<string, AnthropicToolBaseSchema[]>();

function cacheSet<T>(cache: Map<string, T>, key: string, value: T): T {
	if (cache.has(key)) {
		cache.delete(key);
	}
	cache.set(key, value);
	if (cache.size > MAX_SCHEMA_CACHE_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (typeof oldest === 'string') {
			cache.delete(oldest);
		}
	}
	return value;
}

function normalizeUnknown(value: unknown, parentKey = ''): unknown {
	if (Array.isArray(value)) {
		const items = value.map((item) => normalizeUnknown(item));
		return items;
	}
	if (!value || typeof value !== 'object') {
		return value;
	}
	const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
	if (parentKey !== 'properties') {
		entries.sort(([a], [b]) => a.localeCompare(b));
	}
	return Object.fromEntries(entries.map(([key, item]) => [key, normalizeUnknown(item, key)]));
}

function normalizeAgentToolDef(
	def: AgentToolDef,
	provider: 'openai' | 'anthropic'
): Record<string, unknown> {
	return {
		name: def.name,
		description: def.description,
		parameters: normalizeUnknown(def.parameters),
		strict: def.strict === true,
		eagerInputStreaming: provider === 'anthropic' && def.eagerInputStreaming === true,
		schemaCacheKey: def.schemaCacheKey?.trim() || null,
	};
}

function toolDefsSignature(
	defs: AgentToolDef[],
	provider: 'openai' | 'anthropic'
): string {
	return JSON.stringify(defs.map((def) => normalizeAgentToolDef(def, provider)));
}

function buildOpenAIToolBaseSchemas(defs: AgentToolDef[]): OpenAIToolSchema[] {
	const signature = toolDefsSignature(defs, 'openai');
	const cached = openAiToolSchemaCache.get(signature);
	if (cached) {
		return cached;
	}
	return cacheSet(
		openAiToolSchemaCache,
		signature,
		defs.map((def) => ({
			type: 'function' as const,
			function: {
				name: def.name,
				description: def.description,
				parameters: normalizeUnknown(def.parameters) as Record<string, unknown>,
				...(def.strict === true ? { strict: true } : {}),
			},
		}))
	);
}

function buildAnthropicToolBaseSchemas(defs: AgentToolDef[]): AnthropicToolBaseSchema[] {
	const signature = toolDefsSignature(defs, 'anthropic');
	const cached = anthropicToolSchemaCache.get(signature);
	if (cached) {
		return cached;
	}
	return cacheSet(
		anthropicToolSchemaCache,
		signature,
		defs.map((def): AnthropicToolBaseSchema => ({
			name: def.name,
			description: def.description,
			input_schema: normalizeUnknown(def.parameters) as AnthropicToolBaseSchema['input_schema'],
			...(def.strict === true ? { strict: true } : {}),
			...(def.eagerInputStreaming === true ? { eager_input_streaming: true } : {}),
		}))
	);
}

export function buildOpenAIToolSchemas(defs: AgentToolDef[]): OpenAIToolSchema[] {
	return buildOpenAIToolBaseSchemas(defs);
}

export function buildAnthropicToolSchemas(
	defs: AgentToolDef[],
	options?: {
		deferToolNames?: Iterable<string>;
		includeExperimentalBetaFields?: boolean;
	}
): AnthropicToolSchema[] {
	const base = buildAnthropicToolBaseSchemas(defs);
	const deferNames = new Set(options?.deferToolNames ?? []);
	const includeExperimental = options?.includeExperimentalBetaFields !== false;
	if (!includeExperimental || deferNames.size === 0) {
		return base;
	}
	return base.map((schema) =>
		deferNames.has(schema.name) ? { ...schema, defer_loading: true } : schema
	);
}
