import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileTypeIcon } from './fileTypeIcons';
import type { TFunction } from './i18n';

type QuickMode = 'files' | 'commands' | 'symbol' | 'text' | 'goline';

export type ParsedQuickOpen = {
	mode: QuickMode;
	filter: string;
	line?: number;
};

export function parseQuickOpenInput(raw: string): ParsedQuickOpen {
	const s = raw;
	if (s.startsWith('>')) {
		return { mode: 'commands', filter: s.slice(1).trim() };
	}
	if (s.startsWith('@')) {
		return { mode: 'symbol', filter: s.slice(1).trim() };
	}
	if (s.startsWith('%')) {
		return { mode: 'text', filter: s.slice(1).trim() };
	}
	const lineOnly = s.match(/^:(\d+)$/);
	if (lineOnly) {
		const line = parseInt(lineOnly[1], 10);
		return { mode: 'goline', filter: '', line: Number.isFinite(line) ? line : undefined };
	}
	const fileLine = s.match(/^(.+):(\d+)$/);
	if (fileLine) {
		const pathPart = fileLine[1].trim();
		const ln = parseInt(fileLine[2], 10);
		if (pathPart && Number.isFinite(ln) && ln > 0) {
			return { mode: 'files', filter: pathPart, line: ln };
		}
	}
	return { mode: 'files', filter: s.trim() };
}

function isMacPlatform(): boolean {
	if (typeof navigator === 'undefined') {
		return false;
	}
	return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) || navigator.userAgent.includes('Mac');
}

function kbdPrimary(): string {
	return isMacPlatform() ? '⌘' : 'Ctrl+';
}

function fileBasename(rel: string): string {
	const n = rel.replace(/\\/g, '/');
	return n.split('/').pop() || n;
}

function parentDir(rel: string): string {
	const n = rel.replace(/\\/g, '/');
	const i = n.lastIndexOf('/');
	return i <= 0 ? '' : n.slice(0, i);
}

function normPath(p: string): string {
	return p.replace(/\\/g, '/').toLowerCase();
}

function pathMatchesFilter(rel: string, filter: string): boolean {
	if (!filter) {
		return true;
	}
	const f = filter.replace(/\\/g, '/');
	const n = normPath(rel);
	const fl = normPath(f);
	if (n.includes(fl)) {
		return true;
	}
	const base = normPath(fileBasename(rel));
	return base.includes(fl) || fl.includes(base);
}

function rankPath(rel: string, filter: string): number {
	if (!filter) {
		return 0;
	}
	const f = normPath(filter.replace(/\\/g, '/'));
	const base = normPath(fileBasename(rel));
	const n = normPath(rel);
	if (base === f) {
		return 0;
	}
	if (base.startsWith(f)) {
		return 1;
	}
	if (n.endsWith(`/${f}`) || n.includes(`/${f}/`)) {
		return 2;
	}
	if (base.includes(f)) {
		return 3;
	}
	if (n.includes(f)) {
		return 4;
	}
	return 5;
}

function lineAppliesToPath(relPath: string, pathFilter: string, line: number | undefined): line is number {
	if (line == null || line <= 0 || !pathFilter.trim()) {
		return false;
	}
	const want = pathFilter.replace(/\\/g, '/');
	const n = relPath.replace(/\\/g, '/');
	if (n === want || n.endsWith(`/${want}`)) {
		return true;
	}
	/* 仅文件名（无路径）时：允许与所选文件基名一致时带行号打开 */
	if (!want.includes('/') && fileBasename(want) === fileBasename(n)) {
		return true;
	}
	return false;
}

/** 菜单栏按钮上展示的快捷键文案 */
export function quickOpenPrimaryShortcutLabel(): string {
	return `${kbdPrimary()}P`;
}

/** 保存（文件菜单等） */
export function saveShortcutLabel(): string {
	return `${kbdPrimary()}S`;
}

type ActionDef = {
	id: string;
	labelKey: string;
	kbd?: string;
	insertPrefix?: string;
};

type NavRow =
	| { kind: 'action'; id: string; label: string; kbd?: string; insertPrefix?: string }
	| { kind: 'file'; path: string; recent: boolean }
	| { kind: 'folder'; path: string }
	| { kind: 'symbol'; name: string; path: string; line: number; symKind: string };

