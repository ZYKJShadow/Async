import type { TFunction } from './i18n';

export type GitUnavailableReason = 'none' | 'missing' | 'not_repo' | 'error';

export function classifyGitUnavailableReason(error: string | null | undefined): GitUnavailableReason {
	const text = String(error ?? '').trim();
	if (!text) {
		return 'error';
	}
	if (/^Git is not installed$/i.test(text)) {
		return 'missing';
	}
	if (/^Current workspace is not a Git repository$/i.test(text)) {
		return 'not_repo';
	}
	return 'error';
}

export function gitUnavailableCopy(
	t: TFunction,
	reason: Exclude<GitUnavailableReason, 'none'>
): { title: string; body: string } {
	switch (reason) {
		case 'missing':
			return {
				title: t('app.gitMissingTitle'),
				body: t('app.gitMissingBody'),
			};
		case 'not_repo':
			return {
				title: t('app.gitNotRepoTitle'),
				body: t('app.gitNotRepoBody'),
			};
		default:
			return {
				title: t('app.gitUnavailableTitle'),
				body: t('app.gitUnavailableBody'),
			};
	}
}

export function gitBranchTriggerTitle(
	t: TFunction,
	gitStatusOk: boolean,
	reason: GitUnavailableReason
): string {
	if (gitStatusOk) {
		return t('git.branchPicker.triggerTitle');
	}
	if (reason === 'missing') {
		return t('git.branchPicker.gitMissing');
	}
	if (reason === 'not_repo') {
		return t('git.branchPicker.notRepo');
	}
	return t('git.branchPicker.unavailable');
}
