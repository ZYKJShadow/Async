import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
	clampSidebarLayout,
	defaultQuarterRailWidths,
	syncDesktopSidebarLayout,
} from '../app/shellLayoutStorage';
import { clampEditorTerminalHeight } from './useEditorTabs';

export type RailWidths = { left: number; right: number };

export type UseResizeRailsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	sidebarLayoutStorageKey: string;
	railWidths: RailWidths;
	setRailWidths: Dispatch<SetStateAction<RailWidths>>;
	editorTerminalHeightPx: number;
	setEditorTerminalHeightPx: Dispatch<SetStateAction<number>>;
	editorTerminalHeightLsKey: string;
};

export type UseResizeRailsResult = {
	persistRailWidths: (next: RailWidths) => void;
	beginResizeLeft: (e: React.MouseEvent) => void;
	beginResizeRight: (e: React.MouseEvent) => void;
	beginResizeEditorTerminal: (e: React.MouseEvent) => void;
	resetRailWidths: () => void;
};

/**
 * 侧栏 / 编辑器底部终端的拖拽 resize 与持久化。
 *
 * 行为与原 App.tsx 保留完全一致：
 *  - left/right rail 拖动时实时 setRailWidths，松手时 clamp + 写 localStorage + IPC 同步主进程
 *  - editor terminal 高度 resize 同理（垂直手柄）
 *  - resetRailWidths 一键恢复默认四分位宽度
 */
export function useResizeRails(params: UseResizeRailsParams): UseResizeRailsResult {
	const {
		shell,
		sidebarLayoutStorageKey,
		railWidths,
		setRailWidths,
		editorTerminalHeightPx,
		setEditorTerminalHeightPx,
		editorTerminalHeightLsKey,
	} = params;

	const persistRailWidths = useCallback(
		(next: RailWidths) => {
			const c = clampSidebarLayout(next.left, next.right);
			setRailWidths(c);
			try {
				localStorage.setItem(sidebarLayoutStorageKey, JSON.stringify(c));
			} catch {
				/* ignore */
			}
			syncDesktopSidebarLayout(shell ?? undefined, c);
		},
		[shell, sidebarLayoutStorageKey, setRailWidths]
	);

	const beginResizeLeft = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const { left, right } = railWidths;
			const onMove = (ev: MouseEvent) => {
				const nl = left + (ev.clientX - startX);
				setRailWidths(clampSidebarLayout(nl, right));
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				setRailWidths((prev) => {
					const c = clampSidebarLayout(prev.left, prev.right);
					try {
						localStorage.setItem(sidebarLayoutStorageKey, JSON.stringify(c));
					} catch {
						/* ignore */
					}
					syncDesktopSidebarLayout(shell ?? undefined, c);
					return c;
				});
			};
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		},
		[railWidths.left, railWidths.right, shell, sidebarLayoutStorageKey, setRailWidths]
	);

	const beginResizeRight = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const { left, right } = railWidths;
			const onMove = (ev: MouseEvent) => {
				const nr = right - (ev.clientX - startX);
				setRailWidths(clampSidebarLayout(left, nr));
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				setRailWidths((prev) => {
					const c = clampSidebarLayout(prev.left, prev.right);
					try {
						localStorage.setItem(sidebarLayoutStorageKey, JSON.stringify(c));
					} catch {
						/* ignore */
					}
					syncDesktopSidebarLayout(shell ?? undefined, c);
					return c;
				});
			};
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		},
		[railWidths.left, railWidths.right, shell, sidebarLayoutStorageKey, setRailWidths]
	);

	const beginResizeEditorTerminal = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const startY = e.clientY;
			const startH = editorTerminalHeightPx;
			const onMove = (ev: MouseEvent) => {
				const next = clampEditorTerminalHeight(startH - (ev.clientY - startY));
				setEditorTerminalHeightPx(next);
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				setEditorTerminalHeightPx((h) => {
					const c = clampEditorTerminalHeight(h);
					try {
						localStorage.setItem(editorTerminalHeightLsKey, String(c));
					} catch {
						/* ignore */
					}
					return c;
				});
			};
			document.body.style.cursor = 'row-resize';
			document.body.style.userSelect = 'none';
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		},
		[editorTerminalHeightPx, editorTerminalHeightLsKey, setEditorTerminalHeightPx]
	);

	const resetRailWidths = useCallback(() => {
		persistRailWidths(defaultQuarterRailWidths());
	}, [persistRailWidths]);

	return {
		persistRailWidths,
		beginResizeLeft,
		beginResizeRight,
		beginResizeEditorTerminal,
		resetRailWidths,
	};
}
