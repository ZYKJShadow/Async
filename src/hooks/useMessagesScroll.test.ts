import { describe, expect, it } from 'vitest';

import {
	derivePinnedBottomIntent,
	deriveShowScrollToBottomButton,
	measureMessagesScroll,
	resolveContentBottomScroll,
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

	it('resolves the bottom scroll target from the last rendered message row', () => {
		const viewport = {
			scrollHeight: 2000,
			clientHeight: 400,
			scrollTop: 120,
			ownerDocument: {
				defaultView: {
					getComputedStyle: () => ({
						paddingBottom: '96px',
					}),
				},
			},
			getBoundingClientRect: () => ({ top: 100 } as DOMRect),
		} as unknown as HTMLElement;
		const track = {
			querySelectorAll: () =>
				[
					{ getBoundingClientRect: () => ({ bottom: 360 } as DOMRect) },
					{ getBoundingClientRect: () => ({ bottom: 940 } as DOMRect) },
				] as unknown as NodeListOf<HTMLElement>,
		} as unknown as HTMLElement;

		expect(resolveContentBottomScroll(viewport, track)).toBe(656);
	});
});
