import * as fs from 'node:fs/promises';
import * as path from 'node:path';

function getSkillFilePath(workspaceRoot: string, slug: string): string {
	return path.join(workspaceRoot, '.async', 'skills', slug, 'SKILL.md');
}

/**
 * 记录 Skill 被使用：更新 uses_count 和 last_used。
 */
export async function recordSkillUsage(slug: string, workspaceRoot: string): Promise<void> {
	const skillPath = getSkillFilePath(workspaceRoot, slug);
	try {
		const raw = await fs.readFile(skillPath, 'utf8');
		const updated = raw
			.replace(/uses_count:\s*\d+/, (match) => {
				const count = parseInt(match.replace(/uses_count:\s*/, ''), 10) || 0;
				return `uses_count: ${count + 1}`;
			})
			.replace(/last_used:\s*.*/, `last_used: ${new Date().toISOString()}`);
		await fs.writeFile(skillPath, updated, 'utf8');
	} catch {
		// Skill 文件不存在或非 auto skill，忽略
	}
}

/**
 * 更新 Skill 的 success_rate。
 * 使用指数移动平均：newRate = oldRate * 0.8 + (success ? 1 : 0) * 0.2
 */
export async function updateSkillSuccessRate(
	slug: string,
	workspaceRoot: string,
	success: boolean
): Promise<void> {
	const skillPath = getSkillFilePath(workspaceRoot, slug);
	try {
		const raw = await fs.readFile(skillPath, 'utf8');
		const updated = raw.replace(/success_rate:\s*([\d.]+)/, (_match, p1) => {
			const oldRate = parseFloat(p1) || 1.0;
			const newRate = oldRate * 0.8 + (success ? 1.0 : 0.0) * 0.2;
			return `success_rate: ${Math.round(newRate * 100) / 100}`;
		});
		await fs.writeFile(skillPath, updated, 'utf8');
	} catch {
		// Skill 文件不存在或非 auto skill，忽略
	}
}
