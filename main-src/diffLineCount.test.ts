import { describe, expect, it } from 'vitest';
import { countDiffLinesInChunk, countLineChangesBetweenTexts } from './diffLineCount.js';

describe('countDiffLinesInChunk', () => {
	it('counts + / - lines in a unified diff chunk', () => {
		const chunk = [
			'diff --git a/foo.txt b/foo.txt',
			'--- a/foo.txt',
			'+++ b/foo.txt',
			'@@ -1,2 +1,3 @@',
			' line0',
			'-removed',
			'+added1',
			'+added2',
		].join('\n');
		expect(countDiffLinesInChunk(chunk)).toEqual({ add: 2, del: 1 });
	});

	it('ignores --- and +++ file headers', () => {
		const chunk = '--- a/x\n+++ b/x\n-old\n+new\n';
		expect(countDiffLinesInChunk(chunk)).toEqual({ add: 1, del: 1 });
	});

	it('returns zeros for empty chunk', () => {
		expect(countDiffLinesInChunk('')).toEqual({ add: 0, del: 0 });
	});
});

describe('countLineChangesBetweenTexts', () => {
	it('treats null previous as empty file', () => {
		const r = countLineChangesBetweenTexts(null, 'a\nb\n');
		expect(r.additions).toBeGreaterThanOrEqual(2);
		expect(r.deletions).toBe(0);
	});

	it('counts a single-line replacement', () => {
		const r = countLineChangesBetweenTexts('hello\n', 'world\n');
		expect(r.additions).toBeGreaterThanOrEqual(1);
		expect(r.deletions).toBeGreaterThanOrEqual(1);
	});

	it('normalizes CRLF to LF before diffing', () => {
		const r = countLineChangesBetweenTexts('a\r\n', 'b\r\n');
		expect(r.additions + r.deletions).toBeGreaterThanOrEqual(1);
	});

	it('returns zero additions and deletions for identical text', () => {
		const t = 'same\ncontent\n';
		const r = countLineChangesBetweenTexts(t, t);
		expect(r).toEqual({ additions: 0, deletions: 0 });
	});
});
