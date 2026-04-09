import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	buildStaticAtMenuItems,
	filterAtMenuItems,
	getAtMentionRange,
	type AtMenuItem,
} from './composerAtMention';
import type { WorkspaceFileSearchItem } from './hooks/useWorkspaceManager';
import { newSegmentId, type ComposerSegment } from './composerSegments';
import { snapshotDomRect, type CaretRectSnapshot } from './caretRectSnapshot';
import {
	applyFileChipFromAtMention,
	applyStaticMentionInsert,
	getCaretRectFromRichRoot,
	readSegmentsFromRoot,
	textBeforeCaretForAt,
	type FileChipDomHandlers,
} from './composerRichDom';

export type AtComposerSlot = 'hero' | 'bottom' | 'inline';

/** 与 claude-code 统一建议量级接近：控制菜单高度与主进程 top-K */
const AT_MENU_FILE_RESULTS_LIMIT = 15;
const AT_MENU_SEARCH_DEBOUNCE_MS = 50;

type RichRefs = {
	hero: React.RefObject<HTMLDivElement | null>;
	bottom: React.RefObject<HTMLDivElement | null>;
	inline: React.RefObject<HTMLDivElement | null>;
};

function makeFileAtMenuItem(slash: string): AtMenuItem {
	const base = slash.split('/').pop() || slash;
	return {
		id: `ws:${slash}`,
		label: base,
		subtitle: slash,
		insertText: `@${slash}`,
		icon: 'file' as const,
	};
}

