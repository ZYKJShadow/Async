import type { AiEmployeesConnection } from '../api/client';
import type { LocalModelEntry } from '../sessionTypes';

/**
 * 模型路由：解析「员工」实际应使用的本地模型 id（Async Settings → Models）。
 * 远端运行时路由由代理与 runtimes 列表决定，此处不发起网络请求。
 */
export function resolveEmployeeLocalModelId(params: {
	remoteAgentId?: string;
	employeeId?: string;
	agentLocalModelMap: Record<string, string> | undefined;
	employeeLocalModelMap?: Record<string, string> | undefined;
	defaultModelId: string | undefined;
	modelOptionIds: Set<string>;
}): string {
	const { remoteAgentId, employeeId, agentLocalModelMap, employeeLocalModelMap, defaultModelId, modelOptionIds } = params;
	const employeeBound = employeeId ? employeeLocalModelMap?.[employeeId] : undefined;
	if (employeeBound && modelOptionIds.has(employeeBound)) {
		return employeeBound;
	}
	const bound = remoteAgentId ? agentLocalModelMap?.[remoteAgentId] : undefined;
	if (bound && modelOptionIds.has(bound)) {
		return bound;
	}
	if (defaultModelId && modelOptionIds.has(defaultModelId)) {
		return defaultModelId;
	}
	return '';
}

export type LocalModelsState = {
	entries: LocalModelEntry[];
	enabledIds: string[];
	defaultModelId?: string;
};

export function buildModelOptions(local: LocalModelsState): LocalModelEntry[] {
	const { entries, enabledIds } = local;
	if (enabledIds.length > 0) {
		return enabledIds
			.map((id) => entries.find((e) => e.id === id))
			.filter((e): e is LocalModelEntry => !!e);
	}
	return entries;
}

/** 选择器展示：模型名（提供商） */
export function formatLocalModelPickLabel(entry: LocalModelEntry): string {
	const prov = entry.providerDisplayName?.trim();
	if (prov) {
		return `${entry.displayName} (${prov})`;
	}
	return entry.displayName;
}

export function describeModelRoute(conn: AiEmployeesConnection, modelId: string): string {
	if (!modelId) {
		return 'default';
	}
	return `local:${modelId}@${conn.apiBaseUrl}`;
}
