import { normWorkspaceRootKey } from '../workspaceRootKey';

function uniqueByWorkspaceKey(paths: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const path of paths) {
		const key = normWorkspaceRootKey(path);
		if (!key || seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(path);
	}
	return out;
}

export function selectAgentSidebarThreadPaths(params: {
	orderedPaths: string[];
	hiddenPaths: Iterable<string>;
	currentWorkspace: string | null;
	limit?: number;
}): string[] {
	const currentKey = params.currentWorkspace ? normWorkspaceRootKey(params.currentWorkspace) : null;
	const visible = uniqueByWorkspaceKey(params.orderedPaths);
	if (params.limit == null) {
		return visible;
	}
	const limit = Math.max(1, params.limit);
	const selected = visible.slice(0, limit);
	if (!currentKey || selected.some((path) => normWorkspaceRootKey(path) === currentKey)) {
		return selected;
	}
	const currentPath = visible.find((path) => normWorkspaceRootKey(path) === currentKey) ?? params.currentWorkspace;
	if (!currentPath) {
		return selected;
	}
	if (selected.length < limit) {
		return [...selected, currentPath];
	}
	return [...selected.slice(0, limit - 1), currentPath];
}

export function isAgentWorkspaceCollapsed(path: string, collapsedPaths: Iterable<string>): boolean {
	const key = normWorkspaceRootKey(path);
	for (const collapsedPath of collapsedPaths) {
		if (normWorkspaceRootKey(collapsedPath) === key) {
			return true;
		}
	}
	return false;
}
