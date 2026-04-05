import { describe, expect, it } from 'vitest';
import { createTranslate } from './i18n/createTranslate';
import {
	classifyGitUnavailableReason,
	gitBranchTriggerTitle,
	gitUnavailableCopy,
} from './gitAvailability';

describe('gitAvailability', () => {
	const t = createTranslate('en');

	it('classifies missing Git distinctly', () => {
		expect(classifyGitUnavailableReason('Git is not installed')).toBe('missing');
	});

	it('classifies non-repository workspaces distinctly', () => {
		expect(classifyGitUnavailableReason('Current workspace is not a Git repository')).toBe('not_repo');
	});

	it('treats blank and unexpected errors as generic unavailable states', () => {
		expect(classifyGitUnavailableReason('')).toBe('error');
		expect(classifyGitUnavailableReason('Failed to load changes')).toBe('error');
	});

	it('returns missing-git copy that tells the user to install Git first', () => {
		expect(gitUnavailableCopy(t, 'missing')).toEqual({
			title: 'Git is not installed',
			body: 'Install Git first, then reopen or refresh this workspace to enable Source Control here.',
		});
	});

	it('returns non-repo copy that explains how to enable source control', () => {
		expect(gitUnavailableCopy(t, 'not_repo')).toEqual({
			title: 'This folder is not a Git repository',
			body: 'Open a folder that already contains a Git repository, or initialize Git in this folder to use Source Control here.',
		});
	});

	it('returns trigger titles that match the classified state', () => {
		expect(gitBranchTriggerTitle(t, true, 'none')).toBe('Switch or create branch');
		expect(gitBranchTriggerTitle(t, false, 'missing')).toBe('Install Git first to enable branch features');
		expect(gitBranchTriggerTitle(t, false, 'not_repo')).toBe('Current workspace is not a Git repository');
		expect(gitBranchTriggerTitle(t, false, 'error')).toBe('Git features are unavailable right now');
	});
});
