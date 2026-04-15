import { describe, expect, it } from 'vitest';
import { safeJsonParse, splitPlainText } from './common.js';

describe('splitPlainText', () => {
	it('splits long text on whitespace boundaries when possible', () => {
		const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';
		const chunks = splitPlainText(text, 20);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.join(' ')).toContain('alpha beta');
		expect(chunks.every((item) => item.length <= 20)).toBe(true);
	});
});

describe('safeJsonParse', () => {
	it('returns null for invalid JSON', () => {
		expect(safeJsonParse('{bad')).toBeNull();
	});

	it('returns parsed data for valid JSON', () => {
		expect(safeJsonParse<{ ok: boolean }>('{\"ok\":true}')?.ok).toBe(true);
	});
});

