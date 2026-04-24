import type { ReactNode } from 'react';
import type { TFunction } from '../i18n';
import type { ThreadInfo } from '../threadTypes';

export const THREAD_TITLE_PLACEHOLDER = '???';

export function threadFileBasename(rel: string): string {
	const n = rel.replace(/\\/g, '/');
	const i = n.lastIndexOf('/');
	return i >= 0 ? n.slice(i + 1) : n;
}

export function isPlaceholderThreadTitle(title: string): boolean {
	return title.trim() === THREAD_TITLE_PLACEHOLDER;
}

export function displayThreadTitle(title: string, fallback: string): string {
	const trimmed = title.trim();
	if (!trimmed || isPlaceholderThreadTitle(trimmed)) {
		return fallback;
	}
	return trimmed;
}

export function formatThreadRowSubtitle(tr: TFunction, t: ThreadInfo, isActive: boolean): ReactNode {
	const paths = t.filePaths ?? [];
	const fc = Math.max(t.fileCount ?? 0, paths.length);
	const add = t.additions ?? 0;
	const del = t.deletions ?? 0;
	const hasDiff = t.hasAgentDiff ?? false;

	if (t.isAwaitingReply) {
		const fb = (t.subtitleFallback ?? '').trim();
		if (fb) {
			return fb;
		}
	}

	if (isActive && hasDiff && paths.length > 0) {
		const names = paths.map(threadFileBasename);
		let s = names.join(', ');
		if (s.length > 52) {
			s = `${s.slice(0, 50)}…`;
		}
		return <>{tr('app.threadEdited', { names: s })}</>;
	}
	if (!isActive && hasDiff && (add > 0 || del > 0 || fc > 0)) {
		const n = fc > 0 ? fc : 1;
		return (
			<>
				<span className="ref-thread-meta-add">+{add}</span>{' '}
				<span className="ref-thread-meta-del">−{del}</span>
				<span className="ref-thread-meta-sep"> · </span>
				{n === 1 ? tr('app.threadFilesOne', { n }) : tr('app.threadFilesMany', { n })}
			</>
		);
	}
	const fb = (t.subtitleFallback ?? '').trim();
	return fb || '\u00a0';
}

export function threadRowTitle(tr: TFunction, t: ThreadInfo): string {
	const title = displayThreadTitle(t.title, tr('app.threadUntitled'));
	if (t.isAwaitingReply) {
		return title.startsWith('Draft:') || title.startsWith('草稿：')
			? title
			: tr('app.draftPrefix', { title });
	}
	return title;
}
