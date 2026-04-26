import { ipcMain, BrowserWindow, dialog } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveWorkspacePath, isPathInsideRoot } from '../../workspace.js';
import { senderWorkspaceRoot } from '../agentRuntime.js';

const DEFAULT_TEXT_PREVIEW_MAX_BYTES = 1_500_000;
const TEXT_PREVIEW_SAMPLE_BYTES = 8192;
const IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

const IMAGE_PREVIEW_EXTS = new Set([
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.webp',
	'.bmp',
	'.ico',
	'.avif',
	'.tif',
	'.tiff',
]);
const PDF_PREVIEW_EXTS = new Set(['.pdf']);
const OFFICE_PREVIEW_EXTS = new Set([
	'.doc',
	'.docx',
	'.xls',
	'.xlsx',
	'.ppt',
	'.pptx',
	'.odt',
	'.ods',
	'.odp',
	'.rtf',
]);
const ARCHIVE_PREVIEW_EXTS = new Set([
	'.zip',
	'.7z',
	'.rar',
	'.tar',
	'.gz',
	'.tgz',
	'.bz2',
	'.xz',
	'.jar',
	'.war',
	'.ear',
	'.dmg',
	'.iso',
]);
const MEDIA_PREVIEW_EXTS = new Set([
	'.mp3',
	'.wav',
	'.flac',
	'.aac',
	'.ogg',
	'.mp4',
	'.mov',
	'.avi',
	'.mkv',
	'.webm',
	'.m4v',
]);
const FONT_PREVIEW_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2', '.eot']);
const EXECUTABLE_PREVIEW_EXTS = new Set([
	'.exe',
	'.dll',
	'.so',
	'.dylib',
	'.bin',
	'.obj',
	'.o',
	'.class',
	'.node',
]);
const IMAGE_PREVIEW_MIME_BY_EXT: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.bmp': 'image/bmp',
	'.ico': 'image/x-icon',
	'.avif': 'image/avif',
	'.tif': 'image/tiff',
	'.tiff': 'image/tiff',
};

function classifyPreviewKind(filePath: string): string | null {
	const ext = path.extname(filePath).toLowerCase();
	if (IMAGE_PREVIEW_EXTS.has(ext)) return 'image';
	if (PDF_PREVIEW_EXTS.has(ext)) return 'pdf';
	if (OFFICE_PREVIEW_EXTS.has(ext)) return 'office';
	if (ARCHIVE_PREVIEW_EXTS.has(ext)) return 'archive';
	if (MEDIA_PREVIEW_EXTS.has(ext)) return 'media';
	if (FONT_PREVIEW_EXTS.has(ext)) return 'font';
	if (EXECUTABLE_PREVIEW_EXTS.has(ext)) return 'executable';
	return null;
}

function imagePreviewMime(filePath: string): string {
	return IMAGE_PREVIEW_MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function clampPreviewMaxBytes(raw: unknown): number {
	const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_TEXT_PREVIEW_MAX_BYTES;
	return Math.max(32_000, Math.min(n, 5_000_000));
}

function readSampleBuffer(fullPath: string, size: number): Buffer {
	const sampleSize = Math.min(TEXT_PREVIEW_SAMPLE_BYTES, Math.max(0, size));
	if (sampleSize <= 0) {
		return Buffer.alloc(0);
	}
	const fd = fs.openSync(fullPath, 'r');
	try {
		const sample = Buffer.alloc(sampleSize);
		const bytesRead = fs.readSync(fd, sample, 0, sampleSize, 0);
		return bytesRead === sample.length ? sample : sample.subarray(0, bytesRead);
	} finally {
		fs.closeSync(fd);
	}
}

function isLikelyBinarySample(buf: Buffer): boolean {
	if (buf.length === 0) {
		return false;
	}
	let suspicious = 0;
	for (const byte of buf) {
		if (byte === 0) {
			return true;
		}
		if (byte < 7 || (byte > 13 && byte < 32)) {
			suspicious += 1;
		}
	}
	return suspicious / buf.length > 0.08;
}

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

	ipcMain.handle('fs:readTextPreview', (event, relPath: string, opts?: { maxBytes?: number }) => {
		try {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'no-workspace' as const };
			}
			const full = resolveWorkspacePath(relPath, root);
			const stat = fs.statSync(full);
			if (!stat.isFile()) {
				return {
					ok: true as const,
					canReadText: false as const,
					content: '',
					fileSize: stat.size,
					previewKind: 'unknown' as const,
					unsupportedReason: 'not-file' as const,
				};
			}

			const previewKind = classifyPreviewKind(full);
			if (previewKind) {
				const imagePreview =
					previewKind === 'image' && stat.size <= IMAGE_PREVIEW_MAX_BYTES
						? {
								imageUrl: `data:${imagePreviewMime(full)};base64,${fs.readFileSync(full).toString('base64')}`,
							}
						: {};
				return {
					ok: true as const,
					canReadText: false as const,
					content: '',
					fileSize: stat.size,
					previewKind,
					unsupportedReason:
						previewKind === 'image' && stat.size > IMAGE_PREVIEW_MAX_BYTES
							? ('too-large' as const)
							: ('unsupported-type' as const),
					...imagePreview,
				};
			}

			const maxBytes = clampPreviewMaxBytes(opts?.maxBytes);
			if (stat.size > maxBytes) {
				return {
					ok: true as const,
					canReadText: false as const,
					content: '',
					fileSize: stat.size,
					previewKind: 'large' as const,
					unsupportedReason: 'too-large' as const,
				};
			}

			const sample = readSampleBuffer(full, stat.size);
			if (isLikelyBinarySample(sample)) {
				return {
					ok: true as const,
					canReadText: false as const,
					content: '',
					fileSize: stat.size,
					previewKind: 'binary' as const,
					unsupportedReason: 'binary-content' as const,
				};
			}

			return {
				ok: true as const,
				canReadText: true as const,
				content: fs.readFileSync(full, 'utf8'),
				fileSize: stat.size,
				previewKind: 'text' as const,
			};
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
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
