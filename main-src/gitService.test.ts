import { describe, expect, it } from 'vitest';
import { classifyGitFailure, normalizeGitFailureMessage } from './gitService';

describe('gitService Git failure classification', () => {
	it('recognizes missing Git from ENOENT spawn errors', () => {
		const error = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
		expect(classifyGitFailure(error)).toBe('missing');
		expect(normalizeGitFailureMessage(error, 'fallback')).toBe('Git is not installed');
	});

	it('recognizes missing Git from Windows "not recognized" errors', () => {
		const error = new Error("'git' is not recognized as an internal or external command");
		expect(classifyGitFailure(error)).toBe('missing');
		expect(normalizeGitFailureMessage(error, 'fallback')).toBe('Git is not installed');
	});

	it('recognizes non-repository errors from Git stderr text', () => {
		const error = Object.assign(new Error('Command failed'), {
			stderr: 'fatal: not a git repository (or any of the parent directories): .git',
		});
		expect(classifyGitFailure(error)).toBe('not_repo');
		expect(normalizeGitFailureMessage(error, 'fallback')).toBe('Current workspace is not a Git repository');
	});

	it('falls back for unrelated Git failures', () => {
		const error = new Error('permission denied');
		expect(classifyGitFailure(error)).toBe('unknown');
		expect(normalizeGitFailureMessage(error, 'fallback')).toBe('fallback');
	});
});
