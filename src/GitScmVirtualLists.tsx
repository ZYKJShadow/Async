import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { changeBadgeLabel, changeBadgeVariant } from './gitBadge';
import { FileTypeIcon } from './fileTypeIcons';
import type { TFunction } from './i18n';
import { IconChevron, IconEye } from './icons';
import type { GitPathStatusMap } from './WorkspaceExplorer';
import {
	agentFilePreviewPathToLang,
	buildGitSidebarDiffLineRender,
	ensureAgentFilePreviewLang,
	getAgentFilePreviewHighlighter,
	type GitSidebarDiffLineRender,
} from './agentFilePreviewShiki';
import { useDomColorScheme } from './useDomColorScheme';

/** 达到条数后 Agent 侧栏 Git 卡片使用虚拟列表（卡片含 diff，高度由 measureElement 测量） */
export const AGENT_GIT_SCM_VIRTUAL_THRESHOLD = 8;

/** 达到条数后 Editor 侧栏 Git 文件行使用虚拟列表 */
export const EDITOR_GIT_SCM_VIRTUAL_THRESHOLD = 32;

type DiffPreview = { diff: string; isBinary: boolean; additions: number; deletions: number };

/** Agent 侧栏 Git：默认全部折叠，仅展开一项显示 diff；路径列表变化时若当前展开项已不在列表则收起 */
function useAgentGitAccordion(paths: string[]) {
	const [expandedRel, setExpandedRel] = useState<string | null>(null);
	useEffect(() => {
		if (expandedRel && !paths.includes(expandedRel)) {
			setExpandedRel(null);
		}
	}, [paths, expandedRel]);
	const toggleRel = useCallback((rel: string) => {
		setExpandedRel((cur) => (cur === rel ? null : rel));
	}, []);
	return { expandedRel, toggleRel };
}

function trimGitDiffForSidebarCard(raw: string): string {
	const lines = raw.split('\n');
	const idx = lines.findIndex((l) => l.startsWith('@@'));
	if (idx < 0) {
		return raw;
	}
	const body = lines.slice(idx).filter((l) => !l.startsWith('@@'));
	return body.join('\n');
}

function gitSidebarDiffLineClass(line: string): string {
	const base = 'ref-git-diff-line';
	if (line.startsWith('+') && !line.startsWith('+++')) {
		return `${base} is-add`;
	}
	if (line.startsWith('-') && !line.startsWith('---')) {
		return `${base} is-del`;
	}
	if (
		line.startsWith('diff --git') ||
		line.startsWith('index ') ||
		line.startsWith('--- ') ||
		line.startsWith('+++ ') ||
		line.startsWith('Binary files ') ||
		line.startsWith('GIT binary patch') ||
		line.startsWith('\\')
	) {
		return `${base} is-meta`;
	}
	return base;
}

