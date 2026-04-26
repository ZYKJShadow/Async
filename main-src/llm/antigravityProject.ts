const LEGACY_ASYNC_PROJECT_RE = /^async-[0-9a-f]{8}$/i;
const LEGACY_RANDOM_PROJECT_RE = /^(useful|bright|swift|calm|bold)-(fuze|wave|spark|flow|core)-[0-9a-f]{5}$/i;

export function isSyntheticAntigravityProjectId(projectId: string | undefined): boolean {
	const trimmed = projectId?.trim() ?? '';
	return LEGACY_ASYNC_PROJECT_RE.test(trimmed) || LEGACY_RANDOM_PROJECT_RE.test(trimmed);
}

export function normalizeAntigravityProjectId(projectId: string | undefined): string {
	const trimmed = projectId?.trim() ?? '';
	return isSyntheticAntigravityProjectId(trimmed) ? '' : trimmed;
}

export function antigravityProjectRequiredMessage(): string {
	return 'Antigravity did not return a valid Google Cloud project id. Please sign in again so project discovery can complete.';
}
