import type { ComposerMode } from './ComposerPlusMenu';
import type { ChatMessage } from './threadTypes';

export const STICKY_USER_SNAP_PX = 12;

export function buildConversationRenderKey(
	threadId: string | null,
	composerMode: ComposerMode
): string {
	return `${threadId ?? 'no-thread'}:${composerMode}`;
}

export function findLatestTurnFocusUserIndex(
	displayMessages: ChatMessage[],
	composerMode: ComposerMode
): number | null {
	if (composerMode === 'team' || displayMessages.length === 0) {
		return null;
	}
	let userIndex = -1;
	for (let i = displayMessages.length - 1; i >= 0; i--) {
		if (displayMessages[i]?.role === 'user') {
			userIndex = i;
			break;
		}
	}
	if (userIndex < 0) {
		return null;
	}
	const hasEarlierAssistant = displayMessages
		.slice(0, userIndex)
		.some((message) => message.role === 'assistant');
	return hasEarlierAssistant ? userIndex : null;
}

export function computeLatestTurnFocusSpacerPx(params: {
	viewportHeight: number;
	topPadding: number;
	bottomPadding: number;
	activeRowHeight: number;
	belowContentHeight: number;
}): number {
	const { viewportHeight, topPadding, bottomPadding, activeRowHeight, belowContentHeight } = params;
	if (viewportHeight <= 0) {
		return 0;
	}
	return Math.max(
		0,
		Math.ceil(
			viewportHeight -
				Math.max(0, topPadding) -
				Math.max(0, bottomPadding) -
				Math.max(0, activeRowHeight) -
				Math.max(0, belowContentHeight)
		)
	);
}

export function findStickyUserIndexForViewport(params: {
	displayMessages: ChatMessage[];
	renderedRowTops: Array<{ index: number; top: number; height?: number }>;
	stickyTopPx: number;
	latestTurnFocusUserIndex: number | null;
	latestTurnFocusSpacerPx: number;
}): number | null {
	const {
		displayMessages,
		renderedRowTops,
		stickyTopPx,
		latestTurnFocusUserIndex,
		latestTurnFocusSpacerPx,
	} = params;
	const stickyBoundaryPx = stickyTopPx + STICKY_USER_SNAP_PX;
	const latestRow =
		latestTurnFocusUserIndex == null
			? null
			: renderedRowTops.find((row) => row.index === latestTurnFocusUserIndex) ?? null;

	/**
	 * 当 latest-turn-focus tail spacer 已经启用时，旧 user 气泡不应再来抢 sticky。
	 * 否则像第一轮带图片的高气泡，会在最新一轮还没贴顶前先占住顶部。
	 */
	if (
		latestTurnFocusSpacerPx > 0 &&
		latestTurnFocusUserIndex != null &&
		displayMessages[latestTurnFocusUserIndex]?.role === 'user'
	) {
		if (latestRow) {
			if (latestRow.top <= stickyBoundaryPx) {
				return latestTurnFocusUserIndex;
			}
			const latestRowHeight = Math.max(0, latestRow.height ?? 0);
			if (latestRow.top < stickyBoundaryPx + latestRowHeight) {
				return null;
			}
		}
	}

	let candidate: number | null = null;
	for (const row of renderedRowTops) {
		if (displayMessages[row.index]?.role !== 'user') {
			continue;
		}
		if (row.top <= stickyBoundaryPx) {
			candidate = row.index;
			continue;
		}
		if (candidate != null) {
			break;
		}
	}
	return candidate;
}

/**
 * 保留一个统一出口，便于后续继续收敛 sticky 规则。
 * 当前策略下，经过候选筛选后的最近 user 应直接保留，不再做额外互斥过滤。
 */
export function resolveStickyUserIndex(candidate: number | null): number | null {
	return candidate;
}
