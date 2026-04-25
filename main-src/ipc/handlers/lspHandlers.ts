import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ipcMain } from 'electron';
import {
	disposeTsLspSessionForWebContents,
	getWorkspaceLspManagerForWebContents,
} from '../../lspSessionsByWebContents.js';
import { senderWorkspaceRoot } from '../agentRuntime.js';

/**
 * TypeScript LSP IPC：start / stop / definition / diagnostics。
 *
 * 行为与原 register.ts 完全一致：
 *  - `lsp:ts:start` 仅占位（实际 LSP session 在首次 definition/diagnostics/Agent 工具调用时按需创建）；
 *  - definition / diagnostics 通过 webContents-scoped lsp manager 拿 session，再调用对应 LSP 操作；
 *  - 任何参数缺失都返回明确的 `{ ok: false, error: 'bad-args' | 'no-workspace' | ... }`。
 */
export function registerLspHandlers(): void {
	ipcMain.handle('lsp:ts:start', async (_event, workspaceRootArg: string) => {
		const dir = typeof workspaceRootArg === 'string' ? workspaceRootArg.trim() : '';
		if (!dir) {
			return { ok: false as const, error: 'empty-root' as const };
		}
		/* LSP 子进程按需在首次 definition/diagnostics/Agent 工具调用时启动；此处保留通道以兼容旧前端 */
		return { ok: true as const };
	});

	ipcMain.handle('lsp:ts:stop', async (event) => {
		await disposeTsLspSessionForWebContents(event.sender);
		return { ok: true as const };
	});

	ipcMain.handle('lsp:ts:definition', async (event, payload: unknown) => {
		const p = payload as { uri?: string; line?: number; column?: number; text?: string };
		const uri = typeof p?.uri === 'string' ? p.uri : '';
		const text = typeof p?.text === 'string' ? p.text : '';
		const line = typeof p?.line === 'number' && Number.isFinite(p.line) ? p.line : 1;
		const column = typeof p?.column === 'number' && Number.isFinite(p.column) ? p.column : 1;
		if (!uri || !text) {
			return { ok: false as const, error: 'bad-args' as const };
		}
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		let absPath: string;
		try {
			absPath = uri.startsWith('file:') ? fileURLToPath(uri) : '';
		} catch {
			absPath = '';
		}
		if (!absPath) {
			return { ok: false as const, error: 'bad-uri' as const };
		}
		try {
			const mgr = getWorkspaceLspManagerForWebContents(event.sender);
			const session = await mgr.sessionForFile(absPath, root);
			if (!session) {
				return { ok: false as const, error: 'no-lsp-server' as const };
			}
			const result = await session.definition(uri, line, column, text);
			return { ok: true as const, result };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('lsp:ts:diagnostics', async (event, payload: unknown) => {
		const p = payload as { relPath?: string };
		const relPath = typeof p?.relPath === 'string' ? p.relPath : '';
		if (!relPath) {
			return { ok: false as const, error: 'bad-args' as const };
		}
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const absPath = path.join(root, relPath);
		if (!fs.existsSync(absPath)) {
			return { ok: false as const, error: 'file-not-found' as const };
		}
		const text = fs.readFileSync(absPath, 'utf-8');
		const uri = pathToFileURL(absPath).href;
		try {
			const mgr = getWorkspaceLspManagerForWebContents(event.sender);
			const session = await mgr.sessionForFile(absPath, root);
			if (!session) {
				return { ok: false as const, error: 'no-lsp-server' as const };
			}
			const items = await session.diagnostics(uri, text);
			if (items === null) {
				return { ok: false as const, error: 'not-supported' as const };
			}
			return { ok: true as const, diagnostics: items };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});
}
