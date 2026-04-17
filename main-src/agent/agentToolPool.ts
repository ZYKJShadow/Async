import type { ComposerMode } from '../llm/composerMode.js';
import { AGENT_TOOLS, agentToolsForComposerMode, type AgentToolDef } from './agentTools.js';
import { getMcpManager } from '../mcp/index.js';

export const TOOL_SEARCH_TOOL_NAME = 'ToolSearch';

export function isDeferredAgentToolName(name: string): boolean {
	return name.startsWith('mcp__');
}

export function isDeferredAgentTool(tool: AgentToolDef): boolean {
	if (tool.alwaysLoad === true) {
		return false;
	}
	if (tool.shouldDefer === true) {
		return true;
	}
	return isDeferredAgentToolName(tool.name);
}

function modeForBaseTools(
	composerMode: ComposerMode
): 'agent' | 'plan' | 'team' {
	return composerMode === 'plan' ? 'plan' : composerMode === 'team' ? 'team' : 'agent';
}

function toolSearchDef(): AgentToolDef | undefined {
	return AGENT_TOOLS.find((tool) => tool.name === TOOL_SEARCH_TOOL_NAME);
}

/** 若工具名以任一前缀开头则剔除（前缀区分大小写，与 Claude deny 规则用法一致） */
export function filterMcpToolsByDenyPrefixes(
	tools: AgentToolDef[],
	denyPrefixes: string[] | undefined
): AgentToolDef[] {
	if (!denyPrefixes?.length) return tools;
	return tools.filter((t) => !denyPrefixes.some((p) => p.length > 0 && t.name.startsWith(p)));
}

/**
 * 合并内置工具与 MCP 动态工具。内置名称优先；MCP 仅挂在 `composerMode === 'agent'`。
 */
export function assembleAgentToolPool(
	composerMode: ComposerMode,
	options?: { mcpToolDenyPrefixes?: string[] }
): AgentToolDef[] {
	const modeForBase = modeForBaseTools(composerMode);
	const base = agentToolsForComposerMode(modeForBase);
	const baseNames = new Set(base.map((d) => d.name));

	if (composerMode !== 'agent' && composerMode !== 'team') {
		return base;
	}

	const mcpRaw = getMcpManager().getAgentTools();
	const mcpFiltered = filterMcpToolsByDenyPrefixes(mcpRaw, options?.mcpToolDenyPrefixes);
	const mcpNoBuiltinCollision = mcpFiltered
		.filter((t) => !baseNames.has(t.name))
		.sort((a, b) => a.name.localeCompare(b.name));

	// 内置顺序在前，与 Claude「built-ins 为前缀」一致；MCP 段按名排序以利缓存稳定
	return [...base, ...mcpNoBuiltinCollision];
}

export function getDeferredAgentToolDefs(fullPool: AgentToolDef[]): AgentToolDef[] {
	return fullPool.filter((tool) => isDeferredAgentTool(tool));
}

export function assembleVisibleAgentToolPool(
	composerMode: ComposerMode,
	options?: {
		mcpToolDenyPrefixes?: string[];
		discoveredDeferredToolNames?: Iterable<string>;
		override?: AgentToolDef[];
		nativeDeferEnabled?: boolean;
	}
): AgentToolDef[] {
	const fullPool =
		options?.override && options.override.length > 0
			? options.override
			: assembleAgentToolPool(composerMode, {
					mcpToolDenyPrefixes: options?.mcpToolDenyPrefixes,
				});
	if (composerMode !== 'agent' && composerMode !== 'team') {
		return fullPool;
	}

	const deferred = getDeferredAgentToolDefs(fullPool);
	const discovered = new Set(options?.discoveredDeferredToolNames ?? []);
	if (options?.nativeDeferEnabled) {
		if (deferred.length === 0) {
			return fullPool.filter((tool) => tool.name !== TOOL_SEARCH_TOOL_NAME);
		}
		const searchTool = toolSearchDef();
		if (!searchTool || fullPool.some((tool) => tool.name === TOOL_SEARCH_TOOL_NAME)) {
			return fullPool;
		}
		const firstDeferredIndex = fullPool.findIndex((tool) => isDeferredAgentTool(tool));
		if (firstDeferredIndex === -1) {
			return [...fullPool, searchTool];
		}
		return [
			...fullPool.slice(0, firstDeferredIndex),
			searchTool,
			...fullPool.slice(firstDeferredIndex),
		];
	}
	const visible = fullPool.filter((tool) => {
		if (tool.name === TOOL_SEARCH_TOOL_NAME) {
			return false;
		}
		return !isDeferredAgentTool(tool) || discovered.has(tool.name);
	});

	if (deferred.length === 0) {
		return visible;
	}

	const searchTool = toolSearchDef();
	if (!searchTool || visible.some((tool) => tool.name === TOOL_SEARCH_TOOL_NAME)) {
		return visible;
	}
	const firstDeferredIndex = visible.findIndex((tool) => isDeferredAgentTool(tool));
	if (firstDeferredIndex === -1) {
		return [...visible, searchTool];
	}
	return [
		...visible.slice(0, firstDeferredIndex),
		searchTool,
		...visible.slice(firstDeferredIndex),
	];
}