const MAX_FILES = 80;

export type QuickOpenPaletteProps = {
	open: boolean;
	onClose: () => void;
	workspaceOpen: boolean;
	workspaceFiles: string[];
	recentFilePaths: string[];
	homeRecentFolders: string[];
	activeFilePath: string;
	onOpenFile: (relPath: string, line?: number, endLine?: number) => void;
	onOpenWorkspaceFolder: (fullPath: string) => void;
	onOpenWorkspacePicker: () => void;
	onOpenSettings: () => void;
	onFocusSearchSidebar: (initialQuery: string) => void;
	onGoToLine: (line: number) => void;
	/** 打开时预填输入框（例如命令模式 `>`） */
	initialQuery?: string;
	/** `@` 符号模式：按名称搜索工作区导出符号（主进程索引） */
	searchWorkspaceSymbols?: (query: string) => Promise<{ name: string; path: string; line: number; kind: string }[]>;
	t: TFunction;
};

export function QuickOpenPalette({
	open,
	onClose,
	workspaceOpen,
	workspaceFiles,
	recentFilePaths,
	homeRecentFolders,
	activeFilePath,
	onOpenFile,
	onOpenWorkspaceFolder,
	onOpenWorkspacePicker,
	onOpenSettings,
	onFocusSearchSidebar,
	onGoToLine,
	initialQuery = '',
	searchWorkspaceSymbols,
	t,
}: QuickOpenPaletteProps) {
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState(0);
	const [symbolHits, setSymbolHits] = useState<{ name: string; path: string; line: number; kind: string }[]>([]);
	const inputRef = useRef<HTMLInputElement>(null);
	const rowRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

	const parsed = useMemo(() => parseQuickOpenInput(query), [query]);

	const actionsAll = useMemo((): ActionDef[] => {
		const p = kbdPrimary();
		return [
			{ id: 'goToFile', labelKey: 'quickOpen.action.goToFile', kbd: `${p}P` },
			{ id: 'commands', labelKey: 'quickOpen.action.commands', kbd: isMacPlatform() ? '⌘⇧P' : 'Ctrl+Shift+P', insertPrefix: '>' },
			{ id: 'searchText', labelKey: 'quickOpen.action.searchText', insertPrefix: '%' },
			{ id: 'goToSymbol', labelKey: 'quickOpen.action.goToSymbol', kbd: isMacPlatform() ? '⌘⇧O' : 'Ctrl+Shift+O', insertPrefix: '@' },
			{ id: 'settings', labelKey: 'quickOpen.action.settings' },
			{ id: 'openWorkspace', labelKey: 'quickOpen.action.openWorkspace' },
		];
	}, []);

	const filteredFiles = useMemo(() => {
		const filter = parsed.filter;
		if (parsed.mode !== 'files' && parsed.mode !== 'symbol') {
			return [];
		}
		const setRecent = new Set(recentFilePaths);
		const seen = new Set<string>();
		const scored: { path: string; recent: boolean; rank: number }[] = [];
		const push = (path: string, recent: boolean) => {
			if (seen.has(path) || !pathMatchesFilter(path, filter)) {
				return;
			}
			seen.add(path);
			scored.push({ path, recent, rank: rankPath(path, filter) });
		};
		for (const p of recentFilePaths) {
			push(p, true);
		}
		for (const p of workspaceFiles) {
			push(p, setRecent.has(p));
		}
		scored.sort((a, b) => {
			if (a.rank !== b.rank) {
				return a.rank - b.rank;
			}
			if (a.recent !== b.recent) {
				return a.recent ? -1 : 1;
			}
			return a.path.localeCompare(b.path);
		});
		return scored.slice(0, MAX_FILES);
	}, [parsed.mode, parsed.filter, recentFilePaths, workspaceFiles]);

	const filteredFolders = useMemo(() => {
		if (workspaceOpen || parsed.mode !== 'files') {
			return [];
		}
		const q = parsed.filter.trim().toLowerCase();
		return homeRecentFolders
			.filter((p) => !q || p.toLowerCase().includes(q) || fileBasename(p).toLowerCase().includes(q))
			.slice(0, 24);
	}, [workspaceOpen, parsed.mode, parsed.filter, homeRecentFolders]);

	const topHint = useMemo((): string | null => {
		if (parsed.mode === 'goline') {
			if (parsed.line != null && parsed.line > 0) {
				return t('quickOpen.hint.goToLine', { line: String(parsed.line), file: fileBasename(activeFilePath) || '—' });
			}
			return t('quickOpen.hint.lineNumberExpected');
		}
		if (parsed.mode === 'text') {
			return t('quickOpen.hint.textMode');
		}
		if (parsed.mode === 'symbol') {
			return t('quickOpen.hint.symbolMode');
		}
		return null;
	}, [parsed, t, activeFilePath]);

	const navRows = useMemo((): NavRow[] => {
		const out: NavRow[] = [];
		const addActions = (defs: ActionDef[]) => {
			const f = parsed.mode === 'commands' ? parsed.filter : '';
			for (const a of defs) {
				const label = t(a.labelKey);
				if (f && !label.toLowerCase().includes(f.toLowerCase()) && !a.id.toLowerCase().includes(f.toLowerCase())) {
					continue;
				}
				out.push({
					kind: 'action',
					id: a.id,
					label,
					kbd: a.kbd,
					insertPrefix: a.insertPrefix,
				});
			}
		};

		if (parsed.mode === 'commands') {
			addActions(actionsAll);
			return out;
		}

		if (parsed.mode === 'goline') {
			return out;
		}

		if (parsed.mode === 'text') {
			addActions(actionsAll.filter((a) => a.id === 'searchText'));
			return out;
		}

		if (parsed.mode === 'symbol' && workspaceOpen && searchWorkspaceSymbols) {
			if (!parsed.filter.trim()) {
				addActions(actionsAll);
				return out;
			}
			for (const s of symbolHits.slice(0, MAX_FILES)) {
				out.push({
					kind: 'symbol',
					name: s.name,
					path: s.path,
					line: s.line,
					symKind: s.kind,
				});
			}
			return out;
		}

		const showActions = parsed.mode === 'files' && !parsed.filter;
		if (showActions) {
			addActions(actionsAll);
		}

		if (parsed.mode === 'symbol' || parsed.mode === 'files') {
			if (workspaceOpen) {
				for (const f of filteredFiles) {
					out.push({ kind: 'file', path: f.path, recent: f.recent });
				}
			} else {
				for (const folder of filteredFolders) {
					out.push({ kind: 'folder', path: folder });
				}
			}
		}

		return out;
	}, [parsed, actionsAll, t, filteredFiles, filteredFolders, workspaceOpen, searchWorkspaceSymbols, symbolHits]);

	useEffect(() => {
		if (!open) {
			return;
		}
		setQuery(initialQuery);
		setSelected(0);
		const id = window.setTimeout(() => inputRef.current?.focus(), 30);
		return () => window.clearTimeout(id);
	}, [open, initialQuery]);

	useEffect(() => {
		if (!open || parsed.mode !== 'symbol' || !workspaceOpen || !searchWorkspaceSymbols) {
			setSymbolHits([]);
			return;
		}
		const q = parsed.filter.trim();
		if (!q) {
			setSymbolHits([]);
			return;
		}
		const tid = window.setTimeout(() => {
			void searchWorkspaceSymbols(q)
				.then(setSymbolHits)
				.catch(() => setSymbolHits([]));
		}, 200);
		return () => window.clearTimeout(tid);
	}, [open, parsed.mode, parsed.filter, workspaceOpen, searchWorkspaceSymbols]);

	useEffect(() => {
		if (selected >= navRows.length) {
			setSelected(navRows.length > 0 ? navRows.length - 1 : 0);
		}
	}, [navRows.length, selected]);

	useEffect(() => {
		const el = rowRefs.current.get(selected);
		el?.scrollIntoView({ block: 'nearest' });
	}, [selected]);

	const openFileWithParsedLine = useCallback(
		(relPath: string) => {
			const ln =
				filteredFiles.length === 1 && parsed.line != null
					? parsed.line
					: lineAppliesToPath(relPath, parsed.filter, parsed.line)
						? parsed.line!
						: undefined;
			if (ln != null) {
				onOpenFile(relPath, ln, ln);
			} else {
				onOpenFile(relPath);
			}
		},
		[filteredFiles.length, onOpenFile, parsed.filter, parsed.line]
	);

	const runRow = useCallback(
		(row: NavRow) => {
			if (row.kind === 'action') {
				if (row.insertPrefix) {
					setQuery(row.insertPrefix);
					setSelected(0);
					return;
				}
				if (row.id === 'settings') {
					onOpenSettings();
					onClose();
					return;
				}
				if (row.id === 'openWorkspace') {
					onOpenWorkspacePicker();
					onClose();
					return;
				}
				if (row.id === 'goToFile') {
					setQuery('');
					setSelected(0);
					return;
				}
				if (row.id === 'searchText') {
					onFocusSearchSidebar(parsed.mode === 'text' ? parsed.filter : '');
					onClose();
					return;
				}
			}
			if (row.kind === 'symbol') {
				onOpenFile(row.path, row.line, row.line);
				onClose();
				return;
			}
			if (row.kind === 'file') {
				openFileWithParsedLine(row.path);
				onClose();
				return;
			}
			if (row.kind === 'folder') {
				onOpenWorkspaceFolder(row.path);
				onClose();
			}
		},
		[onClose, onOpenSettings, onOpenWorkspaceFolder, onOpenWorkspacePicker, onFocusSearchSidebar, openFileWithParsedLine, parsed]
	);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setSelected((i) => Math.min(i + 1, Math.max(navRows.length - 1, 0)));
			return;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			setSelected((i) => Math.max(i - 1, 0));
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			if (parsed.mode === 'goline' && parsed.line != null && parsed.line > 0) {
				onGoToLine(parsed.line);
				onClose();
				return;
			}
			if (parsed.mode === 'text' && parsed.filter.trim()) {
				onFocusSearchSidebar(parsed.filter.trim());
				onClose();
				return;
			}
			const row = navRows[selected];
			if (row) {
				runRow(row);
				return;
			}
			if (parsed.mode === 'files' && filteredFiles.length === 1) {
				const only = filteredFiles[0];
				if (only) {
					openFileWithParsedLine(only.path);
					onClose();
				}
			}
		}
	};

	if (!open) {
		return null;
	}

	const placeholder = t('quickOpen.placeholder');
	return (
		<div className="ref-quick-open-backdrop" role="presentation" onMouseDown={onClose}>
			<div
				className="ref-quick-open-panel"
				role="dialog"
				aria-label={t('quickOpen.dialogAria')}
				onMouseDown={(e) => e.stopPropagation()}
			>
				<div className="ref-quick-open-input-wrap">
					<input
						ref={inputRef}
						type="text"
						className="ref-quick-open-input"
						placeholder={placeholder}
						aria-label={placeholder}
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setSelected(0);
						}}
						onKeyDown={onKeyDown}
					/>
				</div>
				{topHint ? <div className="ref-quick-open-hint ref-quick-open-hint--top">{topHint}</div> : null}
				<div className="ref-quick-open-list-wrap">
					{navRows.length === 0 && parsed.mode !== 'goline' ? (
						<div className="ref-quick-open-empty">
							{workspaceOpen ? t('quickOpen.emptyNoMatch') : t('quickOpen.emptyNoProjects')}
						</div>
					) : null}
					{navRows.length > 0 ? (
						<div className="ref-quick-open-list" role="listbox" aria-label={t('quickOpen.listAria')}>
							{navRows.map((row, idx) => {
								const isSel = idx === selected;
								const prev = idx > 0 ? navRows[idx - 1] : undefined;
								const showFileCap =
									workspaceOpen &&
									row.kind === 'file' &&
									(!prev || prev.kind === 'action');
								const showFolderCap =
									!workspaceOpen &&
									row.kind === 'folder' &&
									(!prev || prev.kind === 'action');
								if (row.kind === 'symbol') {
									return (
										<button
											type="button"
											key={`sym-${row.path}-${row.line}-${row.name}-${idx}`}
											ref={(el) => {
												if (el) {
													rowRefs.current.set(idx, el);
												} else {
													rowRefs.current.delete(idx);
												}
											}}
											role="option"
											aria-selected={isSel}
											className={`ref-quick-open-row ref-quick-open-row--symbol ${isSel ? 'is-selected' : ''}`}
											onMouseEnter={() => setSelected(idx)}
											onClick={() => runRow(row)}
										>
											<span className="ref-quick-open-file-icon" aria-hidden>
												<FileTypeIcon fileName={row.path} isDirectory={false} className="ref-quick-open-ft-icon" />
											</span>
											<span className="ref-quick-open-file-text">
												<span className="ref-quick-open-file-name">
													{row.name}
													<span className="ref-quick-open-line-suffix">
														{' '}
														· {row.symKind}
													</span>
												</span>
												<span className="ref-quick-open-file-dir">
													{row.path}:{row.line}
												</span>
											</span>
										</button>
									);
								}
								if (row.kind === 'action') {
									return (
										<button
											key={`a-${row.id}-${idx}`}
											type="button"
											ref={(el) => {
												if (el) {
													rowRefs.current.set(idx, el);
												} else {
													rowRefs.current.delete(idx);
												}
											}}
											role="option"
											aria-selected={isSel}
											className={`ref-quick-open-row ref-quick-open-row--action ${isSel ? 'is-selected' : ''}`}
											onMouseEnter={() => setSelected(idx)}
											onClick={() => runRow(row)}
										>
											<span className="ref-quick-open-row-label">{row.label}</span>
											{row.kbd ? <kbd className="ref-quick-open-row-kbd">{row.kbd}</kbd> : null}
										</button>
									);
								}
								if (row.kind === 'folder') {
									const name = fileBasename(row.path);
									const parent = parentDir(row.path);
									return (
										<Fragment key={`f-${row.path}`}>
											{showFolderCap ? (
												<div className="ref-quick-open-section-cap">{t('quickOpen.recentProjects')}</div>
											) : null}
										<button
											type="button"
											ref={(el) => {
												if (el) {
													rowRefs.current.set(idx, el);
												} else {
													rowRefs.current.delete(idx);
												}
											}}
											role="option"
											aria-selected={isSel}
											className={`ref-quick-open-row ref-quick-open-row--file ${isSel ? 'is-selected' : ''}`}
											onMouseEnter={() => setSelected(idx)}
											onClick={() => runRow(row)}
										>
											<span className="ref-quick-open-file-icon" aria-hidden>
												<FileTypeIcon fileName={name} isDirectory className="ref-quick-open-ft-icon" />
											</span>
											<span className="ref-quick-open-file-text">
												<span className="ref-quick-open-file-name">{name}</span>
												<span className="ref-quick-open-file-dir">{parent || row.path}</span>
											</span>
										</button>
										</Fragment>
									);
								}
								const base = fileBasename(row.path);
								const parent = parentDir(row.path);
								const showLineHint =
									parsed.line != null &&
									parsed.line > 0 &&
									lineAppliesToPath(row.path, parsed.filter, parsed.line);
								return (
									<Fragment key={row.path}>
										{showFileCap ? (
											<div className="ref-quick-open-section-cap">{t('quickOpen.recentlyOpened')}</div>
										) : null}
									<button
										type="button"
										ref={(el) => {
											if (el) {
												rowRefs.current.set(idx, el);
											} else {
												rowRefs.current.delete(idx);
											}
										}}
										role="option"
										aria-selected={isSel}
										className={`ref-quick-open-row ref-quick-open-row--file ${isSel ? 'is-selected' : ''}`}
										onMouseEnter={() => setSelected(idx)}
										onClick={() => runRow(row)}
									>
										<span className="ref-quick-open-file-icon" aria-hidden>
											<FileTypeIcon fileName={base} isDirectory={false} className="ref-quick-open-ft-icon" />
										</span>
										<span className="ref-quick-open-file-text">
											<span className="ref-quick-open-file-name">
												{base}
												{showLineHint ? <span className="ref-quick-open-line-suffix">:{parsed.line}</span> : null}
											</span>
											<span className="ref-quick-open-file-dir">{parent}</span>
										</span>
									</button>
									</Fragment>
								);
							})}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
