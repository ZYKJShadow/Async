const STORAGE_KEY = 'void-shell:terminal:recent-profile-ids-v1';
const MAX_RECENT = 12;

export function readRecentTerminalProfileIds(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed
			.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
			.slice(0, MAX_RECENT);
	} catch {
		return [];
	}
}

export function rememberTerminalProfileLaunch(profileId: string): void {
	const id = profileId.trim();
	if (!id) {
		return;
	}
	const prev = readRecentTerminalProfileIds().filter((x) => x !== id);
	prev.unshift(id);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(prev.slice(0, MAX_RECENT)));
	} catch {
		/* ignore quota / private mode */
	}
}

export function clearRecentTerminalProfileIds(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* ignore */
	}
}
