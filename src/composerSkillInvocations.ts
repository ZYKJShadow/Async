import type { ComposerPlusSkillItem } from './ComposerPlusMenu';

export type SkillInvokeMenuItem = ComposerPlusSkillItem;

export function filterSkillInvokeMenuItems(
	items: SkillInvokeMenuItem[],
	query: string
): SkillInvokeMenuItem[] {
	const q = query.trim().toLowerCase();
	if (!q) {
		return [...items];
	}
	return items.filter((item) => {
		const slug = item.slug.trim().toLowerCase();
		const name = item.name.trim().toLowerCase();
		const description = item.description.trim().toLowerCase();
		const hay = `${slug} ${name} ${description}`;
		return slug.startsWith(q) || name.startsWith(q) || hay.includes(q);
	});
}

/**
 * 首段为 `./...` 且光标仍在「skill slug」内时返回查询词（不含 `./`）。
 * plainPrefix：caret 前由 DOM 采样的纯文本前缀，须与首段文本对齐。
 */
export function getLeadingSkillInvokeQuery(firstSegmentText: string, plainPrefix: string): string | null {
	if (!firstSegmentText.startsWith('./') || plainPrefix.length === 0 || !firstSegmentText.startsWith(plainPrefix)) {
		return null;
	}
	const skillToken = firstSegmentText.match(/^\.\/(\S*)/);
	if (!skillToken) {
		return null;
	}
	const tokenEnd = skillToken[0]!.length;
	if (plainPrefix.length > tokenEnd) {
		return null;
	}
	const afterPrefix = plainPrefix.slice(2);
	if (/\s/u.test(afterPrefix)) {
		return null;
	}
	return afterPrefix;
}
