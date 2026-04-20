import { describe, expect, it } from 'vitest';

import {
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
			})
		).toBeNull();
	});

	it('drops sticky candidate when it would overlap with latest-turn focus user', () => {
		expect(resolveStickyUserIndex(2, 2)).toBeNull();
	});

	it('keeps sticky candidate when it differs from latest-turn focus user', () => {
		expect(resolveStickyUserIndex(0, 2)).toBe(0);
	});

	it('passes through nulls', () => {
		expect(resolveStickyUserIndex(null, 2)).toBeNull();
		expect(resolveStickyUserIndex(null, null)).toBeNull();
		expect(resolveStickyUserIndex(1, null)).toBe(1);
	});
});
