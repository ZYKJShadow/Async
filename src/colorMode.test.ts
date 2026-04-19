import { describe, expect, it } from 'vitest';
import { readDomColorScheme } from './colorMode';

describe('readDomColorScheme', () => {
	it('reads the light scheme from the document root attribute', () => {
		const doc = {
			documentElement: {
				getAttribute(name: string) {
					return name === 'data-color-scheme' ? 'light' : null;
				},
			},
		} as unknown as Document;

		expect(readDomColorScheme(doc)).toBe('light');
	});

	it('falls back to dark when the scheme attribute is missing', () => {
		const doc = {
			documentElement: {
				getAttribute() {
					return null;
				},
			},
		} as unknown as Document;

		expect(readDomColorScheme(doc)).toBe('dark');
	});
});
