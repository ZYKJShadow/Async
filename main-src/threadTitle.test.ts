import { describe, expect, it } from 'vitest';
import { deriveFallbackThreadTitle, parseGeneratedThreadTitle } from './threadTitle.js';

describe('deriveFallbackThreadTitle', () => {
	it('collapses whitespace and keeps short titles readable', () => {
		expect(deriveFallbackThreadTitle('  Fix   login   button  ')).toBe('Fix login button');
	});

	it('truncates long titles with an ellipsis instead of punctuation noise', () => {
		expect(deriveFallbackThreadTitle('a'.repeat(60))).toBe(`${'a'.repeat(47)}…`);
	});

	it('returns empty string for blank input', () => {
		expect(deriveFallbackThreadTitle('   ')).toBe('');
	});
});

describe('parseGeneratedThreadTitle', () => {
	it('parses strict JSON payloads', () => {
		expect(parseGeneratedThreadTitle('{"title":"Fix login button on mobile"}')).toBe(
			'Fix login button on mobile'
		);
	});

	it('parses JSON wrapped in markdown fences', () => {
		expect(
			parseGeneratedThreadTitle(
				'```json\n{"title":"Refactor API client error handling"}\n```'
			)
		).toBe('Refactor API client error handling');
	});

	it('falls back to the first non-empty plain-text line', () => {
		expect(parseGeneratedThreadTitle('"Debug failing CI tests"')).toBe('Debug failing CI tests');
	});

	it('returns null for empty responses', () => {
		expect(parseGeneratedThreadTitle('   ')).toBeNull();
	});
});
