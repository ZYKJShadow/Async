import * as path from 'node:path';

export const AUTO_SKILL_DIR = 'auto';

export function getAutoSkillPath(workspaceRoot?: string | null): string | null {
	const root = workspaceRoot ?? null;
	if (!root) {
		return null;
	}
	return path.join(root, '.async', 'skills', AUTO_SKILL_DIR) + path.sep;
}

export function getAutoSkillFilePath(workspaceRoot: string, slug: string): string {
	return path.join(workspaceRoot, '.async', 'skills', AUTO_SKILL_DIR, slug, 'SKILL.md');
}

export function isAutoSkillPath(filePath: string, workspaceRoot?: string | null): boolean {
	const dir = getAutoSkillPath(workspaceRoot);
	if (!dir) {
		return false;
	}
	const normalizedPath = path.normalize(path.resolve(filePath));
	const normalizedDir = path.normalize(path.resolve(dir));
	if (normalizedPath === normalizedDir) {
		return true;
	}
	const rel = path.relative(normalizedDir, normalizedPath);
	return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
