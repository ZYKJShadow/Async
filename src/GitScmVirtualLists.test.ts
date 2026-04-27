import { describe, expect, it } from 'vitest';
import { groupPathsByDir } from './GitScmVirtualLists';

describe('groupPathsByDir', () => {
	it('returns empty array for empty input', () => {
		expect(groupPathsByDir([])).toEqual([]);
	});

	it('groups single root file under empty directory key', () => {
		expect(groupPathsByDir(['README.md'])).toEqual([{ dir: '', paths: ['README.md'] }]);
	});

	it('groups files by their immediate parent directory', () => {
		const out = groupPathsByDir(['src/a.ts', 'src/b.ts', 'docs/readme.md', 'package.json']);
		expect(out).toEqual([
			{ dir: '', paths: ['package.json'] },
			{ dir: 'docs', paths: ['docs/readme.md'] },
			{ dir: 'src', paths: ['src/a.ts', 'src/b.ts'] },
		]);
	});

	it('keeps the original path string (with backslashes) but groups using normalized dir', () => {
		const out = groupPathsByDir(['src\\a.ts', 'src/b.ts']);
		expect(out).toHaveLength(1);
		expect(out[0].dir).toBe('src');
		expect(out[0].paths).toEqual(['src\\a.ts', 'src/b.ts']);
	});

	it('places the root group ("") first regardless of other dir names', () => {
		const out = groupPathsByDir(['z/last.ts', 'README.md', 'a/first.ts']);
		expect(out.map((g) => g.dir)).toEqual(['', 'a', 'z']);
	});

	it('sorts non-root groups lexicographically', () => {
		const out = groupPathsByDir(['z/x.ts', 'b/x.ts', 'a/x.ts', 'c/x.ts']);
		expect(out.map((g) => g.dir)).toEqual(['a', 'b', 'c', 'z']);
	});

	it('uses the full parent path as the group key (not just basename)', () => {
		const out = groupPathsByDir(['src/foo/x.ts', 'src/bar/y.ts']);
		expect(out.map((g) => g.dir)).toEqual(['src/bar', 'src/foo']);
	});

	it('preserves insertion order within each group', () => {
		const out = groupPathsByDir(['src/c.ts', 'src/a.ts', 'src/b.ts']);
		expect(out[0].paths).toEqual(['src/c.ts', 'src/a.ts', 'src/b.ts']);
	});
});
