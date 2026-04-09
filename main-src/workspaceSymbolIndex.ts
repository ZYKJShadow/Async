/**
 * 轻量导出符号索引（正则），供 Quick Open @ 与 Grep(symbol) 使用。
 * 按 workspace 根路径分桶，支持多窗口不同文件夹并存。
 */

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

type SymbolBucket = {
	rootNorm: string;
	byLowerName: Map<string, WorkspaceSymbolHit[]>;
	byFile: Map<string, WorkspaceSymbolHit[]>;
	fullRebuildTimer: ReturnType<typeof setTimeout> | null;
	persistTimer: ReturnType<typeof setTimeout> | null;
	rebuildingAll: boolean;
	lazyLoadAttempted: boolean;
};

const symbolBuckets = new Map<string, SymbolBucket>();

function normRoot(rootNorm: string): string {
	return path.normalize(path.resolve(rootNorm));
}

function getBucket(rootNorm: string): SymbolBucket {
	const k = normRoot(rootNorm);
	let b = symbolBuckets.get(k);
	if (!b) {
		b = {
			rootNorm: k,
			byLowerName: new Map(),
			byFile: new Map(),
			fullRebuildTimer: null,
			persistTimer: null,
			rebuildingAll: false,
			lazyLoadAttempted: false,
		};
		symbolBuckets.set(k, b);
	}
	return b;
}

function destroySymBucket(b: SymbolBucket): void {
	if (b.fullRebuildTimer) {
		clearTimeout(b.fullRebuildTimer);
		b.fullRebuildTimer = null;
	}
	if (b.persistTimer) {
		clearTimeout(b.persistTimer);
		b.persistTimer = null;
	}
	b.byLowerName.clear();
	b.byFile.clear();
	b.rebuildingAll = false;
	b.lazyLoadAttempted = false;
}

export function clearWorkspaceSymbolIndexForRoot(rootNorm: string): void {
	const k = normRoot(rootNorm);
	const b = symbolBuckets.get(k);
	if (b) {
		destroySymBucket(b);
		symbolBuckets.delete(k);
	}
}

export function clearWorkspaceSymbolIndex(): void {
	for (const k of [...symbolBuckets.keys()]) {
		clearWorkspaceSymbolIndexForRoot(k);
	}
}

function schedulePersistWorkspaceSymbolIndex(b: SymbolBucket): void {
	if (b.rebuildingAll) {
		return;
	}
	if (b.persistTimer) {
		clearTimeout(b.persistTimer);
	}
	b.persistTimer = setTimeout(() => {
		b.persistTimer = null;
		void persistWorkspaceSymbolIndex(b);
	}, 250);
}

