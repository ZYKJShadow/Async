/** 是否展示卡片正文区（任务标题 + 可选描述）。时间线收起时折叠为单行头，不展示正文区。 */
export function subAgentCardShowBody(hasTimeline: boolean, timelineOpen: boolean): boolean {
	return !hasTimeline || timelineOpen;
}

/** 描述块：无时间线时始终可显；有时间线时仅展开后显示。 */
export function subAgentCardShowDesc(
	detailText: string | undefined,
	hasTimeline: boolean,
	timelineOpen: boolean
): boolean {
	const t = detailText?.trim();
	if (!t) {
		return false;
	}
	return !hasTimeline || timelineOpen;
}

/** 折叠头：一行展示「成员 · 任务标题」。 */
export function subAgentCardCompactHead(hasTimeline: boolean, timelineOpen: boolean): boolean {
	return hasTimeline && !timelineOpen;
}
