import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeGitBranchPopoverLayout } from './anchorPopoverLayout';
import { useI18n } from './i18n';
type ShellApi = NonNullable<Window['asyncShell']>;

const MENU_W = 288;
/** 与 computeGitBranchPopoverLayout 中 chrome 预留一致量级，避免用被 maxHeight 压扁后的 scrollHeight 当 contentHeight */
const GIT_DD_CHROME_PX = 210;
const GIT_DD_ROW_PX = 44;

function IconGitBranch({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="6" cy="6" r="2" />
			<circle cx="18" cy="18" r="2" />
			<circle cx="18" cy="6" r="2" />
			<path d="M6 8v4a2 2 0 0 0 2 2h8M16 8V6" />
		</svg>
	);
}

function IconSearch({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="11" cy="11" r="7" />
			<path d="M21 21l-4.3-4.3" strokeLinecap="round" />
		</svg>
	);
}

function IconCheck({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
			<path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconPlus({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 5v14M5 12h14" strokeLinecap="round" />
		</svg>
	);
}

type Props = {
	open: boolean;
	onClose: () => void;
	anchorRef: React.RefObject<HTMLElement | null>;
	shell: ShellApi | null;
	repoReady: boolean;
	/** 由 `refreshGit` 预取，打开时直接展示 */
	branches: string[];
	listCurrent: string;
	onBranchListFresh?: (branches: string[], current: string) => void;
	displayBranch: string;
	onAfterGitChange: () => void;
	onNotify: (ok: boolean, message: string) => void;
};

export function GitBranchPickerDropdown({
	open,
	onClose,
	anchorRef,
	shell,
	repoReady,
	branches,
	listCurrent,
	onBranchListFresh,
	displayBranch,
	onAfterGitChange,
	onNotify,
}: Props) {
	const { t } = useI18n();
	const menuRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const createInputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState('');
	const [listFetchErr, setListFetchErr] = useState('');
	const [listRefreshing, setListRefreshing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [newBranchDraft, setNewBranchDraft] = useState('');
	const [rendered, setRendered] = useState(open);
	const [layout, setLayout] = useState(() =>
		computeGitBranchPopoverLayout(
			new DOMRect(0, 0, 0, 0),
			{ viewportWidth: 800, viewportHeight: 600, menuWidth: MENU_W, contentHeight: 360 }
		)
	);
	const branchesRef = useRef(branches);
	branchesRef.current = branches;

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) {
			return branches;
		}
		return branches.filter((b) => b.toLowerCase().includes(q));
	}, [branches, query]);

	/** 每次打开时在后台静默同步列表（有预取数据时不显示加载态） */
	useEffect(() => {
		if (!open || !shell || !repoReady) {
			return;
		}
		let cancelled = false;
		setListFetchErr('');
		setListRefreshing(!branchesRef.current.length);
		void (async () => {
			const r = (await shell.invoke('git:listBranches')) as
				| { ok: true; branches: string[]; current: string }
				| { ok: false; error?: string };
			if (cancelled) {
				return;
			}
			setListRefreshing(false);
			if (r.ok) {
				onBranchListFresh?.(Array.isArray(r.branches) ? r.branches : [], typeof r.current === 'string' ? r.current : '');
			} else {
				setListFetchErr(r.error ?? t('git.branchPicker.loadFailed'));
			}
		})();
		return () => {
			cancelled = true;
		};
		/* 故意不依赖 branches：否则列表更新后会重复请求 */
	}, [open, shell, repoReady, onBranchListFresh, t]);

	const computeLayout = useCallback(() => {
		const el = anchorRef.current;
		if (!el) {
			return;
		}
		const menu = menuRef.current;
		const r = el.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const measured = menu?.scrollHeight ?? 0;
		const fromRows = GIT_DD_CHROME_PX + Math.max(filtered.length, 1) * GIT_DD_ROW_PX;
		/* 勿单信 measured：首帧或 maxHeight 已压扁时 scrollHeight 会偏小，导致 maxHeight 锁死过小、列表被挤没 */
		const natural = Math.max(320, measured, fromRows, GIT_DD_CHROME_PX + 3 * GIT_DD_ROW_PX);
		setLayout(
			computeGitBranchPopoverLayout(r, {
				viewportWidth: vw,
				viewportHeight: vh,
				menuWidth: MENU_W,
				contentHeight: natural,
			})
		);
	}, [anchorRef, filtered.length]);

	useLayoutEffect(() => {
		if (!open) {
			return;
		}
		computeLayout();
		const id0 = requestAnimationFrame(() => {
			computeLayout();
			requestAnimationFrame(() => computeLayout());
		});
		const menu = menuRef.current;
		const ro =
			menu && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => computeLayout()) : null;
		if (menu && ro) {
			ro.observe(menu);
		}
		const onWin = () => computeLayout();
		window.addEventListener('resize', onWin);
		window.addEventListener('scroll', onWin, true);
		return () => {
			cancelAnimationFrame(id0);
			ro?.disconnect();
			window.removeEventListener('resize', onWin);
			window.removeEventListener('scroll', onWin, true);
		};
	}, [open, rendered, computeLayout, branches.length, filtered.length, createOpen, query, listRefreshing, listFetchErr]);

	useEffect(() => {
		if (!open || !shell?.subscribeLayout) {
			return;
		}
		return shell.subscribeLayout(() => {
			requestAnimationFrame(() => computeLayout());
		});
	}, [open, shell, computeLayout]);

	useEffect(() => {
		if (open) {
			setRendered(true);
			return;
		}
		if (!rendered) {
			return;
		}
		const id = window.setTimeout(() => setRendered(false), 120);
		return () => window.clearTimeout(id);
	}, [open, rendered]);

	useEffect(() => {
		if (open || rendered) {
			return;
		}
		setQuery('');
		setCreateOpen(false);
		setNewBranchDraft('');
		setListFetchErr('');
		setListRefreshing(false);
	}, [open, rendered]);

	useEffect(() => {
		if (open && rendered && createOpen) {
			requestAnimationFrame(() => createInputRef.current?.focus());
		}
	}, [open, rendered, createOpen]);

	useEffect(() => {
		if (open && rendered && !createOpen) {
			requestAnimationFrame(() => searchRef.current?.focus());
		}
	}, [open, rendered, createOpen]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			const tgt = e.target as Node;
			if (menuRef.current?.contains(tgt) || anchorRef.current?.contains(tgt)) {
				return;
			}
			onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				if (createOpen) {
					e.preventDefault();
					setCreateOpen(false);
					setNewBranchDraft('');
					return;
				}
				onClose();
			}
		};
		document.addEventListener('mousedown', onDoc);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDoc);
			document.removeEventListener('keydown', onKey);
		};
	}, [open, onClose, anchorRef, createOpen]);

	const effectiveCurrent = listCurrent || (displayBranch !== '—' ? displayBranch : '');

	const onSelectBranch = async (name: string) => {
		if (!shell || busy || name === effectiveCurrent) {
			onClose();
			return;
		}
		setBusy(true);
		const r = (await shell.invoke('git:checkoutBranch', name)) as { ok: boolean; error?: string };
		setBusy(false);
		if (r.ok) {
			onNotify(true, t('git.branchPicker.switched', { name }));
			onAfterGitChange();
			onClose();
		} else {
			onNotify(false, r.error ?? t('git.branchPicker.switchFailed'));
		}
	};

	const submitCreate = async () => {
		const name = newBranchDraft.trim();
		if (!shell || !name || busy) {
			return;
		}
		setBusy(true);
		const r = (await shell.invoke('git:createBranch', name)) as { ok: boolean; error?: string };
		setBusy(false);
		if (r.ok) {
			onNotify(true, t('git.branchPicker.created', { name }));
			onAfterGitChange();
			setCreateOpen(false);
			setNewBranchDraft('');
			onClose();
		} else {
			onNotify(false, r.error ?? t('git.branchPicker.createFailed'));
		}
	};

	if (!rendered) {
		return null;
	}

	const showLoading = repoReady && branches.length === 0 && listRefreshing;
	const showListErr = repoReady && listFetchErr && !listRefreshing && branches.length === 0;

	const node = (
		<div
			ref={menuRef}
			className={`ref-git-branch-dd ${layout.placement === 'above' ? 'ref-git-branch-dd--above' : ''} ${!open ? 'is-closing' : ''}`}
			role="dialog"
			aria-label={t('git.branchPicker.dialogAria')}
			style={{
				left: layout.left,
				width: MENU_W,
				top: layout.placement === 'below' ? layout.top : 'auto',
				bottom: layout.placement === 'above' ? layout.bottom : 'auto',
				maxHeight: layout.maxHeightPx,
				...(layout.minHeightPx > 0 ? { minHeight: layout.minHeightPx } : {}),
			}}
		>
			<div className="ref-git-branch-dd-search">
				<IconSearch className="ref-git-branch-dd-search-ico" />
				<input
					ref={searchRef}
					type="search"
					className="ref-git-branch-dd-search-input"
					placeholder={t('git.branchPicker.searchPlaceholder')}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					autoComplete="off"
					spellCheck={false}
				/>
			</div>

			<div className="ref-git-branch-dd-section-label">{t('git.branchPicker.sectionBranches')}</div>

			<div className="ref-git-branch-dd-list" role="listbox" aria-label={t('git.branchPicker.sectionBranches')}>
				{showLoading ? (
					<div className="ref-git-branch-dd-muted">{t('git.branchPicker.loading')}</div>
				) : showListErr ? (
					<div className="ref-git-branch-dd-muted ref-git-branch-dd-err">{listFetchErr}</div>
				) : filtered.length === 0 ? (
					<div className="ref-git-branch-dd-muted">{t('git.branchPicker.empty')}</div>
				) : (
					filtered.map((b) => {
						const isCur = b === effectiveCurrent;
						return (
							<button
								key={b}
								type="button"
								className={`ref-git-branch-dd-row ${isCur ? 'is-current' : ''}`}
								role="option"
								aria-selected={isCur}
								disabled={busy}
								onClick={() => void onSelectBranch(b)}
							>
								<IconGitBranch className="ref-git-branch-dd-row-ico" />
								<span className="ref-git-branch-dd-row-name">{b}</span>
								{isCur ? <IconCheck className="ref-git-branch-dd-row-check" /> : <span className="ref-git-branch-dd-row-check-spacer" />}
							</button>
						);
					})
				)}
			</div>

			<div className="ref-git-branch-dd-sep" />

			{createOpen ? (
				<div className="ref-git-branch-dd-create">
					<input
						ref={createInputRef}
						type="text"
						className="ref-git-branch-dd-create-input"
						placeholder={t('git.branchPicker.newBranchPlaceholder')}
						value={newBranchDraft}
						onChange={(e) => setNewBranchDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								void submitCreate();
							}
						}}
						disabled={busy}
						autoComplete="off"
						spellCheck={false}
					/>
					<div className="ref-git-branch-dd-create-actions">
						<button type="button" className="ref-git-branch-dd-btn-secondary" disabled={busy} onClick={() => setCreateOpen(false)}>
							{t('common.cancel')}
						</button>
						<button type="button" className="ref-git-branch-dd-btn-primary" disabled={busy || !newBranchDraft.trim()} onClick={() => void submitCreate()}>
							{t('git.branchPicker.createConfirm')}
						</button>
					</div>
				</div>
			) : (
				<button type="button" className="ref-git-branch-dd-footer" disabled={busy || showLoading} onClick={() => setCreateOpen(true)}>
					<IconPlus className="ref-git-branch-dd-footer-ico" />
					<span>{t('git.branchPicker.createCheckout')}</span>
				</button>
			)}
		</div>
	);

	return createPortal(node, document.body);
}
