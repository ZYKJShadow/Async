import { app, BrowserWindow } from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { getSettings } from './settingsStore.js';

/** 自动更新状态 */
export type AutoUpdateStatus =
	| { state: 'idle' }
	| { state: 'checking' }
	| { state: 'available'; info: UpdateInfo }
	| { state: 'not-available' }
	| { state: 'downloading'; progress: ProgressInfo }
	| { state: 'downloaded' }
	| { state: 'error'; message: string };

let currentStatus: AutoUpdateStatus = { state: 'idle' };
let updateCheckPromise: Promise<void> | null = null;
let mainWindow: BrowserWindow | null = null;
let isConfigured = false;

/** 设置主窗口引用，用于发送更新事件 */
export function setMainWindow(win: BrowserWindow | null): void {
	mainWindow = win;
}

/** 向渲染进程发送更新状态 */
function sendStatusToRenderer(): void {
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.webContents.send('auto-update:status', currentStatus);
	}
}

/** 检查是否启用自动更新 */
function isAutoUpdateEnabled(): boolean {
	const settings = getSettings();
	return settings.autoUpdate?.enabled !== false; // 默认开启
}

/** 检查是否允许差异化更新 */
function isDifferentialAllowed(): boolean {
	const settings = getSettings();
	return settings.autoUpdate?.allowDifferential !== false; // 默认允许
}

/** 配置 autoUpdater */
function configureUpdater(): void {
	if (isConfigured) {
		return;
	}
	isConfigured = true;

	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	
	// 设置 GitHub 仓库（从 package.json 的 repository 或硬编码）
	autoUpdater.setFeedURL({
		provider: 'github',
		owner: 'ZYKJShadow',
		repo: 'Async',
	});

	autoUpdater.on('checking-for-update', () => {
		console.log('[AutoUpdate] Checking for updates...');
		currentStatus = { state: 'checking' };
		sendStatusToRenderer();
	});

	autoUpdater.on('update-available', (info: UpdateInfo) => {
		console.log('[AutoUpdate] Update available:', info.version);
		currentStatus = { state: 'available', info };
		sendStatusToRenderer();
	});

	autoUpdater.on('update-not-available', () => {
		console.log('[AutoUpdate] Update not available');
		currentStatus = { state: 'not-available' };
		sendStatusToRenderer();
	});

	autoUpdater.on('error', (err: Error) => {
		console.error('[AutoUpdate] Error:', err.message);
		currentStatus = { state: 'error', message: err.message };
		sendStatusToRenderer();
	});

	autoUpdater.on('download-progress', (progress: ProgressInfo) => {
		console.log('[AutoUpdate] Download progress:', progress.percent.toFixed(2) + '%');
		currentStatus = { state: 'downloading', progress };
		sendStatusToRenderer();
	});

	autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
		console.log('[AutoUpdate] Update downloaded:', info.version);
		currentStatus = { state: 'downloaded' };
		sendStatusToRenderer();
	});
}

/** 检查更新 */
export async function checkForUpdates(): Promise<AutoUpdateStatus> {
	if (!isAutoUpdateEnabled()) {
		console.log('[AutoUpdate] Auto-update is disabled');
		currentStatus = { state: 'idle' };
		return currentStatus;
	}

	// 如果正在检查，返回现有 promise
	if (updateCheckPromise) {
		return currentStatus;
	}

	configureUpdater();

	updateCheckPromise = (async () => {
		try {
			await autoUpdater.checkForUpdates();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('[AutoUpdate] Check failed:', message);
			currentStatus = { state: 'error', message };
			sendStatusToRenderer();
		} finally {
			updateCheckPromise = null;
		}
	})();

	await updateCheckPromise;
	return currentStatus;
}

/** 下载更新 */
export async function downloadUpdate(): Promise<void> {
	if (!isAutoUpdateEnabled()) {
		throw new Error('Auto-update is disabled');
	}

	if (currentStatus.state !== 'available') {
		throw new Error('No update available to download');
	}

	// 如果禁用差异化更新，强制全量下载
	if (!isDifferentialAllowed()) {
		autoUpdater.downloadUpdate(undefined, false);
	} else {
		autoUpdater.downloadUpdate();
	}
}

/** 重启并安装更新 */
export function quitAndInstall(): void {
	if (currentStatus.state !== 'downloaded') {
		throw new Error('Update not downloaded yet');
	}
	autoUpdater.quitAndInstall();
}

/** 获取当前状态 */
export function getStatus(): AutoUpdateStatus {
	return currentStatus;
}

/** 初始化自动更新（在 app.ready 后调用） */
export function initAutoUpdate(win: BrowserWindow): void {
	setMainWindow(win);

	// 延迟 30 秒后首次检查更新，避免影响启动性能
	setTimeout(() => {
		if (isAutoUpdateEnabled()) {
			checkForUpdates().catch((err) => {
				console.error('[AutoUpdate] Initial check failed:', err);
			});
		}
	}, 30000);

	// 每小时检查一次更新
	setInterval(() => {
		if (isAutoUpdateEnabled()) {
			checkForUpdates().catch((err) => {
				console.error('[AutoUpdate] Periodic check failed:', err);
			});
		}
	}, 60 * 60 * 1000);
}
