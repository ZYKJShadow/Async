import { describe, expect, it } from 'vitest';

import {
	buildConversationRenderKey,
	computeLatestTurnFocusSpacerPx,
	findLatestTurnFocusUserIndex,
	findStickyUserIndexForViewport,
	resolveStickyUserIndex,
} from './agentTurnFocus';
import type { ChatMessage } from './threadTypes';

describe('agentTurnFocus', () => {
	it('targets the latest user turn only when there is earlier replied history', () => {
		const displayMessages: ChatMessage[] = [
			{ role: 'user', content: '第一轮提问' },
			{ role: 'assistant', content: '第一轮回复' },
			{ role: 'user', content: '第二轮提问' },
			{ role: 'assistant', content: '流式中' },
		];

		expect(findLatestTurnFocusUserIndex(displayMessages, 'agent')).toBe(2);
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
			findLatestTurnFocusUserIndex(
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

	it('does not enable turn focus for the first turn or team bootstrapping', () => {
		expect(
			findLatestTurnFocusUserIndex(
				[
					{ role: 'user', content: '第一条消息' },
					{ role: 'assistant', content: '流式中' },
				],
				'ask'
			)
		).toBeNull();

		expect(
			findLatestTurnFocusUserIndex(
				[
					{ role: 'user', content: 'team 消息' },
					{ role: 'assistant', content: '流式中' },
				],
				'team'
			)
		).toBeNull();

		expect(
			findLatestTurnFocusUserIndex(
				[
					{ role: 'user', content: '普通提问' },
					{ role: 'assistant', content: '普通回复' },
				],
				'agent'
			)
		).toBeNull();
	});

	it('computes only the spacer needed to pull the active user turn to the top', () => {
		const spacer = computeLatestTurnFocusSpacerPx({
			viewportHeight: 600,
			topPadding: 8,
			bottomPadding: 100,
			activeRowHeight: 70,
			belowContentHeight: 72,
		});

		expect(spacer).toBe(350);
	});

	it('returns zero when the last user row already fills the available viewport height', () => {
		const spacer = computeLatestTurnFocusSpacerPx({
			viewportHeight: 600,
			topPadding: 8,
			bottomPadding: 100,
			activeRowHeight: 420,
			belowContentHeight: 100,
		});

		expect(spacer).toBe(0);
	});

	it('picks the nearest user message that has crossed the sticky top boundary', () => {
		const displayMessages: ChatMessage[] = [
			{ role: 'user', content: 'u1' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: 'u2' },
			{ role: 'assistant', content: 'a2' },
			{ role: 'user', content: 'u3' },
		];

		expect(
			findStickyUserIndexForViewport({
				displayMessages,
				renderedRowTops: [
					{ index: 0, top: -220 },
					{ index: 1, top: -120 },
					{ index: 2, top: -16 },
					{ index: 3, top: 96 },
					{ index: 4, top: 240 },
				],
				stickyTopPx: 0,
				latestTurnFocusUserIndex: 4,
				latestTurnFocusSpacerPx: 0,
			})
		).toBe(2);
	});

	it('does not activate sticky state before any user bubble reaches the top edge', () => {
		const displayMessages: ChatMessage[] = [
			{ role: 'user', content: 'u1' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: 'u2' },
		];

		expect(
			findStickyUserIndexForViewport({
				displayMessages,
				renderedRowTops: [
					{ index: 0, top: 24 },
					{ index: 1, top: 120 },
					{ index: 2, top: 256 },
				],
				stickyTopPx: 0,
				latestTurnFocusUserIndex: 2,
				latestTurnFocusSpacerPx: 0,
			})
		).toBeNull();
	});

	it('sticks only the latest turn user after it reaches the top boundary when focus spacer is active', () => {
		const displayMessages: ChatMessage[] = [
			{ role: 'user', content: '带图片的第一轮' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: '第二轮提问' },
			{ role: 'assistant', content: 'a2' },
		];

		expect(
			findStickyUserIndexForViewport({
				displayMessages,
				renderedRowTops: [
					{ index: 0, top: -12, height: 104 },
					{ index: 1, top: 92, height: 64 },
					{ index: 2, top: -6, height: 48 },
					{ index: 3, top: 168, height: 72 },
				],
				stickyTopPx: 0,
				latestTurnFocusUserIndex: 2,
				latestTurnFocusSpacerPx: 420,
			})
		).toBe(2);
	});

	it('ignores older user bubbles while latest-turn focus spacer is active', () => {
		const displayMessages: ChatMessage[] = [
			{ role: 'user', content: '旧消息' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: '最新消息' },
			{ role: 'assistant', content: 'a2' },
		];

		expect(
			findStickyUserIndexForViewport({
				displayMessages,
				renderedRowTops: [
					{ index: 0, top: -80, height: 104 },
					{ index: 1, top: 48, height: 64 },
					{ index: 2, top: 28, height: 48 },
					{ index: 3, top: 112, height: 72 },
				],
				stickyTopPx: 0,
				latestTurnFocusUserIndex: 2,
				latestTurnFocusSpacerPx: 320,
			})
		).toBeNull();
	});

	it('lets an older user bubble take over once the latest focused user is no longer naturally at the top', () => {
		const displayMessages: ChatMessage[] = [
			{ role: 'user', content: '带文件的旧消息' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: '最新消息' },
			{ role: 'assistant', content: 'a2' },
		];

		expect(
			findStickyUserIndexForViewport({
				displayMessages,
				renderedRowTops: [
					{ index: 0, top: -36, height: 72 },
					{ index: 1, top: 40, height: 360 },
					{ index: 2, top: 84, height: 48 },
					{ index: 3, top: 156, height: 80 },
				],
				stickyTopPx: 0,
				latestTurnFocusUserIndex: 2,
				latestTurnFocusSpacerPx: 320,
			})
		).toBe(0);
	});

	it('keeps latest-turn sticky after candidate selection even when tail spacer is active', () => {
		expect(resolveStickyUserIndex(2)).toBe(2);
	});

	it('passes through nulls', () => {
		expect(resolveStickyUserIndex(null)).toBeNull();
		expect(resolveStickyUserIndex(1)).toBe(1);
	});
});
