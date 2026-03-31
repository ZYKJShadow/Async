/**
 * 轻量导出符号索引（正则），供 Quick Open @ 与 search_files(symbol) 使用。
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

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

export function clearWorkspaceSymbolIndex(): void {
	indexedRoot = null;
	byLowerName.clear();
	byFile.clear();
	if (fullRebuildTimer) {
		clearTimeout(fullRebuildTimer);
		fullRebuildTimer = null;
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
	} catch {
		/* ignore */
	}
}

export function removeWorkspaceSymbolsForRel(rel: string): void {
	removeFileSymbols(rel);
}

export function removeWorkspaceSymbolsUnderPrefix(prefixRel: string): void {
	const pref = prefixRel.endsWith('/') ? prefixRel : `${prefixRel}/`;
	for (const k of [...byFile.keys()]) {
		if (k === prefixRel || k.startsWith(pref)) {
			removeFileSymbols(k);
		}
	}
}

/**
 * 全量重建（防抖）。在文件列表扫描完成后调用。
 */
export function scheduleWorkspaceSymbolFullRebuild(rootNorm: string, relativeFiles: string[]): void {
	indexedRoot = rootNorm;
	if (fullRebuildTimer) {
		clearTimeout(fullRebuildTimer);
	}
	fullRebuildTimer = setTimeout(() => {
		fullRebuildTimer = null;
		void runFullRebuild(rootNorm, relativeFiles);
	}, 400);
}

async function runFullRebuild(rootNorm: string, relativeFiles: string[]): Promise<void> {
	indexedRoot = rootNorm;
	byLowerName.clear();
	byFile.clear();
	const targets = relativeFiles.filter(isSourceRel).slice(0, 12_000);
	/* 顺序写入，避免并行 addSymbols 破坏 Map */
	for (const rel of targets) {
		await indexWorkspaceSourceFile(rootNorm, rel);
	}
}

export function searchWorkspaceSymbols(rawQuery: string, limit: number): WorkspaceSymbolHit[] {
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
