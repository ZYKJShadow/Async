import { describe, expect, it } from 'vitest';

import {
	buildConversationRenderKey,
	computeTurnSectionSpacerPx,
	findLatestTurnStartUserIndex,
	findStickyUserIndexForViewport,
	resolveStickyUserIndex,
	type MeasuredTurnFocusRow,
} from './agentTurnFocus';
import type { ChatMessage } from './threadTypes';

function row(params: Partial<MeasuredTurnFocusRow> & Pick<MeasuredTurnFocusRow, 'rowId'>): MeasuredTurnFocusRow {
	return {
		rowId: params.rowId,
		messageIndex: params.messageIndex ?? null,
		turnOwnerUserIndex: params.turnOwnerUserIndex ?? null,
		isTurnStart: params.isTurnStart ?? false,
		stickyUserIndex: params.stickyUserIndex ?? null,
		top: params.top ?? 0,
		height: params.height ?? 0,
		offsetTop: params.offsetTop ?? 0,
	};
}

describe('agentTurnFocus', () => {
	it('targets the latest user turn so every new prompt becomes the active sticky anchor', () => {
		const displayMessages: ChatMessage[] = [
			{ role: 'user', content: '第一轮提问' },
			{ role: 'assistant', content: '第一轮回复' },
			{ role: 'user', content: '第二轮提问' },
			{ role: 'assistant', content: '流式中' },
		];

		expect(findLatestTurnStartUserIndex(displayMessages, 'agent')).toBe(2);
	});

	it('uses composer mode in the render key so mode switches reset chat row measurements', () => {
		expect(buildConversationRenderKey('thread-1', 'agent')).toBe('thread-1:agent');
		expect(buildConversationRenderKey('thread-1', 'team')).toBe('thread-1:team');
		expect(buildConversationRenderKey('thread-1', 'agent')).not.toBe(
			buildConversationRenderKey('thread-1', 'team')
		);
	});

	it('keeps turn focus on the latest user message even after a short assistant reply finishes', () => {
		expect(
			findLatestTurnStartUserIndex(
				[
					{ role: 'user', content: '第一轮提问' },
					{ role: 'assistant', content: '第一轮回复' },
					{ role: 'user', content: '第二轮提问' },
					{ role: 'assistant', content: '短回复' },
				],
				'agent'
			)
		).toBe(2);
	});

	it('keeps the first non-team prompt anchored as soon as a user bubble exists', () => {
		// 让第一轮也参与 spacer / sticky 机制：assistant 流式增长时不会再把
		// 用户气泡推出视口或与气泡顶部叠加。
		expect(
			findLatestTurnStartUserIndex(
				[
					{ role: 'user', content: '第一条消息' },
					{ role: 'assistant', content: '流式中' },
				],
				'ask'
			)
		).toBe(0);

		expect(
			findLatestTurnStartUserIndex(
				[
					{ role: 'user', content: '普通提问' },
					{ role: 'assistant', content: '普通回复' },
				],
				'agent'
			)
		).toBe(0);
	});

	it('still skips turn focus for team bootstrapping when no supplemental row appeared yet', () => {
		// team 模式下用户气泡之后会被 leader/plan 卡片接管布局，没有补充行时仍然不锚定。
		expect(
			findLatestTurnStartUserIndex(
				[
					{ role: 'user', content: 'team 消息' },
					{ role: 'assistant', content: '流式中' },
				],
				'team'
			)
		).toBeNull();
	});

	it('allows team mode to keep the latest user bubble in focus once timeline content appears below it', () => {
		expect(
			findLatestTurnStartUserIndex(
				[
					{ role: 'user', content: '我想做一个比羊了个羊还火爆的游戏' },
					{ role: 'assistant', content: '团队正在规划中' },
				],
				'team',
				true
			)
		).toBe(0);
	});

	it('computes only the spacer needed to pull the active turn start to the top', () => {
		const spacer = computeTurnSectionSpacerPx({
			viewportHeight: 600,
			topPadding: 8,
			bottomPadding: 100,
			activeTurnStartUserIndex: 2,
			renderedRows: [
				row({
					rowId: 'u1',
					messageIndex: 0,
					turnOwnerUserIndex: 0,
					isTurnStart: true,
					stickyUserIndex: 0,
					height: 60,
					offsetTop: 0,
				}),
				row({
					rowId: 'a1',
					messageIndex: 1,
					turnOwnerUserIndex: 0,
					height: 160,
					offsetTop: 82,
				}),
				row({
					rowId: 'u2',
					messageIndex: 2,
					turnOwnerUserIndex: 2,
					isTurnStart: true,
					stickyUserIndex: 2,
					height: 70,
					offsetTop: 266,
				}),
				row({
					rowId: 'a2',
					messageIndex: 3,
					turnOwnerUserIndex: 2,
					height: 72,
					offsetTop: 336,
				}),
			],
		});

		expect(spacer).toBe(350);
	});

	it('includes team rows in the active turn section height', () => {
		const spacer = computeTurnSectionSpacerPx({
			viewportHeight: 600,
			topPadding: 8,
			bottomPadding: 100,
			activeTurnStartUserIndex: 2,
			renderedRows: [
				row({
					rowId: 'u2',
					messageIndex: 2,
					turnOwnerUserIndex: 2,
					isTurnStart: true,
					stickyUserIndex: 2,
					height: 70,
					offsetTop: 0,
				}),
				row({
					rowId: 'leader',
					turnOwnerUserIndex: 2,
					height: 72,
					offsetTop: 70,
				}),
				row({
					rowId: 'plan',
					turnOwnerUserIndex: 2,
					height: 180,
					offsetTop: 242,
				}),
			],
		});

		expect(spacer).toBe(70);
	});

	it('returns zero when the active turn already fills the available viewport height', () => {
		const spacer = computeTurnSectionSpacerPx({
			viewportHeight: 600,
			topPadding: 8,
			bottomPadding: 100,
			activeTurnStartUserIndex: 2,
			renderedRows: [
				row({
					rowId: 'u2',
					messageIndex: 2,
					turnOwnerUserIndex: 2,
					isTurnStart: true,
					stickyUserIndex: 2,
					height: 420,
					offsetTop: 0,
				}),
				row({
					rowId: 'a2',
					messageIndex: 3,
					turnOwnerUserIndex: 2,
					height: 100,
					offsetTop: 420,
				}),
			],
		});

		expect(spacer).toBe(0);
	});

	it('picks the nearest turn start that has crossed the sticky top boundary', () => {
		expect(
			findStickyUserIndexForViewport({
				renderedRows: [
					row({
						rowId: 'u1',
						messageIndex: 0,
						turnOwnerUserIndex: 0,
						isTurnStart: true,
						stickyUserIndex: 0,
						top: -220,
						height: 56,
					}),
					row({
						rowId: 'a1',
						messageIndex: 1,
						turnOwnerUserIndex: 0,
						top: -120,
						height: 80,
					}),
					row({
						rowId: 'u2',
						messageIndex: 2,
						turnOwnerUserIndex: 2,
						isTurnStart: true,
						stickyUserIndex: 2,
						top: -16,
						height: 48,
					}),
					row({
						rowId: 'a2',
						messageIndex: 3,
						turnOwnerUserIndex: 2,
						top: 96,
						height: 72,
					}),
					row({
						rowId: 'u3',
						messageIndex: 4,
						turnOwnerUserIndex: 4,
						isTurnStart: true,
						stickyUserIndex: 4,
						top: 240,
						height: 48,
					}),
				],
				stickyTopPx: 0,
				latestTurnStartUserIndex: 4,
				latestTurnSpacerPx: 0,
			})
		).toBe(2);
	});

	it('does not activate sticky state before any turn start reaches the top edge', () => {
		expect(
			findStickyUserIndexForViewport({
				renderedRows: [
					row({
						rowId: 'u1',
						messageIndex: 0,
						turnOwnerUserIndex: 0,
						isTurnStart: true,
						stickyUserIndex: 0,
						top: 24,
						height: 48,
					}),
					row({
						rowId: 'a1',
						messageIndex: 1,
						turnOwnerUserIndex: 0,
						top: 120,
						height: 72,
					}),
					row({
						rowId: 'u2',
						messageIndex: 2,
						turnOwnerUserIndex: 2,
						isTurnStart: true,
						stickyUserIndex: 2,
						top: 256,
						height: 48,
					}),
				],
				stickyTopPx: 0,
				latestTurnStartUserIndex: 2,
				latestTurnSpacerPx: 0,
			})
		).toBeNull();
	});

	it('sticks only the latest turn user after it reaches the top boundary when turn spacer is active', () => {
		expect(
			findStickyUserIndexForViewport({
				renderedRows: [
					row({
						rowId: 'u1',
						messageIndex: 0,
						turnOwnerUserIndex: 0,
						isTurnStart: true,
						stickyUserIndex: 0,
						top: -12,
						height: 104,
					}),
					row({
						rowId: 'a1',
						messageIndex: 1,
						turnOwnerUserIndex: 0,
						top: 92,
						height: 64,
					}),
					row({
						rowId: 'u2',
						messageIndex: 2,
						turnOwnerUserIndex: 2,
						isTurnStart: true,
						stickyUserIndex: 2,
						top: -6,
						height: 48,
					}),
					row({
						rowId: 'plan',
						turnOwnerUserIndex: 2,
						top: 42,
						height: 126,
					}),
				],
				stickyTopPx: 0,
				latestTurnStartUserIndex: 2,
				latestTurnSpacerPx: 420,
			})
		).toBe(2);
	});

	it('ignores older turn starts while the latest focused turn is still approaching the top', () => {
		expect(
			findStickyUserIndexForViewport({
				renderedRows: [
					row({
						rowId: 'u1',
						messageIndex: 0,
						turnOwnerUserIndex: 0,
						isTurnStart: true,
						stickyUserIndex: 0,
						top: -80,
						height: 104,
					}),
					row({
						rowId: 'a1',
						messageIndex: 1,
						turnOwnerUserIndex: 0,
						top: 48,
						height: 64,
					}),
					row({
						rowId: 'u2',
						messageIndex: 2,
						turnOwnerUserIndex: 2,
						isTurnStart: true,
						stickyUserIndex: 2,
						top: 28,
						height: 48,
					}),
					row({
						rowId: 'team-plan',
						turnOwnerUserIndex: 2,
						top: 76,
						height: 112,
					}),
				],
				stickyTopPx: 0,
				latestTurnStartUserIndex: 2,
				latestTurnSpacerPx: 320,
			})
		).toBeNull();
	});

	it('lets an older turn take over once the latest focused turn is no longer near the top boundary', () => {
		expect(
			findStickyUserIndexForViewport({
				renderedRows: [
					row({
						rowId: 'u1',
						messageIndex: 0,
						turnOwnerUserIndex: 0,
						isTurnStart: true,
						stickyUserIndex: 0,
						top: -36,
						height: 72,
					}),
					row({
						rowId: 'a1',
						messageIndex: 1,
						turnOwnerUserIndex: 0,
						top: 40,
						height: 360,
					}),
					row({
						rowId: 'u2',
						messageIndex: 2,
						turnOwnerUserIndex: 2,
						isTurnStart: true,
						stickyUserIndex: 2,
						top: 84,
						height: 48,
					}),
					row({
						rowId: 'task-card',
						turnOwnerUserIndex: 2,
						top: 132,
						height: 80,
					}),
				],
				stickyTopPx: 0,
				latestTurnStartUserIndex: 2,
				latestTurnSpacerPx: 320,
			})
		).toBe(0);
	});

	it('keeps sticky output after candidate selection', () => {
		expect(resolveStickyUserIndex(2)).toBe(2);
	});

	it('passes through nulls', () => {
		expect(resolveStickyUserIndex(null)).toBeNull();
		expect(resolveStickyUserIndex(1)).toBe(1);
	});
});
