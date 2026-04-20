import type { AgentToolDef } from './agentTools.js';
import type { TeamExpertConfig, TeamRoleType, TeamPresetId, TeamSettings } from '../settingsStore.js';
import {
	buildDefaultCustomTeamExperts,
	inferTeamSource,
} from '../../src/teamPresetCatalog.js';
import { listBuiltinTeamExperts } from './builtinTeamCatalog.js';

export type TeamExpertRuntimeProfile = {
	id: string;
	roleType: TeamRoleType;
	assignmentKey: string;
	name: string;
	summary?: string;
	systemPrompt: string;
	preferredModelId?: string;
	allowedTools?: string[];
};

export type ResolvedTeamExpertProfiles = {
	experts: TeamExpertRuntimeProfile[];
	teamLead: TeamExpertRuntimeProfile | null;
	reviewer: TeamExpertRuntimeProfile | null;
	specialists: TeamExpertRuntimeProfile[];
	planReviewer: TeamExpertRuntimeProfile | null;
	deliveryReviewer: TeamExpertRuntimeProfile | null;
};

function resolveBuiltinPreferredModelId(
	team: Pick<TeamSettings, 'builtinGlobalModelId' | 'builtinExpertModelOverrides'> | undefined,
	expertId: string,
	fallbackModelId?: string
): string | undefined {
	const overrideModelId = team?.builtinExpertModelOverrides?.[expertId]?.trim() || '';
	if (overrideModelId) {
		return overrideModelId;
	}
	const globalModelId = team?.builtinGlobalModelId?.trim() || '';
	if (globalModelId) {
		return globalModelId;
	}
	return fallbackModelId?.trim() || undefined;
}

function normalizeAllowedTools(allowed: string[] | undefined, baseTools: AgentToolDef[]): string[] | undefined {
	if (!Array.isArray(allowed) || allowed.length === 0) {
		return undefined;
	}
	const base = new Set(baseTools.map((t) => t.name));
	const unique = [...new Set(allowed.map((x) => String(x).trim()).filter(Boolean))];
	const filtered = unique.filter((name) => base.has(name));
	return filtered.length > 0 ? filtered : undefined;
}

export function defaultTeamExperts(presetId: TeamPresetId | undefined = 'engineering'): TeamExpertConfig[] {
	void presetId;
	return buildDefaultCustomTeamExperts();
}

function toRuntimeProfile(
	item: TeamExpertConfig,
	baseTools: AgentToolDef[],
	summary?: string
): TeamExpertRuntimeProfile | null {
	const prompt = String(item.systemPrompt ?? '').trim();
	if (!prompt) {
		return null;
	}
	return {
		id: item.id,
		roleType: item.roleType ?? 'custom',
		assignmentKey:
			String(item.assignmentKey ?? '').trim() ||
			(item.roleType === 'custom'
				? String(item.name ?? '')
						.trim()
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, '_')
						.replace(/^_+|_+$/g, '') || item.id
				: item.roleType ?? 'custom'),
		name: String(item.name ?? '').trim() || 'Specialist',
		summary,
		systemPrompt: prompt,
		preferredModelId: item.preferredModelId?.trim() || undefined,
		allowedTools: normalizeAllowedTools(item.allowedTools, baseTools),
	};
}

function resolveOptionalReviewer(
	reviewer: TeamExpertConfig | null | undefined,
	baseTools: AgentToolDef[],
	fallbackModelId?: string
): TeamExpertRuntimeProfile | null {
	if (!reviewer || reviewer.enabled === false) {
		return null;
	}
	const runtime = toRuntimeProfile(reviewer, baseTools);
	if (!runtime) {
		return null;
	}
	if (!runtime.preferredModelId && fallbackModelId?.trim()) {
		runtime.preferredModelId = fallbackModelId.trim();
	}
	return runtime;
}

export function resolveTeamExpertProfiles(
	team: Pick<
		TeamSettings,
		| 'useDefaults'
		| 'experts'
		| 'source'
		| 'presetId'
		| 'builtinGlobalModelId'
		| 'builtinExpertModelOverrides'
		| 'planReviewer'
		| 'deliveryReviewer'
	> | undefined,
	baseTools: AgentToolDef[]
): ResolvedTeamExpertProfiles {
	const source = inferTeamSource(team);
	const configuredExperts =
		source === 'builtin'
			? listBuiltinTeamExperts().map((expert) => ({
					...expert,
					preferredModelId: resolveBuiltinPreferredModelId(team, expert.id, expert.preferredModelId),
				}))
			: Array.isArray(team?.experts)
				? team.experts.map((expert) => ({ ...expert }))
				: buildDefaultCustomTeamExperts();
	const merged = configuredExperts.filter((expert) => expert && expert.enabled !== false);
	const out: TeamExpertRuntimeProfile[] = [];
	for (const item of merged) {
		const runtime = toRuntimeProfile(
			item,
			baseTools,
			'summary' in item && typeof item.summary === 'string' ? item.summary : undefined
		);
		if (runtime) {
			out.push(runtime);
		}
	}
	const teamLead =
		out.find((expert) => expert.assignmentKey === 'team_lead') ??
		out.find((expert) => expert.roleType === 'team_lead') ??
		null;
	const reviewer =
		out.find((expert) => expert.assignmentKey === 'reviewer') ??
		out.find((expert) => expert.assignmentKey === 'code_reviewer') ??
		out.find((expert) => expert.assignmentKey === 'reality_checker') ??
		out.find((expert) => expert.roleType === 'reviewer') ??
		null;
	const defaultPlanReviewer =
		out.find((expert) => expert.assignmentKey === 'code_reviewer') ??
		reviewer;
	const defaultDeliveryReviewer =
		out.find((expert) => expert.assignmentKey === 'reality_checker') ??
		defaultPlanReviewer ??
		reviewer;
	const builtinFallbackModelId = source === 'builtin' ? team?.builtinGlobalModelId?.trim() || undefined : undefined;
	const specialists = out.filter((expert) => expert.id !== teamLead?.id && expert.id !== reviewer?.id);
	return {
		experts: out,
		teamLead,
		reviewer,
		specialists,
		planReviewer:
			resolveOptionalReviewer(team?.planReviewer, baseTools, builtinFallbackModelId) ?? defaultPlanReviewer,
		deliveryReviewer:
			resolveOptionalReviewer(team?.deliveryReviewer, baseTools, builtinFallbackModelId) ?? defaultDeliveryReviewer,
	};
}
