import { BrowserWindow, dialog, ipcMain } from 'electron';
import { getSettings, resolveUsageStatsDataDir } from '../../settingsStore.js';
import { getUsageStatsForDataDir } from '../../workspaceUsageStats.js';

/**
 * 使用统计 IPC：读取统计 / 选择数据目录。行为与原 register.ts 完全一致。
 *  - 仅在用户开启 usageStats 且解析到 data dir 时返回数据；
 *  - pickDirectory 通过 dialog.showOpenDialog 选目录（允许新建）。
 */
export function registerUsageStatsHandlers(): void {
	ipcMain.handle('usageStats:get', () => {
		const s = getSettings();
		if (!s.usageStats?.enabled) {
			return { ok: false as const, reason: 'disabled' as const };
		}
		const dir = resolveUsageStatsDataDir(s);
		if (!dir) {
			return { ok: false as const, reason: 'no-directory' as const };
		}
		return getUsageStatsForDataDir(dir);
	});

	ipcMain.handle('usageStats:pickDirectory', async (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const options = {
			properties: ['openDirectory', 'createDirectory'],
		} satisfies Electron.OpenDialogOptions;
		const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
		if (r.canceled || !r.filePaths[0]) {
			return { ok: false as const };
		}
		return { ok: true as const, path: r.filePaths[0] };
	});
}
