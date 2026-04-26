import { describe, expect, it } from 'vitest';
import { isSyntheticAntigravityProjectId, normalizeAntigravityProjectId } from './antigravityProject.js';

describe('Antigravity project id normalization', () => {
	it('rejects legacy generated project ids', () => {
		expect(isSyntheticAntigravityProjectId('async-208f7779')).toBe(true);
		expect(isSyntheticAntigravityProjectId('swift-wave-bea98')).toBe(true);
		expect(isSyntheticAntigravityProjectId('bright-core-abc12')).toBe(true);
		expect(normalizeAntigravityProjectId('async-208f7779')).toBe('');
		expect(normalizeAntigravityProjectId('swift-wave-bea98')).toBe('');
	});

	it('keeps real Google project ids', () => {
		expect(isSyntheticAntigravityProjectId('gen-lang-client-0123456789')).toBe(false);
		expect(isSyntheticAntigravityProjectId('my-real-project-123')).toBe(false);
		expect(normalizeAntigravityProjectId(' gen-lang-client-0123456789 ')).toBe('gen-lang-client-0123456789');
	});
});
