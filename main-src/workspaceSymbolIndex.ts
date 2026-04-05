/**
 * 轻量导出符号索引（正则），供 Quick Open @ 与 search_files(symbol) 使用。
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { getSettings } from './settingsStore.js';
import { getWorkspaceSymbolsIndexPath } from './workspaceIndexPaths.js';

export type WorkspaceSymbolHit = {
	name: string;
	path: string;
	line: number;
	kind: string;
};

const SOURCE_EXT = new Set([
	'ts',
	'tsx',
	'js',
	'jsx',
	'mjs',
	'cjs',
	'py',
	'go',
	'rs',
	'java',
	'kt',
	'cs',
	'vue',
	'svelte',
]);

let indexedRoot: string | null = null;
/** 小写符号名 → 命中列表 */
const byLowerName = new Map<string, WorkspaceSymbolHit[]>();
/** relPath → 该文件全部符号（便于整文件替换） */
const byFile = new Map<string, WorkspaceSymbolHit[]>();

let fullRebuildTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let rebuildingAll = false;

let lazyLoadAttempted = false;

export function clearWorkspaceSymbolIndex(): void {
	indexedRoot = null;
	byLowerName.clear();
	byFile.clear();
	lazyLoadAttempted = false;
	if (fullRebuildTimer) {
		clearTimeout(fullRebuildTimer);
		fullRebuildTimer = null;
	}
	if (persistTimer) {
		clearTimeout(persistTimer);
		persistTimer = null;
	}
}

function schedulePersistWorkspaceSymbolIndex(): void {
	if (!indexedRoot || rebuildingAll) {
		return;
	}
	if (persistTimer) {
		clearTimeout(persistTimer);
	}
	persistTimer = setTimeout(() => {
		persistTimer = null;
		void persistWorkspaceSymbolIndex();
	}, 250);
}

async function persistWorkspaceSymbolIndex(): Promise<void> {
	if (!indexedRoot) {
		return;
	}
	const target = getWorkspaceSymbolsIndexPath(indexedRoot);
	const files: Record<string, WorkspaceSymbolHit[]> = {};
	for (const [rel, hits] of byFile) {
		files[rel] = hits;
	}
	try {
		await fsp.mkdir(path.dirname(target), { recursive: true });
		await fsp.writeFile(
			target,
			JSON.stringify(
				{
					version: 1,
					root: indexedRoot,
					generatedAt: new Date().toISOString(),
					files,
				},
				null,
				2
			),
			'utf8'
		);
	} catch {
		/* ignore */
	}
}

function isSourceRel(rel: string): boolean {
	const ext = path.extname(rel).slice(1).toLowerCase();
	return SOURCE_EXT.has(ext);
}

function removeFileSymbols(rel: string): void {
	const prev = byFile.get(rel);
	if (!prev?.length) {
		return;
	}
	for (const sym of prev) {
		const key = sym.name.toLowerCase();
		const arr = byLowerName.get(key);
		if (!arr) {
			continue;
		}
		const next = arr.filter((x) => !(x.path === rel && x.line === sym.line && x.name === sym.name));
		if (next.length === 0) {
			byLowerName.delete(key);
		} else {
			byLowerName.set(key, next);
		}
	}
	byFile.delete(rel);
}

function addSymbols(rel: string, syms: WorkspaceSymbolHit[]): void {
	if (syms.length === 0) {
		return;
	}
	byFile.set(rel, syms);
	for (const sym of syms) {
		const key = sym.name.toLowerCase();
		const arr = byLowerName.get(key) ?? [];
		arr.push(sym);
		byLowerName.set(key, arr);
	}
}