async function persistWorkspaceSymbolIndex(b: SymbolBucket): Promise<void> {
	const target = getWorkspaceSymbolsIndexPath(b.rootNorm);
	const files: Record<string, WorkspaceSymbolHit[]> = {};
	for (const [rel, hits] of b.byFile) {
		files[rel] = hits;
	}
	try {
		await fsp.mkdir(path.dirname(target), { recursive: true });
		await fsp.writeFile(
			target,
			JSON.stringify(
				{
					version: 1,
					root: b.rootNorm,
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

function removeFileSymbols(b: SymbolBucket, rel: string): void {
	const prev = b.byFile.get(rel);
	if (!prev?.length) {
		return;
	}
	for (const sym of prev) {
		const key = sym.name.toLowerCase();
		const arr = b.byLowerName.get(key);
		if (!arr) {
			continue;
		}
		const next = arr.filter((x) => !(x.path === rel && x.line === sym.line && x.name === sym.name));
		if (next.length === 0) {
			b.byLowerName.delete(key);
		} else {
			b.byLowerName.set(key, next);
		}
	}
	b.byFile.delete(rel);
}

function addSymbols(b: SymbolBucket, rel: string, syms: WorkspaceSymbolHit[]): void {
	if (syms.length === 0) {
		return;
	}
	b.byFile.set(rel, syms);
	for (const sym of syms) {
		const key = sym.name.toLowerCase();
		const arr = b.byLowerName.get(key) ?? [];
		arr.push(sym);
		b.byLowerName.set(key, arr);
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
	if (!isSourceRel(rel)) {
		return;
	}
	const b = getBucket(rootNorm);
	const full = path.join(b.rootNorm, rel.split('/').join(path.sep));
	removeFileSymbols(b, rel);
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
		addSymbols(b, rel, extractSymbols(rel, text));
		schedulePersistWorkspaceSymbolIndex(b);
	} catch {
		/* ignore */
	}
}

export function removeWorkspaceSymbolsForRel(rootNorm: string, rel: string): void {
	const b = symbolBuckets.get(normRoot(rootNorm));
	if (!b) {
		return;
	}
	removeFileSymbols(b, rel);
	schedulePersistWorkspaceSymbolIndex(b);
}

export function removeWorkspaceSymbolsUnderPrefix(rootNorm: string, prefixRel: string): void {
	const b = symbolBuckets.get(normRoot(rootNorm));
	if (!b) {
		return;
	}
	const pref = prefixRel.endsWith('/') ? prefixRel : `${prefixRel}/`;
	for (const k of [...b.byFile.keys()]) {
		if (k === prefixRel || k.startsWith(pref)) {
			removeFileSymbols(b, k);
		}
	}
	schedulePersistWorkspaceSymbolIndex(b);
}

async function tryLoadFromDisk(b: SymbolBucket): Promise<boolean> {
	const target = getWorkspaceSymbolsIndexPath(b.rootNorm);
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
		b.byLowerName.clear();
		b.byFile.clear();
		for (const [rel, hits] of Object.entries(data.files)) {
			if (!Array.isArray(hits)) {
				continue;
			}
			addSymbols(b, rel, hits);
		}
		return b.byFile.size > 0;
	} catch {
		return false;
	}
}

export function scheduleWorkspaceSymbolFullRebuild(rootNorm: string, relativeFiles: string[]): void {
	if (getSettings().indexing?.symbolIndexEnabled === false) {
		clearWorkspaceSymbolIndexForRoot(rootNorm);
		return;
	}
	const b = getBucket(rootNorm);
	if (b.fullRebuildTimer) {
		clearTimeout(b.fullRebuildTimer);
	}
	b.fullRebuildTimer = setTimeout(() => {
		b.fullRebuildTimer = null;
		void (async () => {
			const t0 = Date.now();
			if (await tryLoadFromDisk(b)) {
				console.log(`[symbolIndex] loaded from disk: ${b.byFile.size} files in ${Date.now() - t0}ms`);
				b.lazyLoadAttempted = true;
				return;
			}
			console.log(`[symbolIndex] disk cache miss, rebuilding ${relativeFiles.filter(isSourceRel).length} files…`);
			await runFullRebuild(b, relativeFiles);
			console.log(
				`[symbolIndex] rebuild done: ${b.byFile.size} files, ${b.byLowerName.size} symbols in ${Date.now() - t0}ms`
			);
			b.lazyLoadAttempted = true;
		})();
	}, 400);
}

export async function ensureSymbolIndexLoaded(rootNorm: string): Promise<void> {
	const b = getBucket(rootNorm);
	if (b.lazyLoadAttempted || b.byFile.size > 0) {
		return;
	}
	b.lazyLoadAttempted = true;
	const t0 = Date.now();
	if (await tryLoadFromDisk(b)) {
		console.log(`[symbolIndex] lazy loaded from disk: ${b.byFile.size} files in ${Date.now() - t0}ms`);
		return;
	}
	const { ensureWorkspaceFileIndex } = await import('./workspaceFileIndex.js');
	const files = await ensureWorkspaceFileIndex(rootNorm);
	scheduleWorkspaceSymbolFullRebuild(rootNorm, files);
	console.log(`[symbolIndex] lazy rebuild scheduled in ${Date.now() - t0}ms`);
}

function yieldEventLoop(): Promise<void> {
	return new Promise((r) => setImmediate(r));
}

async function runFullRebuild(b: SymbolBucket, relativeFiles: string[]): Promise<void> {
	if (getSettings().indexing?.symbolIndexEnabled === false) {
		destroySymBucket(b);
		symbolBuckets.delete(b.rootNorm);
		return;
	}
	b.byLowerName.clear();
	b.byFile.clear();
	b.rebuildingAll = true;
	const targets = relativeFiles.filter(isSourceRel).slice(0, 12_000);
	const YIELD_EVERY = 40;
	try {
		for (let i = 0; i < targets.length; i++) {
			await indexWorkspaceSourceFile(b.rootNorm, targets[i]!);
			if ((i + 1) % YIELD_EVERY === 0) {
				await yieldEventLoop();
			}
		}
	} finally {
		b.rebuildingAll = false;
	}
	schedulePersistWorkspaceSymbolIndex(b);
}

export function getWorkspaceSymbolIndexStatsForRoot(
	rootNorm: string | null
): { uniqueNames: number; filesWithSymbols: number } {
	if (!rootNorm) {
		return { uniqueNames: 0, filesWithSymbols: 0 };
	}
	const b = symbolBuckets.get(normRoot(rootNorm));
	if (!b) {
		return { uniqueNames: 0, filesWithSymbols: 0 };
	}
	return { uniqueNames: b.byLowerName.size, filesWithSymbols: b.byFile.size };
}

/** @deprecated 使用 getWorkspaceSymbolIndexStatsForRoot */
export function getWorkspaceSymbolIndexStats(): { uniqueNames: number; filesWithSymbols: number } {
	return { uniqueNames: 0, filesWithSymbols: 0 };
}

export function searchWorkspaceSymbols(
	rawQuery: string,
	limit: number,
	rootNorm: string
): WorkspaceSymbolHit[] {
	if (getSettings().indexing?.symbolIndexEnabled === false) {
		return [];
	}
	const b = symbolBuckets.get(normRoot(rootNorm));
	if (!b) {
		return [];
	}
	const q = rawQuery.trim().toLowerCase();
	if (!q) {
		return [];
	}
	const out: WorkspaceSymbolHit[] = [];
	const direct = b.byLowerName.get(q);
	if (direct) {
		out.push(...direct);
	}
	if (out.length < limit) {
		for (const [name, hits] of b.byLowerName) {
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

export function formatSymbolSearchResults(hits: WorkspaceSymbolHit[]): string {
	if (hits.length === 0) {
		return 'No matching exported symbols found.';
	}
	return hits.map((h) => `${h.path}:${h.line}:${h.kind} ${h.name}`).join('\n');
}
