import { ipcMain, BrowserWindow, dialog } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveWorkspacePath, isPathInsideRoot } from '../../workspace.js';
import { senderWorkspaceRoot } from '../agentRuntime.js';

/**
 * `fs:*` IPC：工作区内的文件读写、列目录、重命名、删除、文件选择对话框。
 * 与原 register.ts 的实现行为完全一致，所有失败均包装为 `{ ok: false, error }`。
 */
export function registerFsHandlers(): void {
	ipcMain.handle('fs:pickOpenFile', async (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const openOptions = {
			properties: ['openFile'],
			defaultPath: root,
		} satisfies Electron.OpenDialogOptions;
		const r = win ? await dialog.showOpenDialog(win, openOptions) : await dialog.showOpenDialog(openOptions);
		if (r.canceled || !r.filePaths[0]) {
			return { ok: false as const, canceled: true as const };
		}
		const picked = path.resolve(r.filePaths[0]);
		if (!isPathInsideRoot(picked, root)) {
			return { ok: false as const, error: 'outside-workspace' as const };
		}
		const rel = path.relative(root, picked).split(path.sep).join('/');
		return { ok: true as const, relPath: rel };
	});

	ipcMain.handle(
		'fs:pickSaveFile',
		async (event, opts?: { defaultName?: string; title?: string }) => {
			const win = BrowserWindow.fromWebContents(event.sender);
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'no-workspace' as const };
			}
			const defaultName = typeof opts?.defaultName === 'string' ? opts.defaultName : 'Untitled.txt';
			const saveOptions = {
				title: typeof opts?.title === 'string' ? opts.title : 'Save',
				defaultPath: path.join(root, path.basename(defaultName)),
			} satisfies Electron.SaveDialogOptions;
			const r = win ? await dialog.showSaveDialog(win, saveOptions) : await dialog.showSaveDialog(saveOptions);
			if (r.canceled || !r.filePath) {
				return { ok: false as const, canceled: true as const };
			}
			const picked = path.resolve(r.filePath);
			if (!isPathInsideRoot(picked, root)) {
				return { ok: false as const, error: 'outside-workspace' as const };
			}
			const rel = path.relative(root, picked).split(path.sep).join('/');
			return { ok: true as const, relPath: rel };
		}
	);

	ipcMain.handle('fs:readFile', (event, relPath: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const full = resolveWorkspacePath(relPath, root);
		return { ok: true as const, content: fs.readFileSync(full, 'utf8') };
	});

	ipcMain.handle('fs:writeFile', (event, relPath: string, content: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const full = resolveWorkspacePath(relPath, root);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content, 'utf8');
		return { ok: true as const };
	});

	ipcMain.handle('fs:listDir', (event, relPath: string) => {
		try {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const normalized = typeof relPath === 'string' ? relPath.trim() : '';
			const full = normalized ? resolveWorkspacePath(normalized, root) : root;
			if (!isPathInsideRoot(full, root) && full !== root) {
				return { ok: false as const, error: 'Bad path' };
			}
			const entries = fs.readdirSync(full, { withFileTypes: true });
			const list = entries
				.map((ent) => {
					const joined = normalized ? path.join(normalized, ent.name) : ent.name;
					const relSlash = joined.split(path.sep).join('/');
					return { name: ent.name, isDirectory: ent.isDirectory(), rel: relSlash };
				})
				.sort((a, b) => {
					if (a.isDirectory !== b.isDirectory) {
						return a.isDirectory ? -1 : 1;
					}
					return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
				});
			return { ok: true as const, entries: list };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('fs:renameEntry', (event, relPath: string, newName: string) => {
		try {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const fromRel = String(relPath ?? '').trim();
			if (!fromRel) {
				return { ok: false as const, error: 'empty path' };
			}
			const fromFull = resolveWorkspacePath(fromRel, root);
			if (!fs.existsSync(fromFull)) {
				return { ok: false as const, error: 'not found' };
			}
			const base = path.basename(String(newName ?? '').trim());
			if (!base || base === '.' || base === '..' || base.includes('/') || base.includes('\\')) {
				return { ok: false as const, error: 'bad name' };
			}
			const toFull = path.join(path.dirname(fromFull), base);
			if (!isPathInsideRoot(toFull, root)) {
				return { ok: false as const, error: 'escapes workspace' };
			}
			if (fs.existsSync(toFull)) {
				return { ok: false as const, error: 'destination exists' };
			}
			fs.renameSync(fromFull, toFull);
			const newRel = path.relative(root, toFull).split(path.sep).join('/');
			return { ok: true as const, newRel };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('fs:removeEntry', (event, relPath: string, recursive?: unknown) => {
		try {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const rel = String(relPath ?? '').trim();
			if (!rel) {
				return { ok: false as const, error: 'empty path' };
			}
			const full = resolveWorkspacePath(rel, root);
			if (!fs.existsSync(full)) {
				return { ok: false as const, error: 'not found' };
			}
			const st = fs.statSync(full);
			if (st.isDirectory()) {
				if (recursive === true) {
					fs.rmSync(full, { recursive: true, force: true });
				} else {
					fs.rmdirSync(full);
				}
			} else {
				fs.unlinkSync(full);
			}
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});
}
