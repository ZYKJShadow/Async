import type { TeamRoleType } from './hooks/useTeamSession';

type Params = {
	roleType: TeamRoleType;
	assignmentKey?: string | null;
	avatarSeed?: string | null;
};

function normalizeToken(value?: string | null): string {
	return String(value ?? '').trim();
}

export function buildTeamAvatarSeed({ roleType, assignmentKey, avatarSeed }: Params): string {
	const normalizedAssignmentKey = normalizeToken(assignmentKey);
	if (normalizedAssignmentKey) {
		return `${roleType}:${normalizedAssignmentKey}`;
	}

	const normalizedAvatarSeed = normalizeToken(avatarSeed);
	if (normalizedAvatarSeed) {
		return normalizedAvatarSeed;
	}

	return `${roleType}:default`;
}
