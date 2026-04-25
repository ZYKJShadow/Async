import { ipcMain, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolveWorkspacePath } from '../../workspace.js';
import { senderWorkspaceRoot } from '../agentRuntime.js';

const execFileAsync = promisify(execFile);

/**
 * `shell:*` IPC：在系统资源管理器、外部应用、浏览器中打开本地文件 / URL。
 * 与原 register.ts 行为完全一致。
 */
export function registerShellHandlers(): void {
	ipcMain.handle('shell:revealInFolder', (event, relPath: string) => {
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
				void shell.openPath(full);
			} else {
				shell.showItemInFolder(full);
			}
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('shell:revealAbsolutePath', async (_e, rawPath: string) => {
		try {
			const target = String(rawPath ?? '').trim();
			if (!target) {
				return { ok: false as const, error: 'empty path' };
			}
			const full = path.resolve(target);
			if (!fs.existsSync(full)) {
				return { ok: false as const, error: 'not found' };
			}
			const st = fs.statSync(full);
			if (process.platform === 'win32') {
				try {
					const args = st.isDirectory() ? [full] : [`/select,${full}`];
					const child = spawn('explorer.exe', args, {
						detached: true,
						stdio: 'ignore',
						windowsHide: false,
					});
					child.unref();
					return { ok: true as const };
				} catch {
					/* fall through */
				}
			}
			if (process.platform === 'darwin' && !st.isDirectory()) {
				try {
					await execFileAsync('open', ['-R', full], { windowsHide: true });
					return { ok: true as const };
				} catch {
					/* fall through */
				}
			}
			if (st.isDirectory()) {
				const err = await shell.openPath(full);
				return err ? ({ ok: false as const, error: err } as const) : ({ ok: true as const } as const);
			}
			shell.showItemInFolder(full);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('shell:openDefault', async (event, relPath: string) => {
		try {
			const root = senderWorkspaceRoot(event);
			const rel = String(relPath ?? '').trim();
			if (!rel) {
				return { ok: false as const, error: 'empty path' };
			}
			let full = rel;
			if (!path.isAbsolute(full)) {
				if (!root) {
					return { ok: false as const, error: 'No workspace' };
				}
				full = resolveWorkspacePath(rel, root);
			}
			if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
				return { ok: false as const, error: 'not a file' };
			}
			const err = await shell.openPath(full);
			return err ? ({ ok: false as const, error: err } as const) : ({ ok: true as const } as const);
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('shell:openInBrowser', async (event, relPath: string) => {
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
			if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
				return { ok: false as const, error: 'not a file' };
			}
			const ext = path.extname(full).toLowerCase();
			if (!['.html', '.htm', '.svg'].includes(ext)) {
				return { ok: false as const, error: 'unsupported type' };
			}
			await shell.openExternal(pathToFileURL(full).href);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('shell:openExternalUrl', async (_event, url: string) => {
		try {
			const trimmed = String(url ?? '').trim();
			if (!trimmed) {
				return { ok: false as const, error: 'empty url' };
			}
			let parsed: URL;
			try {
				parsed = new URL(trimmed);
			} catch {
				return { ok: false as const, error: 'invalid url' };
			}
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') {
				return { ok: false as const, error: 'unsupported protocol' };
			}
			await shell.openExternal(parsed.toString());
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});
}
