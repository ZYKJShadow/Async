import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveUsageStatsDataDir, type ShellSettings } from './settingsStore.js';

function s(partial: Partial<ShellSettings['usageStats']>): ShellSettings {
	return { usageStats: partial as ShellSettings['usageStats'] };
}

describe('resolveUsageStatsDataDir', () => {
	it('returns null when usageStats is undefined', () => {
		expect(resolveUsageStatsDataDir({})).toBeNull();
	});

	it('returns null when enabled is false', () => {
		expect(resolveUsageStatsDataDir(s({ enabled: false, dataDir: '/tmp/x' }))).toBeNull();
	});

	it('returns null when enabled is true but dataDir is missing', () => {
		expect(resolveUsageStatsDataDir(s({ enabled: true }))).toBeNull();
	});

	it('returns null when enabled is true but dataDir is only whitespace', () => {
		expect(resolveUsageStatsDataDir(s({ enabled: true, dataDir: '   \t  ' }))).toBeNull();
	});

	it('returns null when dataDir is null', () => {
		expect(resolveUsageStatsDataDir(s({ enabled: true, dataDir: null }))).toBeNull();
	});

	it('returns absolute path when enabled with non-empty dataDir', () => {
		const dir = '/custom/stats/dir';
		const got = resolveUsageStatsDataDir(s({ enabled: true, dataDir: dir }));
		expect(got).toBe(path.resolve(dir));
	});

	it('trims dataDir before resolving', () => {
		const inner = path.join('my', 'stats');
		const got = resolveUsageStatsDataDir(s({ enabled: true, dataDir: `  ${inner}  ` }));
		expect(got).toBe(path.resolve(inner));
	});
});
