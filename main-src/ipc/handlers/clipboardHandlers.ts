import { clipboard, ipcMain } from 'electron';

/**
 * 剪贴板 IPC：写入 / 读取纯文本。
 *
 * 与原 register.ts 的实现完全一致；任何错误都包装为 `{ ok: false, error }`。
 */
export function registerClipboardHandlers(): void {
	ipcMain.handle('clipboard:writeText', (_e, text: string) => {
		try {
			clipboard.writeText(String(text ?? ''));
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('clipboard:readText', () => {
		try {
			return { ok: true as const, text: clipboard.readText() };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});
}
