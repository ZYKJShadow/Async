import type { TeamRoleType } from './agentSettingsTypes';

export type BuiltinTeamExpertSummary = {
	id: string;
	name: string;
	roleType: TeamRoleType;
	assignmentKey: string;
	summary?: string;
	category: string;
	sourceRelPath: string;
};

export type BuiltinTeamCatalogPayload =
	| {
			ok: true;
			repoPath: string;
			experts: BuiltinTeamExpertSummary[];
			loadedAt: number;
	  }
	| {
			ok: false;
			repoPath: string;
			experts: BuiltinTeamExpertSummary[];
			error: string;
			loadedAt: number;
	  };
