import type { ComposerMode } from './ComposerPlusMenu';
import type { ChatMessage } from './threadTypes';

export const STICKY_USER_SNAP_PX = 12;

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
	renderedRowTops: Array<{ index: number; top: number }>;
	stickyTopPx: number;
}): number | null {
	const { displayMessages, renderedRowTops, stickyTopPx } = params;
	let candidate: number | null = null;
	for (const row of renderedRowTops) {
		if (displayMessages[row.index]?.role !== 'user') {
			continue;
		}
		if (row.top <= stickyTopPx + STICKY_USER_SNAP_PX) {
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
 * 互斥规则：sticky 候选不应与 latest-turn-focus 重合。
 * 最新一轮 user 已经被 spacer 顶到接近视口顶，再加 sticky 包裹会导致重复定位与抖动；
 * 此时返回 null，让 sticky 让位给 spacer。
 */
export function resolveStickyUserIndex(
	candidate: number | null,
	latestTurnFocusUserIndex: number | null
): number | null {
	if (candidate == null) {
		return null;
	}
	if (candidate === latestTurnFocusUserIndex) {
		return null;
	}
	return candidate;
}