export function useComposerAtMention(
	getSegmentsSetter: (slot: AtComposerSlot) => React.Dispatch<React.SetStateAction<ComposerSegment[]>>,
	richRefs: RichRefs,
	opts: {
		gitChangedPaths: string[];
		currentThreadTitle: string;
		workspaceOpen: boolean;
		/** 按需搜索工作区文件（IPC，主进程侧过滤） */
		searchFiles: (query: string, gitChangedPaths: string[], limit?: number) => Promise<WorkspaceFileSearchItem[]>;
		onFileChipPreview: (relPath: string) => void;
		/** 主进程首次索引扫描完成时递增，用于菜单打开期间重跑当前 query */
		fileIndexReadyTick?: number;
		/** 当前布局模式：agent 优先展示近期 git 改动文件；editor 优先展示左侧预览文件 */
		layoutMode?: 'agent' | 'editor';
		/** editor 布局下左侧当前预览的文件（相对路径） */
		editorPreviewFile?: string;
	}
) {
	const atSlotRef = useRef<AtComposerSlot>('bottom');
	const [atOpen, setAtOpen] = useState(false);
	const [atQuery, setAtQuery] = useState('');
	const [atHighlight, setAtHighlight] = useState(0);
	const [atCaretRect, setAtCaretRect] = useState<CaretRectSnapshot | null>(null);
	/** 上一次 sync 时的 @ 查询词；用于避免 keyup→sync 时误把方向键选中的项重置回第一项 */
	const lastSyncedAtQueryRef = useRef<string | null>(null);

	const staticItems = useMemo(
		() =>
			buildStaticAtMenuItems({
				currentThreadTitle: opts.currentThreadTitle,
				workspaceOpen: opts.workspaceOpen,
			}),
		[opts.currentThreadTitle, opts.workspaceOpen]
	);

	// ── 文件搜索（按需 IPC，不依赖预加载的全量文件列表）──────────────────────
	const [fileItems, setFileItems] = useState<AtMenuItem[]>([]);
	const [atFileSearchLoading, setAtFileSearchLoading] = useState(false);
	const searchSeqRef = useRef(0);

	/**
	 * `gitChangedPaths` 作为 useEffect 依赖会让 git 刷新时（每次 setState 新数组）重复触发
	 * IPC 搜索；用 ref 旁路后仅在 atOpen/atQuery 变化时真正跑 IPC。
	 */
	const searchArgsRef = useRef({
		searchFiles: opts.searchFiles,
		gitChangedPaths: opts.gitChangedPaths,
	});
	searchArgsRef.current.searchFiles = opts.searchFiles;
	searchArgsRef.current.gitChangedPaths = opts.gitChangedPaths;

	/** 空 query 时是否已有足够的置顶项可直接展示，无需走 IPC */
	const hasPinnedForEmptyQuery =
		(opts.layoutMode === 'agent' && opts.gitChangedPaths.length > 0) ||
		(opts.layoutMode === 'editor' && !!opts.editorPreviewFile);

	useEffect(() => {
		if (!atOpen) {
			setFileItems([]);
			setAtFileSearchLoading(false);
			return;
		}
		/**
		 * 空 query 场景：按 ≤3 个置顶文件直接展示，跳过 IPC 调用。
		 * 避免每次按下 @ 都把整包 gitChangedPaths 通过 IPC 序列化到主进程再拿回来，
		 * 也避免首帧把大菜单渲染出来后又被覆写，主线程因此明显卡顿。
		 */
		if (!atQuery && hasPinnedForEmptyQuery) {
			searchSeqRef.current += 1;
			setFileItems([]);
			setAtFileSearchLoading(false);
			return;
		}
		const seq = ++searchSeqRef.current;
		const delay = atQuery ? AT_MENU_SEARCH_DEBOUNCE_MS : 0;
		setAtFileSearchLoading(true);
		const timer = window.setTimeout(() => {
			void (async () => {
				try {
					const items = await searchArgsRef.current.searchFiles(
						atQuery,
						searchArgsRef.current.gitChangedPaths,
						AT_MENU_FILE_RESULTS_LIMIT
					);
					if (seq !== searchSeqRef.current) {
						return;
					}
					setFileItems(
						items.map((it) => ({
							id: `ws:${it.path}`,
							label: it.label,
							subtitle: it.description,
							insertText: `@${it.path}`,
							icon: 'file' as const,
						}))
					);
				} catch {
					/* ignore */
				} finally {
					if (seq === searchSeqRef.current) {
						setAtFileSearchLoading(false);
					}
				}
			})();
		}, delay);
		return () => {
			window.clearTimeout(timer);
		};
	}, [atOpen, atQuery, hasPinnedForEmptyQuery, opts.fileIndexReadyTick ?? 0]);

	const filteredStatic = useMemo(
		() => filterAtMenuItems(staticItems, atQuery),
		[staticItems, atQuery]
	);

	/** 文件命中优先，静态项殿后；空 query 时按布局将置顶文件提前，且最多展示 3 个文件 */
	const filtered = useMemo(() => {
		if (!atQuery) {
			const normPath = (p: string) => p.replace(/\\/g, '/');
			let pinned: AtMenuItem[] = [];

			if (opts.layoutMode === 'agent') {
				// agent 布局：取最近 git 改动的前 3 个文件置顶
				pinned = opts.gitChangedPaths
					.slice(0, 3)
					.map((p) => makeFileAtMenuItem(normPath(p)));
			} else if (opts.layoutMode === 'editor') {
				// editor 布局：将左侧当前预览文件置顶
				const preview = opts.editorPreviewFile ? normPath(opts.editorPreviewFile) : '';
				if (preview) {
					pinned = [makeFileAtMenuItem(preview)];
				}
			}

			const pinnedIds = new Set(pinned.map((i) => i.id));
			const rest = fileItems.filter((i) => !pinnedIds.has(i.id));
			const files = [...pinned, ...rest].slice(0, 3);
			return [...files, ...filteredStatic];
		}
		return [...fileItems, ...filteredStatic];
	}, [atQuery, fileItems, filteredStatic, opts.layoutMode, opts.editorPreviewFile, opts.gitChangedPaths]);

	const filteredRef = useRef(filtered);
	const highlightRef = useRef(atHighlight);
	useEffect(() => {
		filteredRef.current = filtered;
		highlightRef.current = atHighlight;
	}, [filtered, atHighlight]);

	const closeAtMenu = useCallback(() => {
		lastSyncedAtQueryRef.current = null;
		setAtOpen(false);
		setAtCaretRect(null);
	}, []);

	const getRich = useCallback(() => {
		switch (atSlotRef.current) {
			case 'hero':
				return richRefs.hero.current;
			case 'bottom':
				return richRefs.bottom.current;
			case 'inline':
				return richRefs.inline.current;
			default:
				return null;
		}
	}, [richRefs.hero, richRefs.bottom, richRefs.inline]);

	const makeDomHandlers = useCallback(
		(root: HTMLElement): FileChipDomHandlers => ({
			onPreview: opts.onFileChipPreview,
			onStructureChange: () => {
				getSegmentsSetter(atSlotRef.current)(readSegmentsFromRoot(root));
			},
		}),
		[opts.onFileChipPreview, getSegmentsSetter]
	);

	const syncAtFromRich = useCallback(
		(root: HTMLElement, slot: AtComposerSlot) => {
			atSlotRef.current = slot;
			const slice = textBeforeCaretForAt(root);
			const caret = slice.length;
			const r = getAtMentionRange(slice, caret);
			if (!r) {
				closeAtMenu();
				return;
			}
			const q = r.query;
			const prevQ = lastSyncedAtQueryRef.current;
			lastSyncedAtQueryRef.current = q;
			setAtQuery(q);
			setAtCaretRect(snapshotDomRect(getCaretRectFromRichRoot(root)));
			setAtOpen(true);
			if (prevQ !== q) {
				setAtHighlight(0);
			} else {
				setAtHighlight((h) => {
					const len = filteredRef.current.length;
					if (len <= 0) {
						return 0;
					}
					return Math.min(Math.max(0, h), len - 1);
				});
			}
		},
		[closeAtMenu]
	);

	/** 窗口缩放、侧栏拖拽、滚动后 @ 菜单位置依赖的光标矩形会过期，需重新测量 */
	useEffect(() => {
		if (!atOpen) {
			return;
		}
		let rafFollowUp = 0;
		const reposition = () => {
			const root = getRich();
			if (!root) {
				return;
			}
			const slice = textBeforeCaretForAt(root);
			const caret = slice.length;
			const mention = getAtMentionRange(slice, caret);
			if (!mention) {
				closeAtMenu();
				return;
			}
			const rect = getCaretRectFromRichRoot(root);
			const snap = snapshotDomRect(rect);
			if (snap) {
				setAtCaretRect(snap);
			}
		};
		/**
		 * 先同步量一次：ResizeObserver 在布局之后触发，此时 getBoundingClientRect 与 fixed 菜单同一坐标系。
		 * 再跟一帧 rAF：覆盖 window.resize 略早于子节点 flex 排版的偶发情况。
		 * 避免双 rAF，否则窗口拉高后会有约两帧仍用旧坐标，菜单与输入框明显分离。
		 */
		const scheduleReposition = () => {
			cancelAnimationFrame(rafFollowUp);
			reposition();
			rafFollowUp = requestAnimationFrame(() => {
				rafFollowUp = 0;
				reposition();
			});
		};
		scheduleReposition();
		window.addEventListener('resize', scheduleReposition);
		window.addEventListener('scroll', scheduleReposition, true);
		const richRoot = getRich();
		const roRich =
			typeof ResizeObserver !== 'undefined' && richRoot ? new ResizeObserver(scheduleReposition) : null;
		if (richRoot && roRich) {
			roRich.observe(richRoot);
		}
		const docEl = typeof document !== 'undefined' ? document.documentElement : null;
		const roDoc =
			typeof ResizeObserver !== 'undefined' && docEl ? new ResizeObserver(scheduleReposition) : null;
		if (docEl && roDoc) {
			roDoc.observe(docEl);
		}
		const vv = typeof window !== 'undefined' ? window.visualViewport : null;
		if (vv) {
			vv.addEventListener('resize', scheduleReposition);
			vv.addEventListener('scroll', scheduleReposition);
		}
		const unsubLayout = window.asyncShell?.subscribeLayout?.(scheduleReposition);
		return () => {
			cancelAnimationFrame(rafFollowUp);
			window.removeEventListener('resize', scheduleReposition);
			window.removeEventListener('scroll', scheduleReposition, true);
			roRich?.disconnect();
			roDoc?.disconnect();
			if (vv) {
				vv.removeEventListener('resize', scheduleReposition);
				vv.removeEventListener('scroll', scheduleReposition);
			}
			unsubLayout?.();
		};
	}, [atOpen, getRich, closeAtMenu]);

	const applyAtSelection = useCallback(
		(item: AtMenuItem) => {
			const root = getRich();
			if (!root) {
				closeAtMenu();
				return;
			}
			const slice = textBeforeCaretForAt(root);
			const caret = slice.length;
			const r = getAtMentionRange(slice, caret);
			if (!r) {
				closeAtMenu();
				return;
			}
			const h = makeDomHandlers(root);
			if (item.id.startsWith('ws:')) {
				const rel = item.id.slice(3);
				applyFileChipFromAtMention(root, rel, newSegmentId(), h);
				closeAtMenu();
				return;
			}
			const insert = item.insertText.endsWith(' ') ? item.insertText : `${item.insertText} `;
			applyStaticMentionInsert(root, insert, h);
			closeAtMenu();
		},
		[closeAtMenu, getRich, makeDomHandlers]
	);

	/** 避免 applyAtSelection 随 onFileChipPreview 等抖动 → handleAtKeyDown 重建 → sharedComposerProps 连带失效 */
	const applyAtSelectionRef = useRef(applyAtSelection);
	applyAtSelectionRef.current = applyAtSelection;

	const handleAtKeyDown = useCallback(
		(e: React.KeyboardEvent): boolean => {
			if (!atOpen) {
				return false;
			}
			if (filteredRef.current.length === 0) {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					closeAtMenu();
					return true;
				}
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					return true;
				}
				return false;
			}
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setAtHighlight((h) => (h + 1) % filteredRef.current.length);
				return true;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setAtHighlight((h) => (h - 1 + filteredRef.current.length) % filteredRef.current.length);
				return true;
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				const list = filteredRef.current;
				const hi = highlightRef.current;
				const it = list[Math.min(hi, list.length - 1)];
				if (it) {
					applyAtSelectionRef.current(it);
				}
				return true;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				closeAtMenu();
				return true;
			}
			return false;
		},
		[atOpen, closeAtMenu]
	);

	return {
		atMenuOpen: atOpen,
		atMenuItems: filtered,
		atMenuHighlight: atHighlight,
		atMenuFileSearchLoading: atFileSearchLoading,
		atCaretRect,
		syncAtFromRich,
		setAtMenuHighlight: setAtHighlight,
		applyAtSelection,
		handleAtKeyDown,
		closeAtMenu,
	};
}