const GitDiffLines = memo(function GitDiffLines({
	diff,
	relPath,
	t,
}: {
	diff: string;
	/** 用于按扩展名选 Shiki 语言 */
	relPath: string;
	t: TFunction;
}) {
	const colorScheme = useDomColorScheme();
	const trimmed = useMemo(() => trimGitDiffForSidebarCard(diff), [diff]);
	const lines = useMemo(() => trimmed.split('\n').slice(0, 120), [trimmed]);
	const [views, setViews] = useState<GitSidebarDiffLineRender[] | null>(null);

	useEffect(() => {
		if (lines.length === 0) {
			setViews([]);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const h = await getAgentFilePreviewHighlighter();
				const lang = await ensureAgentFilePreviewLang(agentFilePreviewPathToLang(relPath));
				if (cancelled) {
					return;
				}
				const next = lines.map((line) =>
					buildGitSidebarDiffLineRender(h, lang, line, gitSidebarDiffLineClass(line), colorScheme)
				);
				if (!cancelled) {
					setViews(next);
				}
			} catch (e) {
				console.warn('[GitDiffLines] Shiki 高亮失败', e);
				if (!cancelled) {
					setViews(null);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [lines, relPath, colorScheme]);

	return (
		<div className="ref-git-card-diff" role="region" aria-label={t('git.diffPreview')}>
			{views === null
				? lines.map((line, i) => (
						<div key={i} className={gitSidebarDiffLineClass(line)}>
							{line || '\u00a0'}
						</div>
					))
				: views.map((v, i) =>
						v.mode === 'raw' ? (
							<div key={i} className={v.className} dangerouslySetInnerHTML={{ __html: v.html }} />
						) : (
							<div key={i} className={`${v.className} ref-git-diff-line--shiki`}>
								<span className="ref-git-diff-line-prefix" aria-hidden>
									{v.prefix === ' ' ? '\u00a0' : v.prefix}
								</span>
								<code
									className="ref-git-diff-line-code"
									dangerouslySetInnerHTML={{ __html: v.bodyHtml || '\u00a0' }}
								/>
							</div>
						)
					)}
		</div>
	);
});

const AgentGitChangeCard = memo(function AgentGitChangeCard({
	rel,
	pr,
	st,
	diffLoading,
	t,
	onOpenGitDiff,
	onEnsurePreview,
	diffOpen,
	onToggleDiffOpen,
}: {
	rel: string;
	pr: DiffPreview | undefined;
	st: GitPathStatusMap[string] | undefined;
	diffLoading: boolean;
	t: TFunction;
	onOpenGitDiff: (rel: string, diff: string | null) => void;
	/** 仅在卡片展开时请求该路径的 sidebar diff 预览 */
	onEnsurePreview?: (rel: string) => void;
	diffOpen: boolean;
	onToggleDiffOpen: () => void;
}) {
	const badge = st ? changeBadgeLabel(st.label, t) : t('app.gitChangedFallback');

	useEffect(() => {
		if (!diffOpen || !onEnsurePreview) {
			return;
		}
		onEnsurePreview(rel);
	}, [diffOpen, rel, onEnsurePreview]);

	return (
		<div className={`ref-git-card ${!diffOpen ? 'is-collapsed' : ''}`}>
			<div className="ref-git-card-head" onClick={onToggleDiffOpen} style={{ cursor: 'pointer' }}>
				<span className="ref-git-card-name" title={rel}>
					{rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel}
				</span>
				<span className="ref-git-card-badge">{badge}</span>
				<button
					type="button"
					className="ref-git-card-open"
					aria-label={t('app.gitPreviewAria')}
					title={t('app.gitPreviewTitle')}
					onClick={(e) => {
						e.stopPropagation();
						if (!pr) {
							onEnsurePreview?.(rel);
						}
						onOpenGitDiff(rel, pr?.diff ?? null);
					}}
				>
					<IconEye />
				</button>
			</div>
			{diffOpen && (
				<div className="ref-git-card-body">
					{diffLoading && !pr ? <div className="ref-git-card-skel">{t('app.gitDiffLoading')}</div> : null}
					{pr?.isBinary ? <div className="ref-git-binary-msg">{pr.diff || t('app.gitBinary')}</div> : null}
					{pr && !pr.isBinary && pr.diff ? <GitDiffLines diff={pr.diff} relPath={rel} t={t} /> : null}
					{pr && !pr.isBinary && !pr.diff ? (
						<div className="ref-git-binary-msg">{t('app.gitNoPreview')}</div>
					) : null}
					{!diffLoading && !pr ? (
						<div className="ref-git-binary-msg">{t('app.gitNoPreview')}</div>
					) : null}
				</div>
			)}
		</div>
	);
});

const AgentGitScmVirtualCards = memo(function AgentGitScmVirtualCards({
	paths,
	diffPreviews,
	gitPathStatus,
	diffLoading,
	t,
	onOpenGitDiff,
	onEnsurePreviews,
}: {
	paths: string[];
	diffPreviews: Record<string, DiffPreview>;
	gitPathStatus: GitPathStatusMap;
	diffLoading: boolean;
	t: TFunction;
	onOpenGitDiff: (rel: string, diff: string | null) => void;
	onEnsurePreviews?: (paths: readonly string[]) => void;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const { expandedRel, toggleRel } = useAgentGitAccordion(paths);
	const virtualizer = useVirtualizer({
		count: paths.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 48,
		gap: 10,
		getItemKey: (index) => paths[index]!,
		overscan: 6,
	});
	return (
		<div ref={scrollRef} className="ref-git-changed-scroll">
			<div
				className="ref-git-cards ref-git-cards--virtual"
				style={{
					height: `${virtualizer.getTotalSize()}px`,
					position: 'relative',
					width: '100%',
				}}
			>
				{virtualizer.getVirtualItems().map((vi) => {
					const rel = paths[vi.index]!;
					return (
						<div
							key={vi.key}
							data-index={vi.index}
							ref={virtualizer.measureElement}
							className="ref-git-virtual-card-row"
							style={{
								position: 'absolute',
								top: 0,
								left: 0,
								width: '100%',
								transform: `translateY(${vi.start}px)`,
							}}
						>
							<AgentGitChangeCard
								rel={rel}
								pr={diffPreviews[rel]}
								st={gitPathStatus[rel]}
								diffLoading={diffLoading}
								t={t}
								onOpenGitDiff={onOpenGitDiff}
								onEnsurePreview={onEnsurePreviews ? (r) => onEnsurePreviews([r]) : undefined}
								diffOpen={expandedRel === rel}
								onToggleDiffOpen={() => toggleRel(rel)}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
});

const AgentGitScmStaticCards = memo(function AgentGitScmStaticCards({
	paths,
	diffPreviews,
	gitPathStatus,
	diffLoading,
	t,
	onOpenGitDiff,
	onEnsurePreviews,
}: {
	paths: string[];
	diffPreviews: Record<string, DiffPreview>;
	gitPathStatus: GitPathStatusMap;
	diffLoading: boolean;
	t: TFunction;
	onOpenGitDiff: (rel: string, diff: string | null) => void;
	onEnsurePreviews?: (paths: readonly string[]) => void;
}) {
	const { expandedRel, toggleRel } = useAgentGitAccordion(paths);
	return (
		<div className="ref-git-changed-scroll">
			<div className="ref-git-cards">
				{paths.map((rel) => (
					<AgentGitChangeCard
						key={rel}
						rel={rel}
						pr={diffPreviews[rel]}
						st={gitPathStatus[rel]}
						diffLoading={diffLoading}
						t={t}
						onOpenGitDiff={onOpenGitDiff}
						onEnsurePreview={onEnsurePreviews ? (r) => onEnsurePreviews([r]) : undefined}
						diffOpen={expandedRel === rel}
						onToggleDiffOpen={() => toggleRel(rel)}
					/>
				))}
			</div>
		</div>
	);
});

/** 把改动路径按一级父目录分组，根目录归到 '' 组；返回顺序按目录字典序，根目录置顶 */
export function groupPathsByDir(paths: readonly string[]): Array<{ dir: string; paths: string[] }> {
	const map = new Map<string, string[]>();
	for (const rel of paths) {
		const norm = rel.replace(/\\/g, '/');
		const idx = norm.lastIndexOf('/');
		const dir = idx < 0 ? '' : norm.slice(0, idx);
		const arr = map.get(dir);
		if (arr) {
			arr.push(rel);
		} else {
			map.set(dir, [rel]);
		}
	}
	const dirs = Array.from(map.keys()).sort((a, b) => {
		if (a === '') {
			return -1;
		}
		if (b === '') {
			return 1;
		}
		return a.localeCompare(b);
	});
	return dirs.map((dir) => ({ dir, paths: map.get(dir)! }));
}

const AgentGitScmGroupedCards = memo(function AgentGitScmGroupedCards({
	paths,
	diffPreviews,
	gitPathStatus,
	diffLoading,
	t,
	onOpenGitDiff,
	onEnsurePreviews,
}: {
	paths: string[];
	diffPreviews: Record<string, DiffPreview>;
	gitPathStatus: GitPathStatusMap;
	diffLoading: boolean;
	t: TFunction;
	onOpenGitDiff: (rel: string, diff: string | null) => void;
	onEnsurePreviews?: (paths: readonly string[]) => void;
}) {
	const { expandedRel, toggleRel } = useAgentGitAccordion(paths);
	const groups = useMemo(() => groupPathsByDir(paths), [paths]);
	const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set());
	useEffect(() => {
		setCollapsedDirs((cur) => {
			const validDirs = new Set(groups.map((g) => g.dir));
			let changed = false;
			const next = new Set<string>();
			for (const d of cur) {
				if (validDirs.has(d)) {
					next.add(d);
				} else {
					changed = true;
				}
			}
			return changed ? next : cur;
		});
	}, [groups]);
	const toggleDir = useCallback((dir: string) => {
		setCollapsedDirs((cur) => {
			const next = new Set(cur);
			if (next.has(dir)) {
				next.delete(dir);
			} else {
				next.add(dir);
			}
			return next;
		});
	}, []);

	return (
		<div className="ref-git-changed-scroll">
			<div className="ref-git-groups">
				{groups.map(({ dir, paths: groupPaths }) => {
					const collapsed = collapsedDirs.has(dir);
					const label = dir === '' ? t('app.gitGroupRoot') : dir;
					return (
						<section key={dir || '__root__'} className="ref-git-group">
							<button
								type="button"
								className={`ref-git-group-head ${collapsed ? 'is-collapsed' : ''}`}
								onClick={() => toggleDir(dir)}
								aria-expanded={!collapsed}
							>
								<IconChevron className="ref-git-group-chev" />
								<span className="ref-git-group-name" title={label}>
									{label}
								</span>
								<span className="ref-git-group-count">{groupPaths.length}</span>
							</button>
							<div className={`ref-git-group-body ${collapsed ? 'is-collapsed' : ''}`} aria-hidden={collapsed}>
								<div className="ref-git-group-body-inner">
									<div className="ref-git-cards ref-git-cards--grouped">
										{groupPaths.map((rel) => (
											<AgentGitChangeCard
												key={rel}
												rel={rel}
												pr={diffPreviews[rel]}
												st={gitPathStatus[rel]}
												diffLoading={diffLoading}
												t={t}
												onOpenGitDiff={onOpenGitDiff}
												onEnsurePreview={onEnsurePreviews ? (r) => onEnsurePreviews([r]) : undefined}
												diffOpen={!collapsed && expandedRel === rel}
												onToggleDiffOpen={() => toggleRel(rel)}
											/>
										))}
									</div>
								</div>
							</div>
						</section>
					);
				})}
			</div>
		</div>
	);
});

export const AgentGitScmChangedCards = memo(function AgentGitScmChangedCards({
	paths,
	diffPreviews,
	gitPathStatus,
	diffLoading,
	t,
	onOpenGitDiff,
	onEnsurePreviews,
	grouped,
}: {
	paths: string[];
	diffPreviews: Record<string, DiffPreview>;
	gitPathStatus: GitPathStatusMap;
	diffLoading: boolean;
	t: TFunction;
	onOpenGitDiff: (rel: string, diff: string | null) => void;
	onEnsurePreviews?: (paths: readonly string[]) => void;
	grouped?: boolean;
}) {
	if (grouped) {
		return (
			<AgentGitScmGroupedCards
				paths={paths}
				diffPreviews={diffPreviews}
				gitPathStatus={gitPathStatus}
				diffLoading={diffLoading}
				t={t}
				onOpenGitDiff={onOpenGitDiff}
				onEnsurePreviews={onEnsurePreviews}
			/>
		);
	}
	if (paths.length >= AGENT_GIT_SCM_VIRTUAL_THRESHOLD) {
		return (
			<AgentGitScmVirtualCards
				paths={paths}
				diffPreviews={diffPreviews}
				gitPathStatus={gitPathStatus}
				diffLoading={diffLoading}
				t={t}
				onOpenGitDiff={onOpenGitDiff}
				onEnsurePreviews={onEnsurePreviews}
			/>
		);
	}
	return (
		<AgentGitScmStaticCards
			paths={paths}
			diffPreviews={diffPreviews}
			gitPathStatus={gitPathStatus}
			diffLoading={diffLoading}
			t={t}
			onOpenGitDiff={onOpenGitDiff}
			onEnsurePreviews={onEnsurePreviews}
		/>
	);
});

const EditorGitScmVirtualRows = memo(function EditorGitScmVirtualRows({
	paths,
	gitPathStatus,
	workspaceBasename,
	editorSidebarSelectedRel,
	onExplorerOpenFile,
	t,
}: {
	paths: string[];
	gitPathStatus: GitPathStatusMap;
	workspaceBasename: string;
	editorSidebarSelectedRel: string;
	onExplorerOpenFile: (rel: string) => void;
	t: TFunction;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const virtualizer = useVirtualizer({
		count: paths.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 40,
		gap: 2,
		getItemKey: (index) => paths[index]!,
		overscan: 8,
	});
	return (
		<div ref={scrollRef} className="ref-editor-sidebar-scroll ref-editor-sidebar-scroll--list">
			<div
				className="ref-editor-sidebar-file-list ref-editor-sidebar-file-list--virtual"
				style={{
					height: `${virtualizer.getTotalSize()}px`,
					position: 'relative',
					width: '100%',
				}}
			>
				{virtualizer.getVirtualItems().map((vi) => {
					const rel = paths[vi.index]!;
					const normalizedRel = rel.replace(/\\/g, '/');
					const fileName = normalizedRel.includes('/')
						? normalizedRel.slice(normalizedRel.lastIndexOf('/') + 1)
						: normalizedRel;
					const dir = normalizedRel.includes('/')
						? normalizedRel.slice(0, normalizedRel.lastIndexOf('/'))
						: workspaceBasename;
					const status = gitPathStatus[rel];
					const label = status?.label ?? '';
					return (
						<div
							key={vi.key}
							data-index={vi.index}
							style={{
								position: 'absolute',
								top: 0,
								left: 0,
								width: '100%',
								transform: `translateY(${vi.start}px)`,
							}}
						>
							<button
								type="button"
								className={`ref-editor-sidebar-file-row ${editorSidebarSelectedRel === normalizedRel ? 'is-active' : ''}`}
								onClick={() => onExplorerOpenFile(rel)}
								title={normalizedRel}
							>
								<span className="ref-editor-sidebar-file-icon" aria-hidden>
									<FileTypeIcon fileName={fileName} isDirectory={false} />
								</span>
								<span className="ref-editor-sidebar-file-main">
									<span className="ref-editor-sidebar-file-name">{fileName}</span>
									<span className="ref-editor-sidebar-file-path">{dir}</span>
								</span>
								<span
									className={`ref-explorer-badge ref-explorer-badge--${changeBadgeVariant(label)}`}
									title={status ? changeBadgeLabel(status.label, t) : t('app.gitChangedFallback')}
								>
									{label || '•'}
								</span>
							</button>
						</div>
					);
				})}
			</div>
		</div>
	);
});

export const EditorGitScmPathList = memo(function EditorGitScmPathList({
	paths,
	gitPathStatus,
	workspaceBasename,
	editorSidebarSelectedRel,
	onExplorerOpenFile,
	t,
}: {
	paths: string[];
	gitPathStatus: GitPathStatusMap;
	workspaceBasename: string;
	editorSidebarSelectedRel: string;
	onExplorerOpenFile: (rel: string) => void;
	t: TFunction;
}) {
	if (paths.length >= EDITOR_GIT_SCM_VIRTUAL_THRESHOLD) {
		return (
			<EditorGitScmVirtualRows
				paths={paths}
				gitPathStatus={gitPathStatus}
				workspaceBasename={workspaceBasename}
				editorSidebarSelectedRel={editorSidebarSelectedRel}
				onExplorerOpenFile={onExplorerOpenFile}
				t={t}
			/>
		);
	}
	return (
		<div className="ref-editor-sidebar-scroll ref-editor-sidebar-scroll--list">
			<div className="ref-editor-sidebar-file-list">
				{paths.map((rel) => {
					const normalizedRel = rel.replace(/\\/g, '/');
					const fileName = normalizedRel.includes('/')
						? normalizedRel.slice(normalizedRel.lastIndexOf('/') + 1)
						: normalizedRel;
					const dir = normalizedRel.includes('/')
						? normalizedRel.slice(0, normalizedRel.lastIndexOf('/'))
						: workspaceBasename;
					const status = gitPathStatus[rel];
					const label = status?.label ?? '';
					return (
						<button
							key={rel}
							type="button"
							className={`ref-editor-sidebar-file-row ${editorSidebarSelectedRel === normalizedRel ? 'is-active' : ''}`}
							onClick={() => onExplorerOpenFile(rel)}
							title={normalizedRel}
						>
							<span className="ref-editor-sidebar-file-icon" aria-hidden>
								<FileTypeIcon fileName={fileName} isDirectory={false} />
							</span>
							<span className="ref-editor-sidebar-file-main">
								<span className="ref-editor-sidebar-file-name">{fileName}</span>
								<span className="ref-editor-sidebar-file-path">{dir}</span>
							</span>
							<span
								className={`ref-explorer-badge ref-explorer-badge--${changeBadgeVariant(label)}`}
								title={status ? changeBadgeLabel(status.label, t) : t('app.gitChangedFallback')}
							>
								{label || '•'}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
});
