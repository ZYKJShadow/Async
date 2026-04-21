import { describe, expect, it } from 'vitest';

import {
	derivePinnedBottomIntent,
	deriveShowScrollToBottomButton,
	measureMessagesScroll,
} from './useMessagesScroll';

describe('useMessagesScroll helpers', () => {
	it('keeps follow-bottom intent during layout growth when the user was already pinned', () => {
		expect(
			derivePinnedBottomIntent(
				true,
				{
					nearBottom: false,
				},
				'layout'
			)
		).toBe(true);
	});

	it('releases follow-bottom intent only when the user scrolls away from the bottom buffer', () => {
		expect(
			derivePinnedBottomIntent(
				true,
				{
					nearBottom: false,
				},
				'user'
			)
		).toBe(false);
	});

	it('hides the jump button while auto-follow is still active, even if content growth temporarily increases the distance', () => {
		expect(
			deriveShowScrollToBottomButton({
				metrics: {
					canJumpToBottom: true,
					distanceFromBottom: 480,
				},
				pinnedBottomIntent: true,
				suppress: false,
			})
		).toBe(false);
	});

	it('measures bottom distance from clamped scroll geometry', () => {
		expect(
			measureMessagesScroll({
				scrollHeight: 1000,
				clientHeight: 400,
				scrollTop: 900,
			})
		).toMatchObject({
			maxScroll: 600,
			clampedTop: 600,
			distanceFromBottom: 0,
			nearBottom: true,
			canJumpToBottom: true,
		});
	});
});
