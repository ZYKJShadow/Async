const modules = import.meta.glob('@resources/avatars/*.png', {
	eager: true,
	import: 'default',
}) as Record<string, string>;

/** Sorted so build order does not reshuffle indices. */
export const TEAM_ROLE_AVATAR_IMAGE_URLS: string[] = Object.keys(modules)
	.sort((a, b) => a.localeCompare(b))
	.map((k) => modules[k]!);

function fnv1a32(input: string): number {
	let h = 2166136261;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function pickTeamRoleAvatarUrl(seed: string, urls: readonly string[]): string | null {
	if (urls.length === 0) {
		return null;
	}
	const s = seed.trim() || 'default';
	return urls[fnv1a32(s) % urls.length] ?? null;
}
