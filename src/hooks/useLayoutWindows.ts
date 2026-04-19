import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
	syncDesktopShellLayoutMode,
	writeStoredShellLayoutMode,
	type ShellLayoutMode,
} from '../app/shellLayoutStorage';

export type UseLayoutWindowsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	shellLayoutStorageKey: string;
	setLayoutMode: Dispatch<SetStateAction<ShellLayoutMode>>;
	composerRichBottomRef: RefObject<HTMLDivElement | null>;
	composerRichHeroRef: RefObject<HTMLDivElement | null>;
	refreshLayoutWindowAvailability: () => Promise<void> | void;
};

export type UseLayoutWindowsResult = {
	handleReturnToAgentLayout: () => void;
	handleEnterEditorLayout: () => void;
	handleOpenAgentLayoutWindow: () => Promise<void>;
	handleOpenEditorLayoutWindow: () => Promise<void>;
};

/**
 * 在「Agent 布局」与「Editor 布局」之间切换；优先打开/聚焦独立窗口，无 shell 时降级为同窗内切布局。
 *
 * 行为与 App.tsx 保持一致：
 *  - 进入 Agent 时下一个微任务把焦点送到 composer（底/英雄区任一存在的）；
 *  - localStorage + IPC 同步双写；
 *  - openOrFocusWindowSurface 失败静默忽略，不抛给 UI。
 */
export function useLayoutWindows(params: UseLayoutWindowsParams): UseLayoutWindowsResult {
	const {
		shell,
		shellLayoutStorageKey,
		setLayoutMode,
		composerRichBottomRef,
		composerRichHeroRef,
		refreshLayoutWindowAvailability,
	} = params;

	const handleReturnToAgentLayout = useCallback(() => {
		setLayoutMode('agent');
		writeStoredShellLayoutMode('agent', shellLayoutStorageKey);
		syncDesktopShellLayoutMode(shell, 'agent');
		queueMicrotask(() => {
			if (composerRichBottomRef.current) {
				composerRichBottomRef.current.focus();
			} else {
				composerRichHeroRef.current?.focus();
			}
		});
	}, [shell, shellLayoutStorageKey, setLayoutMode, composerRichBottomRef, composerRichHeroRef]);

	const handleEnterEditorLayout = useCallback(() => {
		setLayoutMode('editor');
		writeStoredShellLayoutMode('editor', shellLayoutStorageKey);
		syncDesktopShellLayoutMode(shell, 'editor');
	}, [shell, shellLayoutStorageKey, setLayoutMode]);

	const handleOpenAgentLayoutWindow = useCallback(async () => {
		if (!shell) {
			handleReturnToAgentLayout();
			return;
		}
		try {
			await shell.invoke('app:openOrFocusWindowSurface', 'agent');
			await refreshLayoutWindowAvailability();
		} catch {
			/* ignore */
		}
	}, [handleReturnToAgentLayout, refreshLayoutWindowAvailability, shell]);

	const handleOpenEditorLayoutWindow = useCallback(async () => {
		if (!shell) {
			handleEnterEditorLayout();
			return;
		}
		try {
			await shell.invoke('app:openOrFocusWindowSurface', 'editor');
			await refreshLayoutWindowAvailability();
		} catch {
			/* ignore */
		}
	}, [handleEnterEditorLayout, refreshLayoutWindowAvailability, shell]);

	return {
		handleReturnToAgentLayout,
		handleEnterEditorLayout,
		handleOpenAgentLayoutWindow,
		handleOpenEditorLayoutWindow,
	};
}
