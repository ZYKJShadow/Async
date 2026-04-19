import { useCallback, type Dispatch, type SetStateAction } from 'react';

export type UseUiZoomParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	setUiZoom: Dispatch<SetStateAction<number>>;
	setWindowMaximized: Dispatch<SetStateAction<boolean>>;
};

export type UseUiZoomResult = {
	zoomInUi: () => void;
	zoomOutUi: () => void;
	resetUiZoom: () => void;
	toggleFullscreen: () => Promise<void>;
	windowMenuMinimize: () => Promise<void>;
	windowMenuToggleMaximize: () => Promise<void>;
	windowMenuCloseWindow: () => Promise<void>;
};

/**
 * UI 缩放（0.8 ~ 1.6，步进 0.1）+ 全屏切换 + 窗口菜单(最小化 / 最大化切换 / 关闭窗口)。
 *
 * 行为与 App.tsx 保持完全一致：
 *  - zoom 上下限通过 Math.min/Math.max 钳制；
 *  - toggleMaximize 后再读取一次 windowGetState 以同步 windowMaximized；
 *  - shell 缺失时各 windowMenu* 静默 no-op。
 */
export function useUiZoom(params: UseUiZoomParams): UseUiZoomResult {
	const { shell, setUiZoom, setWindowMaximized } = params;

	const zoomInUi = useCallback(() => {
		setUiZoom((value) => Math.min(1.6, Math.round((value + 0.1) * 10) / 10));
	}, [setUiZoom]);

	const zoomOutUi = useCallback(() => {
		setUiZoom((value) => Math.max(0.8, Math.round((value - 0.1) * 10) / 10));
	}, [setUiZoom]);

	const resetUiZoom = useCallback(() => {
		setUiZoom(1);
	}, [setUiZoom]);

	const toggleFullscreen = useCallback(async () => {
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
			} else {
				await document.documentElement.requestFullscreen();
			}
		} catch {
			/* ignore */
		}
	}, []);

	const windowMenuMinimize = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('app:windowMinimize');
	}, [shell]);

	const windowMenuToggleMaximize = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('app:windowToggleMaximize');
		const r = (await shell.invoke('app:windowGetState')) as { ok?: boolean; maximized?: boolean };
		if (r?.ok && typeof r.maximized === 'boolean') {
			setWindowMaximized(r.maximized);
		}
	}, [shell, setWindowMaximized]);

	const windowMenuCloseWindow = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('app:windowClose');
	}, [shell]);

	return {
		zoomInUi,
		zoomOutUi,
		resetUiZoom,
		toggleFullscreen,
		windowMenuMinimize,
		windowMenuToggleMaximize,
		windowMenuCloseWindow,
	};
}
