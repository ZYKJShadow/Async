import type { TeamExpertConfig, TeamSettings } from './agentSettingsTypes';
import type { UserModelEntry } from './modelCatalog';
import { buildDefaultCustomTeamExperts, inferTeamSource } from './teamPresetCatalog';

export type TeamModelValidationIssue =
	| {
			kind: 'builtin_global';
			key: 'builtin-global-model';
	  }
	| {
			kind: 'builtin_role';
			key: string;
			expertId: string;
	  }
	| {
			kind: 'role';
			key: string;
			role: TeamExpertConfig;
	  };

function activeTeamExperts(teamSettings: TeamSettings | undefined): TeamExpertConfig[] {
	const extras = [teamSettings?.planReviewer, teamSettings?.deliveryReviewer].filter(
		(role): role is TeamExpertConfig => Boolean(role)
	);
	if (inferTeamSource(teamSettings) === 'builtin') {
		return extras.filter((role) => role.enabled !== false && role.systemPrompt.trim().length > 0);
	}
	const customExperts = Array.isArray(teamSettings?.experts)
		? teamSettings.experts
		: buildDefaultCustomTeamExperts();
	return [...customExperts, ...extras].filter((role) => role.enabled !== false && role.systemPrompt.trim().length > 0);
}

function explicitBuiltinModelIssues(
	teamSettings: TeamSettings | undefined,
	validModelIds: Set<string>
): TeamModelValidationIssue[] {
	if (inferTeamSource(teamSettings) !== 'builtin') {
		return [];
	}
	const issues: TeamModelValidationIssue[] = [];
	const builtinGlobalModelId = teamSettings?.builtinGlobalModelId?.trim() ?? '';
	if (builtinGlobalModelId && !validModelIds.has(builtinGlobalModelId)) {
		issues.push({
			kind: 'builtin_global',
			key: 'builtin-global-model',
		});
	}
	const overrides = teamSettings?.builtinExpertModelOverrides;
	if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
		return issues;
	}
	for (const [expertId, modelId] of Object.entries(overrides)) {
		const normalizedExpertId = String(expertId ?? '').trim();
		const normalizedModelId = String(modelId ?? '').trim();
		if (!normalizedExpertId || !normalizedModelId || validModelIds.has(normalizedModelId)) {
			continue;
		}
		issues.push({
			kind: 'builtin_role',
			key: `builtin-role:${normalizedExpertId}`,
			expertId: normalizedExpertId,
		});
	}
	return issues;
}

export function findTeamRolesMissingModels(
	teamSettings: TeamSettings | undefined,
	modelEntries: UserModelEntry[]
): TeamModelValidationIssue[] {
	const validModelIds = new Set(modelEntries.map((entry) => entry.id));
	const roleIssues = activeTeamExperts(teamSettings)
		.filter((role) => {
			const modelId = role.preferredModelId?.trim() ?? '';
			return modelId.length > 0 && !validModelIds.has(modelId);
		})
		.map<TeamModelValidationIssue>((role) => ({
			kind: 'role',
			key: `role:${role.id}`,
			role,
		}));
	return [...explicitBuiltinModelIssues(teamSettings, validModelIds), ...roleIssues];
}