function extractSymbols(relPath: string, content: string): WorkspaceSymbolHit[] {
	const ext = path.extname(relPath).slice(1).toLowerCase();
	const lines = content.split(/\r?\n/);
	const out: WorkspaceSymbolHit[] = [];
	const seen = new Set<string>();

	const push = (name: string, line: number, kind: string) => {
		const trimmed = name.trim();
		if (!trimmed || trimmed.length > 120) {
			return;
		}
		const k = `${line}:${kind}:${trimmed}`;
		if (seen.has(k)) {
			return;
		}
		seen.add(k);
		out.push({ name: trimmed, path: relPath, line, kind });
	};

	if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte'].includes(ext)) {
		const patterns: { re: RegExp; kind: string }[] = [
			{ re: /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
			{ re: /^\s*export\s+const\s+([A-Za-z_$][\w$]*)/, kind: 'const' },
			{ re: /^\s*export\s+let\s+([A-Za-z_$][\w$]*)/, kind: 'let' },
			{ re: /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
			{ re: /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
			{ re: /^\s*export\s+type\s+([A-Za-z_$][\w$]*)/, kind: 'type' },
			{ re: /^\s*export\s+enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum' },
			{ re: /^\s*export\s+default\s+function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
			{ re: /^\s*export\s+declare\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: 'declare' },
		];
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? '';
			for (const { re, kind } of patterns) {
				const m = line.match(re);
				if (m?.[1]) {
					push(m[1], i + 1, kind);
				}
			}
			const expNamed = line.match(/^\s*export\s*\{\s*([^}]+)\}\s*(?:from|;|$)/);
			if (expNamed?.[1]) {
				const parts = expNamed[1].split(',');
				for (const p of parts) {
					const seg = p.trim();
					if (!seg) {
						continue;
					}
					const alias = seg.split(/\s+as\s+/i);
					const name = (alias[1] ?? alias[0] ?? '').trim();
					if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
						push(name, i + 1, 'export');
					}
				}
			}
		}
	}

	if (ext === 'py') {
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? '';
			let m = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
			if (m?.[1]) {
				push(m[1], i + 1, 'def');
			}
			m = line.match(/^\s*class\s+([A-Za-z_]\w*)\s*[:(]/);
			if (m?.[1]) {
				push(m[1], i + 1, 'class');
			}
		}
	}

	if (ext === 'go') {
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? '';
			const m = line.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/);
			if (m?.[1]) {
				push(m[1], i + 1, 'func');
			}
			const t = line.match(/^\s*type\s+([A-Za-z_]\w*)\s+/);
			if (t?.[1]) {
				push(t[1], i + 1, 'type');
			}
		}
	}

	if (ext === 'rs') {
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? '';
			const m = line.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/);
			if (m?.[1]) {
				push(m[1], i + 1, 'fn');
			}
			const s = line.match(/^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/);
			if (s?.[1]) {
				push(s[1], i + 1, 'struct');
			}
			const e = line.match(/^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/);
			if (e?.[1]) {
				push(e[1], i + 1, 'enum');
			}
		}
	}

	return out;
}

export async function indexWorkspaceSourceFile(rootNorm: string, rel: string): Promise<void> {
	if (getSettings().indexing?.symbolIndexEnabled === false) {
		return;
	}
	if (indexedRoot !== rootNorm || !isSourceRel(rel)) {
		return;
	}
	const full = path.join(rootNorm, rel.split('/').join(path.sep));
	removeFileSymbols(rel);
	try {
		const st = await fsp.stat(full);
		if (!st.isFile() || st.size > 400_000) {
			return;
		}
		const buf = await fsp.readFile(full);
		if (buf.includes(0)) {
			return;
		}
		const text = buf.toString('utf8');
		addSymbols(rel, extractSymbols(rel, text));
		schedulePersistWorkspaceSymbolIndex();
	} catch {
		/* ignore */
	}
}

export function removeWorkspaceSymbolsForRel(rel: string): void {
	removeFileSymbols(rel);
	schedulePersistWorkspaceSymbolIndex();
}

export function removeWorkspaceSymbolsUnderPrefix(prefixRel: string): void {
	const pref = prefixRel.endsWith('/') ? prefixRel : `${prefixRel}/`;
	for (const k of [...byFile.keys()]) {
		if (k === prefixRel || k.startsWith(pref)) {
			removeFileSymbols(k);
		}
	}
	schedulePersistWorkspaceSymbolIndex();
}

/**
 * 尝试从磁盘加载上次持久化的符号索引。返回 true 表示加载成功（跳过全量重建）。
 */
async function tryLoadFromDisk(rootNorm: string): Promise<boolean> {
	const target = getWorkspaceSymbolsIndexPath(rootNorm);
	try {
		const raw = await fsp.readFile(target, 'utf8');
		const data = JSON.parse(raw) as {
			version?: number;
			root?: string;
			generatedAt?: string;
			files?: Record<string, WorkspaceSymbolHit[]>;
		};
		if (data.version !== 1 || !data.files || typeof data.files !== 'object') {
			return false;
		}
		byLowerName.clear();
		byFile.clear();
		for (const [rel, hits] of Object.entries(data.files)) {
			if (!Array.isArray(hits)) {
				continue;
			}
			addSymbols(rel, hits);
		}
		return byFile.size > 0;
	} catch {
		return false;
	}
}

/**
 * 全量重建（防抖）。在文件列表扫描完成后调用。
 * 优先从磁盘加载缓存，仅在缓存缺失或过旧时才重新扫描文件。
 */
