import { ipcMain } from 'electron';
import {
	checkForUpdates,
	downloadUpdate,
	getStatus,
	quitAndInstall,
	type AutoUpdateStatus,
} from '../../autoUpdate.js';

/**
 * 自动更新 IPC：检查 / 下载 / 安装 / 状态。行为与原 register.ts 完全一致。
 */
export function registerAutoUpdateHandlers(): void {
	ipcMain.handle('auto-update:check', async (): Promise<AutoUpdateStatus> => {
		try {
			return await checkForUpdates();
		} catch (e) {
			return { state: 'error', message: String(e) };
		}
	});

	/** 自动更新：下载更新 */
	ipcMain.handle('auto-update:download', async (): Promise<{ ok: boolean; error?: string }> => {
		try {
			await downloadUpdate();
			return { ok: true };
		} catch (e) {
			return { ok: false, error: String(e) };
		}
	});

	/** 自动更新：重启并安装 */
	ipcMain.handle('auto-update:install', (): Promise<{ ok: boolean; error?: string }> => {
		try {
			quitAndInstall();
			return Promise.resolve({ ok: true });
		} catch (e) {
			return Promise.resolve({ ok: false, error: String(e) });
		}
	});

	/** 自动更新：获取当前状态 */
	ipcMain.handle('auto-update:get-status', (): AutoUpdateStatus => {
		return getStatus();
	});
}
