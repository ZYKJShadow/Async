export function resolveMappedWorkspace(root: string | null, map: Record<string, string> | undefined): string {
	if (!root || !map) {
		return '';
	}
	const norm = root.replace(/\\/g, '/').toLowerCase();
	for (const [k, v] of Object.entries(map)) {
		if (k.replace(/\\/g, '/').toLowerCase() === norm) {
			return v;
		}
	}
	return '';
}

export function pickWorkspaceId(
	mapped: { id: string }[],
	currentId: string,
	lastRemote: string | undefined,
	mapId: string
): string {
	if (currentId && mapped.some((w) => w.id === currentId)) {
		return currentId;
	}
	if (lastRemote && mapped.some((w) => w.id === lastRemote)) {
		return lastRemote;
	}
	if (mapId && mapped.some((w) => w.id === mapId)) {
		return mapId;
	}
	return mapped[0].id;
}
