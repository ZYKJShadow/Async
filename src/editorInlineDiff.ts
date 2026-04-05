import { applyPatch, reversePatch, parsePatch } from 'diff';

export function deriveOriginalContentFromUnifiedDiff(
	modifiedContent: string,
	diff: string | null | undefined
): string | null {
	const raw = String(diff ?? '').trim();
	if (!raw) {
		return null;
	}
	try {
		const patches = parsePatch(raw);
		if (patches.length !== 1 || !Array.isArray(patches[0]?.hunks) || patches[0]!.hunks.length === 0) {
			return null;
		}
		const reversed = reversePatch(patches[0]!);
		const original = applyPatch(modifiedContent, reversed);
		return typeof original === 'string' ? original : null;
	} catch {
		return null;
	}
}
