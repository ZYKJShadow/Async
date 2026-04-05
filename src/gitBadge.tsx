import { gitUnavailableCopy, type GitUnavailableReason } from './gitAvailability';
import { type TFunction } from './i18n';

export function changeBadgeLabel(gitLabel: string, t: TFunction): string {
	switch (gitLabel) {
		case 'U': return t('git.badge.new');
		case 'M': return t('git.badge.modified');
		case 'A': return t('git.badge.added');
		case 'D': return t('git.badge.deleted');
		case 'R': return t('git.badge.renamed');
		case 'I': return t('git.badge.ignored');
		default:  return gitLabel;
	}
}

export function changeBadgeVariant(gitLabel: string | undefined): string {
	const k = String(gitLabel ?? '').toLowerCase();
	if (k === 'u' || k === 'm' || k === 'a' || k === 'd' || k === 'i' || k === 'r' || k === 'c' || k === 't') {
		return k;
	}
	return 'misc';
}

export function GitUnavailableState({
	t,
	reason,
	detail,
}: {
	t: TFunction;
	reason: Exclude<GitUnavailableReason, 'none'>;
	detail?: string | null;
}) {
	const copy = gitUnavailableCopy(t, reason);
	return (
		<div className="ref-git-empty-state" role="status">
			<p className="ref-git-empty-title">{copy.title}</p>
			<p className="ref-git-empty-copy">{copy.body}</p>
			{reason === 'error' && detail?.trim() ? (
				<p className="ref-git-empty-detail" title={detail}>
					{detail}
				</p>
			) : null}
		</div>
	);
}
