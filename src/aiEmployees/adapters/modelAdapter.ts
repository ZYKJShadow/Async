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

/** 解析员工实际绑定的本地模型并格式化为「模型名 (提供商)」；无可用 id 时返回 null。 */
export function formatEmployeeResolvedModelLabel(params: {
	employee: { id: string; linkedRemoteAgentId?: string | null };
	employeeLocalModelMap?: Record<string, string>;
	agentLocalModelMap?: Record<string, string>;
	defaultModelId?: string;
	modelOptionIdSet: Set<string>;
	modelOptions: LocalModelEntry[];
}): string | null {
	const modelId = resolveEmployeeLocalModelId({
		remoteAgentId: params.employee.linkedRemoteAgentId ?? undefined,
		employeeId: params.employee.id,
		agentLocalModelMap: params.agentLocalModelMap,
		employeeLocalModelMap: params.employeeLocalModelMap,
		defaultModelId: params.defaultModelId,
		modelOptionIds: params.modelOptionIdSet,
	});
	if (!modelId) {
		return null;
	}
	const entry = params.modelOptions.find((m) => m.id === modelId);
	if (entry) {
		return formatLocalModelPickLabel(entry);
	}
	return modelId;
}

export function describeModelRoute(conn: AiEmployeesConnection, modelId: string): string {
	if (!modelId) {
		return 'default';
	}
	return `local:${modelId}@${conn.apiBaseUrl}`;
}

/** Role → recommended model profile (non-binding hint used for UI labels only). */
export type RoleModelRecommendation = {
	/** Short profile label — what the role is best served by. */
	profile: 'fast-reasoning' | 'code-generation' | 'strong-reasoning' | 'system-analysis' | 'code-review';
	/** i18n key for the hint shown next to the model picker. */
	hintKey: string;
	/** Preferred substrings (lowercase) that usually appear in model ids matching the profile. */
	preferredIdFragments: string[];
};

export function getModelRecommendation(roleKey: string | undefined): RoleModelRecommendation | null {
	const key = (roleKey ?? '').trim().toLowerCase();
	switch (key) {
		case 'ceo':
			return {
				profile: 'fast-reasoning',
				hintKey: 'aiEmployees.setup.modelRec.fastReasoning',
				preferredIdFragments: ['haiku', 'mini', 'flash', 'fast', 'nano'],
			};
		case 'frontend':
			return {
				profile: 'code-generation',
				hintKey: 'aiEmployees.setup.modelRec.codeGen',
				preferredIdFragments: ['sonnet', 'coder', 'code', 'gpt-4', 'claude-3-5'],
			};
		case 'backend':
			return {
				profile: 'strong-reasoning',
				hintKey: 'aiEmployees.setup.modelRec.strongReasoning',
				preferredIdFragments: ['opus', 'sonnet', 'gpt-5', 'gpt-4', 'r1', 'deepseek'],
			};
		case 'qa':
			return {
				profile: 'system-analysis',
				hintKey: 'aiEmployees.setup.modelRec.systemAnalysis',
				preferredIdFragments: ['sonnet', 'opus', 'gpt-4', 'deepseek'],
			};
		case 'reviewer':
			return {
				profile: 'code-review',
				hintKey: 'aiEmployees.setup.modelRec.codeReview',
				preferredIdFragments: ['opus', 'sonnet', 'gpt-5', 'gpt-4', 'deepseek', 'r1'],
			};
		default:
			return null;
	}
}

/** Heuristic score (0..1): does a model id look like a good fit for this role? */
export function scoreModelForRole(modelId: string, roleKey: string | undefined): number {
	const rec = getModelRecommendation(roleKey);
	if (!rec) {
		return 0;
	}
	const lower = modelId.toLowerCase();
	const hits = rec.preferredIdFragments.filter((frag) => lower.includes(frag)).length;
	if (hits === 0) {
		return 0;
	}
	return Math.min(1, hits / Math.max(1, rec.preferredIdFragments.length) + 0.25);
}