export function scheduleWorkspaceSymbolFullRebuild(rootNorm: string, relativeFiles: string[]): void {
	if (getSettings().indexing?.symbolIndexEnabled === false) {
		clearWorkspaceSymbolIndex();
		return;
	}
	indexedRoot = rootNorm;
	if (fullRebuildTimer) {
		clearTimeout(fullRebuildTimer);
	}
	fullRebuildTimer = setTimeout(() => {
		fullRebuildTimer = null;
		void (async () => {
			const t0 = Date.now();
			if (await tryLoadFromDisk(rootNorm)) {
				console.log(`[symbolIndex] loaded from disk: ${byFile.size} files in ${Date.now() - t0}ms`);
				lazyLoadAttempted = true;
				return;
			}
			console.log(`[symbolIndex] disk cache miss, rebuilding ${relativeFiles.filter(isSourceRel).length} files…`);
			await runFullRebuild(rootNorm, relativeFiles);
			console.log(`[symbolIndex] rebuild done: ${byFile.size} files, ${byLowerName.size} symbols in ${Date.now() - t0}ms`);
			lazyLoadAttempted = true;
		})();
	}, 400);
}

/**
 * 懒加载：在首次需要符号索引时，从磁盘缓存加载或触发重建。
 */
export async function ensureSymbolIndexLoaded(rootNorm: string): Promise<void> {
	if (lazyLoadAttempted || byFile.size > 0) {
		return;
	}
	lazyLoadAttempted = true;
	indexedRoot = rootNorm;
	const t0 = Date.now();
	if (await tryLoadFromDisk(rootNorm)) {
		console.log(`[symbolIndex] lazy loaded from disk: ${byFile.size} files in ${Date.now() - t0}ms`);
		return;
	}
	const { ensureWorkspaceFileIndex } = await import('./workspaceFileIndex.js');
	const files = await ensureWorkspaceFileIndex(rootNorm);
	scheduleWorkspaceSymbolFullRebuild(rootNorm, files);
	console.log(`[symbolIndex] lazy rebuild scheduled in ${Date.now() - t0}ms`);
}

/** 让出事件循环，使 IPC 等高优先级回调有机会执行 */
function yieldEventLoop(): Promise<void> {
	return new Promise((r) => setImmediate(r));
}

async function runFullRebuild(rootNorm: string, relativeFiles: string[]): Promise<void> {
	if (getSettings().indexing?.symbolIndexEnabled === false) {
		clearWorkspaceSymbolIndex();
		return;
	}
	indexedRoot = rootNorm;
	byLowerName.clear();
	byFile.clear();
	rebuildingAll = true;
	const targets = relativeFiles.filter(isSourceRel).slice(0, 12_000);
	const YIELD_EVERY = 40;
	try {
		for (let i = 0; i < targets.length; i++) {
			await indexWorkspaceSourceFile(rootNorm, targets[i]!);
			if ((i + 1) % YIELD_EVERY === 0) {
				await yieldEventLoop();
			}
		}
	} finally {
		rebuildingAll = false;
	}
	schedulePersistWorkspaceSymbolIndex();
}

export function getWorkspaceSymbolIndexStats(): { uniqueNames: number; filesWithSymbols: number } {
	return { uniqueNames: byLowerName.size, filesWithSymbols: byFile.size };
}

export function searchWorkspaceSymbols(rawQuery: string, limit: number): WorkspaceSymbolHit[] {
	if (getSettings().indexing?.symbolIndexEnabled === false) {
		return [];
	}
	const q = rawQuery.trim().toLowerCase();
	if (!q) {
		return [];
	}
	const out: WorkspaceSymbolHit[] = [];
	const direct = byLowerName.get(q);
	if (direct) {
		out.push(...direct);
	}
	if (out.length < limit) {
		for (const [name, hits] of byLowerName) {
			if (name.includes(q) || q.includes(name)) {
				for (const h of hits) {
					if (out.length >= limit) {
						break;
					}
					if (!out.some((x) => x.path === h.path && x.line === h.line && x.name === h.name)) {
						out.push(h);
					}
				}
			}
			if (out.length >= limit) {
				break;
			}
		}
	}
	return out.slice(0, limit);
}

/** search_files(symbol) 按子串匹配符号名 */
export function formatSymbolSearchResults(hits: WorkspaceSymbolHit[]): string {
	if (hits.length === 0) {
		return 'No matching exported symbols found.';
	}
	return hits.map((h) => `${h.path}:${h.line}:${h.kind} ${h.name}`).join('\n');
}
