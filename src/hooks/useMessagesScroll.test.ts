import { describe, expect, it } from 'vitest';

import {
	derivePinnedBottomIntent,
	deriveShowScrollToBottomButton,
	measureMessagesScroll,
	resolveContentBottomScroll,
} from './useMessagesScroll';

function fakeTrackWithDataRows(
	rows: Array<{
		dataset: Record<string, string | undefined>;
		rect: Partial<DOMRect>;
	}>
): HTMLElement {
	return {
		querySelectorAll: (selector: string) =>
			rows
				.filter(
					(row) =>
						(selector.includes('[data-msg-index]') && row.dataset.msgIndex != null) ||
						(selector.includes('[data-preflight-for]') && row.dataset.preflightFor != null) ||
						(selector.includes('[data-content-bottom]') && row.dataset.contentBottom != null)
				)
				.map((row) => ({
					dataset: row.dataset,
					getBoundingClientRect: () => row.rect as DOMRect,
				})) as unknown as NodeListOf<HTMLElement>,
	} as unknown as HTMLElement;
}

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

	it('includes team supplemental rows when resolving the bottom scroll target', () => {
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
		const track = fakeTrackWithDataRows([
			{
				dataset: { msgIndex: '1' },
				rect: { bottom: 360, height: 80 },
			},
			{
				dataset: { contentBottom: 'true' },
				rect: { bottom: 940, height: 160 },
			},
		]);

		expect(resolveContentBottomScroll(viewport, track)).toBe(656);
	});

	it('does not clamp final bottom scroll to the active preflight row after replies finish', () => {
		const sticky = {
			getBoundingClientRect: () => ({ height: 72 } as DOMRect),
		};
		const viewport = {
			scrollHeight: 1600,
			clientHeight: 400,
			scrollTop: 0,
			ownerDocument: {
				defaultView: {
					getComputedStyle: () => ({
						paddingBottom: '0px',
					}),
				},
			},
			getBoundingClientRect: () => ({ top: 100 } as DOMRect),
			querySelector: () => sticky,
		} as unknown as HTMLElement;
		const track = {
			querySelectorAll: () =>
				[
					{
						dataset: { preflightFor: '1' },
						getBoundingClientRect: () =>
							({ top: 160, bottom: 260, height: 100 } as DOMRect),
					},
					{
						dataset: { msgIndex: '1' },
						getBoundingClientRect: () => ({ bottom: 1100, height: 200 } as DOMRect),
					},
				] as unknown as NodeListOf<HTMLElement>,
		} as unknown as HTMLElement;

		expect(resolveContentBottomScroll(viewport, track)).toBe(0);
		expect(
			resolveContentBottomScroll(viewport, track, { protectActivePreflight: false })
		).toBe(600);
	});

	it('does not pull the viewport back above the active preflight clamp after the user scrolls past it', () => {
		const sticky = {
			getBoundingClientRect: () => ({ height: 72 } as DOMRect),
		};
		const viewport = {
			scrollHeight: 1600,
			clientHeight: 400,
			scrollTop: 260,
			ownerDocument: {
				defaultView: {
					getComputedStyle: () => ({
						paddingBottom: '0px',
					}),
				},
			},
			getBoundingClientRect: () => ({ top: 100 } as DOMRect),
			querySelector: () => sticky,
		} as unknown as HTMLElement;
		const track = {
			querySelectorAll: () =>
				[
					{
						dataset: { preflightFor: '1' },
						getBoundingClientRect: () =>
							({ top: 160, bottom: 260, height: 100 } as DOMRect),
					},
					{
						dataset: { msgIndex: '1' },
						getBoundingClientRect: () => ({ bottom: 1100, height: 200 } as DOMRect),
					},
				] as unknown as NodeListOf<HTMLElement>,
		} as unknown as HTMLElement;

		expect(resolveContentBottomScroll(viewport, track)).toBe(860);
	});
});
