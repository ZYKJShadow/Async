import { app, BrowserWindow, shell } from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { getSettings } from './settingsStore.js';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/** 自动更新状态 */
export type AutoUpdateStatus =
	| { state: 'idle' }
	| { state: 'checking' }
	| { state: 'available'; info: UpdateInfo }
	| { state: 'not-available' }
	| { state: 'downloading'; progress: ProgressInfo }
	| { state: 'downloaded'; platform: NodeJS.Platform; isSigned: boolean; downloadPath?: string }
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

function syncDifferentialDownloadSetting(): void {
	autoUpdater.disableDifferentialDownload = !isDifferentialAllowed();
}

/** 配置 autoUpdater */
function configureUpdater(): void {
	if (isConfigured) {
		return;
	}
	isConfigured = true;

	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	syncDifferentialDownloadSetting();

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

		const platform = process.platform;
		const signed = isAppSigned();

		if (platform === 'darwin' && !signed) {
			// macOS 无签名：将更新包复制到 Downloads，提示用户手动安装
			const downloadedFile = getDownloadedUpdatePath();
			if (downloadedFile) {
				const downloadsDir = join(app.getPath('home'), 'Downloads');
				const dest = join(downloadsDir, `Async-IDE-${info.version}-mac-update.zip`);
				try {
					if (!existsSync(downloadsDir)) {
						mkdirSync(downloadsDir, { recursive: true });
					}
					copyFileSync(downloadedFile, dest);
					console.log('[AutoUpdate] Copied update to Downloads:', dest);
					currentStatus = { state: 'downloaded', platform, isSigned: false, downloadPath: dest };
				} catch (e) {
					console.error('[AutoUpdate] Failed to copy update to Downloads:', e);
					currentStatus = { state: 'downloaded', platform, isSigned: false };
				}
			} else {
				currentStatus = { state: 'downloaded', platform, isSigned: false };
			}
		} else {
			currentStatus = { state: 'downloaded', platform, isSigned: signed };
		}
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
	syncDifferentialDownloadSetting();

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

	// 如果禁用差异化更新，强制全量下载；每次下载前同步，避免设置切回后沿用旧状态。
	syncDifferentialDownloadSetting();
	await autoUpdater.downloadUpdate();
}

/** 检测应用是否被代码签名 */
function isAppSigned(): boolean {
	if (process.platform !== 'darwin') {
		return true; // 非 macOS 无需检测
	}
	try {
		const { execSync } = require('child_process');
		const appPath = app.getPath('exe');
		// codesign -dv 会输出签名信息；未签名时返回非零退出码
		execSync(`codesign -dv "${appPath}"`, { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

/** 获取已下载的更新包路径（electron-updater 内部属性） */
function getDownloadedUpdatePath(): string | undefined {
	try {
		const updater = autoUpdater as any;
		return updater.downloadedUpdateHelper?.file;
	} catch {
		return undefined;
	}
}

/** 重启并安装更新 */
export function quitAndInstall(): void {
	if (currentStatus.state !== 'downloaded') {
		throw new Error('Update not downloaded yet');
	}

	// macOS 无签名：无法自动安装，打开下载文件夹
	if (currentStatus.platform === 'darwin' && !currentStatus.isSigned) {
		const downloadPath = currentStatus.downloadPath;
		if (downloadPath) {
			shell.showItemInFolder(downloadPath);
		} else {
			shell.openPath(join(app.getPath('home'), 'Downloads'));
		}
		return;
	}

	autoUpdater.quitAndInstall();
}

/** 打开更新包所在文件夹 */
export function openUpdateFolder(): void {
	if (currentStatus.state !== 'downloaded') {
		return;
	}
	const downloadPath = currentStatus.downloadPath;
	if (downloadPath) {
		shell.showItemInFolder(downloadPath);
	} else {
		shell.openPath(join(app.getPath('home'), 'Downloads'));
	}
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
