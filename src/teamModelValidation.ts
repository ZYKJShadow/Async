import type { TeamExpertConfig, TeamSettings } from './agentSettingsTypes';
import type { UserModelEntry } from './modelCatalog';
import { buildTeamPresetExperts } from './teamPresetCatalog';

function activeTeamExperts(teamSettings: TeamSettings | undefined): TeamExpertConfig[] {
	const builtins = teamSettings?.useDefaults === false ? [] : buildTeamPresetExperts(teamSettings?.presetId);
	const custom = (teamSettings?.experts ?? []).filter((role) => role.enabled !== false);
	return [...builtins, ...custom].filter((role) => role.enabled !== false && role.systemPrompt.trim().length > 0);
}

export function findTeamRolesMissingModels(
	teamSettings: TeamSettings | undefined,
	modelEntries: UserModelEntry[]
): TeamExpertConfig[] {
	const validModelIds = new Set(modelEntries.map((entry) => entry.id));
	return activeTeamExperts(teamSettings).filter((role) => {
		const modelId = role.preferredModelId?.trim() ?? '';
		return !modelId || !validModelIds.has(modelId);
	});
}
