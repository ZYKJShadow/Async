import {
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import { FileTypeIcon } from './fileTypeIcons';
import { useI18n } from './i18n';

export type GitPathStatusMap = Record<string, { xy: string; label: string }>;

type DirEntry = { name: string; isDirectory: boolean; rel: string };

type AsyncShell = NonNullable<Window['asyncShell']>;

/** 资源管理器右键菜单对应的主进程 / 应用层能力（由 App 注入） */
export type WorkspaceExplorerActions = {
	openToSide: (rel: string) => void;
	openInBrowser: (rel: string) => void;
	openWithDefault: (rel: string) => void;
	revealInOs: (rel: string) => void;
	/** 传入作为 PTY 工作目录的相对路径（文件则为所在目录） */
	openInTerminal: (cwdRel: string) => void;
	copyAbsolutePath: (rel: string) => void;
	copyRelativePath: (rel: string) => void;
	copyFileName: (rel: string) => void;
	addToChat: (rel: string) => void;
	addToNewChat: (rel: string) => void;
	rename: (rel: string, isDirectory: boolean) => void;
	delete: (rel: string, isDirectory: boolean) => void;
};

type CtxMenuState = { x: number; y: number; ent: DirEntry };

function IconChevronTree({ open }: { open: boolean }) {
	return (
		<svg
			className={`ref-explorer-chevron-svg ${open ? 'is-open' : ''}`}
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden
		>
			<path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function dirContainsStatus(dirRel: string, statusPaths: string[]): boolean {
	if (!statusPaths.length) {
		return false;
	}
	if (!dirRel) {
		return statusPaths.length > 0;
	}
	const prefix = `${dirRel}/`;
	return statusPaths.some((p) => p === dirRel || p.startsWith(prefix));
}

function fileStatusClass(label: string): string {
	const k = label.toLowerCase();
	if (k === 'u') {
		return 'ref-explorer-name--git-u';
	}
	if (k === 'm') {
		return 'ref-explorer-name--git-m';
	}
	if (k === 'a') {
		return 'ref-explorer-name--git-a';
	}
	if (k === 'd') {
		return 'ref-explorer-name--git-d';
	}
	if (k === 'i') {
		return 'ref-explorer-name--git-i';
	}
	return 'ref-explorer-name--git-other';
}

function badgeVariant(label: string): string {
	const k = label.toLowerCase();
	if (k === 'u' || k === 'm' || k === 'a' || k === 'd' || k === 'i' || k === 'r' || k === 'c' || k === 't') {
		return k;
	}
	return 'misc';
}

function badgeClass(label: string): string {
	return `ref-explorer-badge ref-explorer-badge--${badgeVariant(label)}`;
}

function terminalCwdRelForEntry(ent: DirEntry): string {
	if (ent.isDirectory) {
		return ent.rel;
	}
	const norm = ent.rel.replace(/\\/g, '/');
	const i = norm.lastIndexOf('/');
	return i <= 0 ? '' : norm.slice(0, i);
}

function fileExtLower(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

type Props = {
	shell: AsyncShell;
	pathStatus: GitPathStatusMap;
	selectedRel: string;
	treeEpoch: number;
	onOpenFile: (relPath: string) => void;
	/** 右键菜单；未传则不显示上下文菜单 */
	explorerActions?: WorkspaceExplorerActions | null;
};

function CtxMenuDivider() {
	return <div className="ref-explorer-ctx-divider" role="separator" />;
}

export function WorkspaceExplorer({
	shell,
	pathStatus,
	selectedRel,
	treeEpoch,
	onOpenFile,
	explorerActions: actions,
}: Props) {
	const { t } = useI18n();
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
	const [cache, setCache] = useState<Record<string, DirEntry[]>>({});
	const [loading, setLoading] = useState<Set<string>>(() => new Set());
	const [menu, setMenu] = useState<CtxMenuState | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const expandedRef = useRef(expanded);
	expandedRef.current = expanded;

	const statusPaths = useMemo(() => Object.keys(pathStatus), [pathStatus]);

	const loadDir = useCallback(
		async (rel: string) => {
			setLoading((s) => new Set(s).add(rel));
			try {
				const r = (await shell.invoke('fs:listDir', rel)) as
					| { ok: true; entries: DirEntry[] }
					| { ok: false; error?: string };
				if (r.ok) {
					setCache((c) => ({ ...c, [rel]: r.entries }));
				} else {
					setCache((c) => ({ ...c, [rel]: [] }));
				}
			} finally {
				setLoading((s) => {
					const n = new Set(s);
					n.delete(rel);
					return n;
				});
			}
		},
		[shell]
	);

	useEffect(() => {
		setCache({});
		setExpanded(new Set(['']));
		void loadDir('');
	}, [shell, loadDir]);

	useEffect(() => {
		const dirs = [...new Set(['', ...Array.from(expandedRef.current)])];
		void Promise.all(dirs.map((d) => loadDir(d)));
	}, [treeEpoch, loadDir]);

	useEffect(() => {
		if (!menu) {
			return;
		}
		const onClose = (e: MouseEvent) => {
			if (menuRef.current?.contains(e.target as Node)) {
				return;
			}
			setMenu(null);
		};
		const onScroll = () => setMenu(null);
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				setMenu(null);
			}
		};
		window.addEventListener('mousedown', onClose, true);
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('mousedown', onClose, true);
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('keydown', onKey);
		};
	}, [menu]);

	const toggleDir = (rel: string) => {
		setExpanded((prev) => {
			const n = new Set(prev);
			if (n.has(rel)) {
				n.delete(rel);
			} else {
				n.add(rel);
				if (!cache[rel]) {
					void loadDir(rel);
				}
			}
			return n;
		});
	};

	const runMenu = useCallback((fn: () => void) => {
		setMenu(null);
		fn();
	}, []);

	const renderDir = (parentRel: string, depth: number): ReactNode => {
		const entries = cache[parentRel];
		if (entries === undefined) {
			return loading.has(parentRel) ? (
				<div className="ref-explorer-loading" style={{ paddingLeft: 12 + depth * 14 }}>
					{t('explorer.loading')}
				</div>
			) : null;
		}
		if (entries.length === 0 && parentRel === '' && !loading.has('')) {
			return <div className="ref-explorer-empty">{t('explorer.empty')}</div>;
		}
		return entries.map((ent) => {
			const st = pathStatus[ent.rel];
			const label = st?.label;
			const isOpen = expanded.has(ent.rel);
			const nestedDirty = ent.isDirectory && dirContainsStatus(ent.rel, statusPaths);
			const rowClass = [
				'ref-explorer-row',
				ent.isDirectory ? 'ref-explorer-row--dir' : 'ref-explorer-row--file',
				selectedRel === ent.rel ? 'is-selected' : '',
				ent.isDirectory && nestedDirty ? 'ref-explorer-row--nested-dirty' : '',
			]
				.filter(Boolean)
				.join(' ');

			return (
				<Fragment key={ent.rel}>
					<div
						className={rowClass}
						style={{ paddingLeft: 10 + depth * 14 }}
						role="treeitem"
						aria-expanded={ent.isDirectory ? isOpen : undefined}
						onContextMenu={
							actions
								? (e) => {
										e.preventDefault();
										e.stopPropagation();
										setMenu({ x: e.clientX, y: e.clientY, ent });
									}
								: undefined
						}
					>
						<span className="ref-explorer-chevron-cell">
							{ent.isDirectory ? (
								<button
									type="button"
									className="ref-explorer-chevron-btn"
									aria-label={isOpen ? t('explorer.collapseDir') : t('explorer.expandDir')}
									onClick={(e) => {
										e.stopPropagation();
										toggleDir(ent.rel);
									}}
								>
									<IconChevronTree open={isOpen} />
								</button>
							) : null}
						</span>
						<span className="ref-explorer-icon-cell" aria-hidden>
							<FileTypeIcon fileName={ent.name} isDirectory={ent.isDirectory} />
						</span>
						<button
							type="button"
							className={`ref-explorer-label ${!ent.isDirectory && label ? fileStatusClass(label) : ''} ${ent.isDirectory && !label && nestedDirty ? 'ref-explorer-name--dim-dirty' : ''}`}
							onClick={() => {
								if (ent.isDirectory) {
									toggleDir(ent.rel);
								} else {
									onOpenFile(ent.rel);
								}
							}}
						>
							{ent.name}
						</button>
						{label && !ent.isDirectory ? <span className={badgeClass(label)}>{label}</span> : null}
					</div>
					{ent.isDirectory && isOpen ? renderDir(ent.rel, depth + 1) : null}
				</Fragment>
			);
		});
	};

	const menuEnt = menu?.ent;
	const menuCanBrowser = menuEnt
		? !menuEnt.isDirectory && ['.html', '.htm', '.svg'].includes(fileExtLower(menuEnt.name))
		: false;

	return (
		<div className="ref-explorer-tree-wrap">
			<div className="ref-explorer-tree" role="tree">
				{renderDir('', 0)}
			</div>
			{menu && actions && menuEnt ? (
				<div
					ref={menuRef}
					className="ref-explorer-ctx-menu"
					role="menu"
					style={{ left: menu.x, top: menu.y }}
					onMouseDown={(e) => e.stopPropagation()}
				>
					{!menuEnt.isDirectory ? (
						<button
							type="button"
							role="menuitem"
							className="ref-explorer-ctx-item"
							onClick={() => runMenu(() => actions.openToSide(menuEnt.rel))}
						>
							{t('explorer.ctx.openToSide')}
						</button>
					) : null}
					{!menuEnt.isDirectory ? (
						<button
							type="button"
							role="menuitem"
							className={`ref-explorer-ctx-item ${!menuCanBrowser ? 'is-disabled' : ''}`}
							disabled={!menuCanBrowser}
							onClick={() =>
								menuCanBrowser ? runMenu(() => actions.openInBrowser(menuEnt.rel)) : undefined
							}
						>
							{t('explorer.ctx.openInBrowser')}
						</button>
					) : null}
					{!menuEnt.isDirectory ? (
						<button
							type="button"
							role="menuitem"
							className="ref-explorer-ctx-item"
							onClick={() => runMenu(() => actions.openWithDefault(menuEnt.rel))}
						>
							{t('explorer.ctx.openWith')}
						</button>
					) : null}
					<button
						type="button"
						role="menuitem"
						className="ref-explorer-ctx-item"
						onClick={() => runMenu(() => actions.revealInOs(menuEnt.rel))}
					>
						{t('explorer.ctx.revealInExplorer')}
					</button>
					<button
						type="button"
						role="menuitem"
						className="ref-explorer-ctx-item"
						onClick={() =>
							runMenu(() => actions.openInTerminal(terminalCwdRelForEntry(menuEnt)))
						}
					>
						{t('explorer.ctx.openInTerminal')}
					</button>
					<CtxMenuDivider />
					<div className="ref-explorer-ctx-item is-disabled" role="menuitem" aria-disabled>
						{t('explorer.ctx.share')}
					</div>
					<div className="ref-explorer-ctx-item is-disabled" role="menuitem" aria-disabled>
						{t('explorer.ctx.selectForCompare')}
					</div>
					<CtxMenuDivider />
					{!menuEnt.isDirectory ? (
						<button
							type="button"
							role="menuitem"
							className="ref-explorer-ctx-item"
							onClick={() => runMenu(() => actions.addToChat(menuEnt.rel))}
						>
							{t('explorer.ctx.addToChat')}
						</button>
					) : null}
					{!menuEnt.isDirectory ? (
						<button
							type="button"
							role="menuitem"
							className="ref-explorer-ctx-item"
							onClick={() => runMenu(() => actions.addToNewChat(menuEnt.rel))}
						>
							{t('explorer.ctx.addToNewChat')}
						</button>
					) : null}
					<div className="ref-explorer-ctx-item is-disabled" role="menuitem" aria-disabled>
						{t('explorer.ctx.openTimeline')}
					</div>
					<CtxMenuDivider />
					<div className="ref-explorer-ctx-item is-disabled" role="menuitem" aria-disabled>
						{t('explorer.ctx.cut')}
					</div>
					<button
						type="button"
						role="menuitem"
						className="ref-explorer-ctx-item"
						onClick={() => runMenu(() => actions.copyFileName(menuEnt.rel))}
					>
						{t('explorer.ctx.copy')}
					</button>
					<button
						type="button"
						role="menuitem"
						className="ref-explorer-ctx-item"
						onClick={() => runMenu(() => actions.copyAbsolutePath(menuEnt.rel))}
					>
						{t('explorer.ctx.copyPath')}
					</button>
					<button
						type="button"
						role="menuitem"
						className="ref-explorer-ctx-item"
						onClick={() => runMenu(() => actions.copyRelativePath(menuEnt.rel))}
					>
						{t('explorer.ctx.copyRelPath')}
					</button>
					<CtxMenuDivider />
					<button
						type="button"
						role="menuitem"
						className="ref-explorer-ctx-item"
						onClick={() => runMenu(() => actions.rename(menuEnt.rel, menuEnt.isDirectory))}
					>
						{t('explorer.ctx.rename')}
					</button>
					<button
						type="button"
						role="menuitem"
						className="ref-explorer-ctx-item ref-explorer-ctx-item--danger"
						onClick={() => runMenu(() => actions.delete(menuEnt.rel, menuEnt.isDirectory))}
					>
						{t('explorer.ctx.delete')}
					</button>
				</div>
			) : null}
		</div>
	);
}
