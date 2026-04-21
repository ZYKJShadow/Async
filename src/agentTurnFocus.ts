import type { ComposerMode } from './ComposerPlusMenu';
import type { ChatMessage } from './threadTypes';

export const STICKY_USER_SNAP_PX = 12;

export type TurnFocusRow = {
	rowId: string;
	messageIndex: number | null;
	turnOwnerUserIndex: number | null;
	isTurnStart: boolean;
	stickyUserIndex: number | null;
};

export type MeasuredTurnFocusRow = TurnFocusRow & {
	top: number;
	height: number;
	offsetTop: number;
};

export function buildConversationRenderKey(
	threadId: string | null,
	composerMode: ComposerMode
): string {
	return `${threadId ?? 'no-thread'}:${composerMode}`;
}

export function findLatestTurnStartUserIndex(
	displayMessages: ChatMessage[],
	composerMode: ComposerMode,
	hasSupplementalContentAfterUser = false
): number | null {
	if (displayMessages.length === 0) {
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
	if (composerMode === 'team') {
		return hasSupplementalContentAfterUser ? userIndex : null;
	}
	const hasEarlierAssistant = displayMessages
		.slice(0, userIndex)
		.some((message) => message.role === 'assistant');
	return hasEarlierAssistant ? userIndex : null;
}

export function computeTurnSectionSpacerPx(params: {
	viewportHeight: number;
	topPadding: number;
	bottomPadding: number;
	renderedRows: MeasuredTurnFocusRow[];
	activeTurnStartUserIndex: number | null;
}): number {
	const {
		viewportHeight,
		topPadding,
		bottomPadding,
		renderedRows,
		activeTurnStartUserIndex,
	} = params;
	if (viewportHeight <= 0 || activeTurnStartUserIndex == null || renderedRows.length === 0) {
		return 0;
	}
	const activeRow =
		renderedRows.find(
			(row) => row.isTurnStart && row.stickyUserIndex === activeTurnStartUserIndex
		) ?? null;
	const lastRow = renderedRows[renderedRows.length - 1] ?? null;
	if (!activeRow || !lastRow) {
		return 0;
	}
	const activeRowHeight = Math.max(0, activeRow.height);
	const activeBottom = activeRow.offsetTop + activeRowHeight;
	const contentBottom = lastRow.offsetTop + Math.max(0, lastRow.height);
	const belowContentHeight = Math.max(0, contentBottom - activeBottom);
	return Math.max(
		0,
		Math.ceil(
			viewportHeight -
				Math.max(0, topPadding) -
				Math.max(0, bottomPadding) -
				activeRowHeight -
				belowContentHeight
		)
	);
}

export function findStickyUserIndexForViewport(params: {
	renderedRows: MeasuredTurnFocusRow[];
	stickyTopPx: number;
	latestTurnStartUserIndex: number | null;
	latestTurnSpacerPx: number;
}): number | null {
	const { renderedRows, stickyTopPx, latestTurnStartUserIndex, latestTurnSpacerPx } = params;
	const stickyBoundaryPx = stickyTopPx + STICKY_USER_SNAP_PX;
	const turnStartRows = renderedRows.filter(
		(row) => row.isTurnStart && row.stickyUserIndex != null
	);
	const latestTurnRow =
		latestTurnStartUserIndex == null
			? null
			: turnStartRows.find((row) => row.stickyUserIndex === latestTurnStartUserIndex) ?? null;

	/**
	 * 底部停留在“当前轮次”时，最新一轮的 user 气泡需要先获得 sticky 主导权。
	 * 只有当它还没有自然到达顶部之前，才短暂抑制旧轮次接管。
	 */
	if (latestTurnSpacerPx > 0 && latestTurnRow) {
		if (latestTurnRow.top <= stickyBoundaryPx) {
			return latestTurnRow.stickyUserIndex;
		}
		if (latestTurnRow.top < stickyBoundaryPx + Math.max(0, latestTurnRow.height)) {
			return null;
		}
	}

	let activeTurnRow: MeasuredTurnFocusRow | null = null;
	for (const row of turnStartRows) {
		if (row.top <= stickyBoundaryPx) {
			activeTurnRow = row;
			continue;
		}
		break;
	}
	return activeTurnRow?.stickyUserIndex ?? null;
}

export function resolveStickyUserIndex(candidate: number | null): number | null {
	return candidate;
}
