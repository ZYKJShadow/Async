import { describe, expect, it } from 'vitest';
import { shouldBlockBrowserRequest } from './browserController.js';

describe('shouldBlockBrowserRequest', () => {
	it('blocks known tracker subresources when enabled', () => {
		expect(
			shouldBlockBrowserRequest(
				'https://sync.ottadvisors.com/pixel.gif',
				'image',
				{ blockTrackers: true }
			)
		).toBe(true);
	});

	it('does not block top-level navigations', () => {
		expect(
			shouldBlockBrowserRequest(
				'https://sync.ottadvisors.com/',
				'mainFrame',
				{ blockTrackers: true }
			)
		).toBe(false);
	});

	it('respects the toggle when disabled', () => {
		expect(
			shouldBlockBrowserRequest(
				'https://capi.connatix.com/core/us',
				'xmlhttprequest',
				{ blockTrackers: false }
			)
		).toBe(false);
	});
});
