import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import chokidar from 'chokidar';
import {
	indexWorkspaceSourceFile,
	removeWorkspaceSymbolsForRel,
	removeWorkspaceSymbolsUnderPrefix,
	scheduleWorkspaceSymbolFullRebuild,
	clearWorkspaceSymbolIndex,
} from './workspaceSymbolIndex.js';
import { scheduleWorkspaceSemanticRebuild, clearWorkspaceSemanticIndex } from './workspaceSemanticIndex.js';

/** 遍历时跳过的目录名（小写比较） */
const SKIP_DIR_NAMES = new Set([
	'.git',
	'node_modules',
	'.venv',
	'venv',
	'dist',
	'build',
	'out',
	'coverage',
	'__pycache__',
	'.idea',
	'.vs',
	'target',
	'.next',
	'.nuxt',
	'Pods',
	'.gradle',
	'DerivedData',
]);

/** 单工作区最大文件条数（提高上限以适配大型 monorepo） */
export const MAX_WORKSPACE_FILES = 50_000;

let cachedRoot: string | null = null;
let relPathSet = new Set<string>();
let watcher: chokidar.FSWatcher | null = null;
let inFlightRefresh: Promise<string[]> | null = null;

function normalizeRel(rootNorm: string, absPath: string): string | null {
	const rel = path.relative(rootNorm, absPath).split(path.sep).join('/');
	if (!rel || rel.startsWith('..')) {
		return null;
	}
	return rel;
}

function shouldIgnoreAbsolutePath(absPath: string): boolean {
	const parts = absPath.split(path.sep);
	for (const part of parts) {
		if (part && SKIP_DIR_NAMES.has(part.toLowerCase())) {
			return true;
		}
	}
	return false;
}

/**
 * 同步全量扫描（缓存未就绪时的回退路径，供 @ 展开等同步逻辑使用）。
 */
export function listWorkspaceRelativeFiles(rootAbs: string): string[] {
	const root = path.normalize(path.resolve(rootAbs));
	const out: string[] = [];

	function walk(absDir: string): void {
		if (out.length >= MAX_WORKSPACE_FILES) {
			return;
		}
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(absDir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const ent of entries) {
			if (out.length >= MAX_WORKSPACE_FILES) {
				return;
			}
			const name = ent.name;
			if (name === '.' || name === '..') {
				continue;
			}
			const abs = path.join(absDir, name);
			if (ent.isDirectory()) {
				if (SKIP_DIR_NAMES.has(name.toLowerCase())) {
					continue;
				}
				walk(abs);
			} else if (ent.isFile()) {
				const rel = normalizeRel(root, abs);
				if (rel) {
					out.push(rel);
				}
			}
		}
	}

	try {
		const st = fs.statSync(root);
		if (!st.isDirectory()) {
			return [];
		}
	} catch {
		return [];
	}

	walk(root);
	out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
	return out;
}

async function scanFullAsync(rootNorm: string): Promise<string[]> {
	const out: string[] = [];

	async function processDir(absDir: string): Promise<void> {
		if (out.length >= MAX_WORKSPACE_FILES) {
			return;
		}
		let entries: fs.Dirent[];
		try {
			entries = await fsp.readdir(absDir, { withFileTypes: true });
		} catch {
			return;
		}
		const subdirs: string[] = [];
		for (const ent of entries) {
			if (out.length >= MAX_WORKSPACE_FILES) {
				return;
			}
			if (ent.name === '.' || ent.name === '..') {
				continue;
			}
			const abs = path.join(absDir, ent.name);
			if (ent.isDirectory()) {
				if (SKIP_DIR_NAMES.has(ent.name.toLowerCase())) {
					continue;
				}
				subdirs.push(abs);
			} else if (ent.isFile()) {
				const rel = normalizeRel(rootNorm, abs);
				if (rel) {
					out.push(rel);
				}
			}
		}
		await Promise.all(subdirs.map((d) => processDir(d)));
	}

	try {
		const st = await fsp.stat(rootNorm);
		if (!st.isDirectory()) {
			return [];
		}
	} catch {
		return [];
	}

	await processDir(rootNorm);
	out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
	return out;
}

function sortedFromSet(): string[] {
	return Array.from(relPathSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function stopWatcherOnly(): void {
	if (watcher) {
		void watcher.close();
		watcher = null;
	}
}

/**
 * 若当前缓存与 root 一致且非空，返回排序列表；否则返回 null（调用方可用同步扫描）。
 */
export function getIndexedWorkspaceFilesIfFresh(rootAbs: string): string[] | null {
	const root = path.normalize(path.resolve(rootAbs));
	if (cachedRoot === root && relPathSet.size > 0) {
		return sortedFromSet();
	}
	return null;
}

/**
 * 停止监听并清空缓存（关闭工作区时调用）。
 */
export function stopWorkspaceFileIndex(): void {
	stopWatcherOnly();
	cachedRoot = null;
	relPathSet = new Set();
	inFlightRefresh = null;
	clearWorkspaceSymbolIndex();
	clearWorkspaceSemanticIndex();
}

function attachWatcher(rootNorm: string): void {
	stopWatcherOnly();
	watcher = chokidar.watch(rootNorm, {
		ignored: (p) => shouldIgnoreAbsolutePath(p),
		ignoreInitial: true,
		persistent: true,
		awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
	});

	const applyAdd = (absPath: string) => {
		if (cachedRoot !== rootNorm) {
			return;
		}
		fs.stat(absPath, (err, st) => {
			if (err || !st.isFile()) {
				return;
			}
			const rel = normalizeRel(rootNorm, absPath);
			if (rel) {
				relPathSet.add(rel);
				void indexWorkspaceSourceFile(rootNorm, rel);
			}
		});
	};

	const applyChange = (absPath: string) => {
		if (cachedRoot !== rootNorm) {
			return;
		}
		const rel = normalizeRel(rootNorm, absPath);
		if (rel) {
			void indexWorkspaceSourceFile(rootNorm, rel);
		}
	};

	const applyUnlink = (absPath: string) => {
		if (cachedRoot !== rootNorm) {
			return;
		}
		const rel = normalizeRel(rootNorm, absPath);
		if (rel) {
			relPathSet.delete(rel);
			removeWorkspaceSymbolsForRel(rel);
		}
	};

	const applyUnlinkDir = (absPath: string) => {
		if (cachedRoot !== rootNorm) {
			return;
		}
		const rel = normalizeRel(rootNorm, absPath);
		if (!rel) {
			return;
		}
		const prefix = rel + '/';
		for (const k of [...relPathSet]) {
			if (k === rel || k.startsWith(prefix)) {
				relPathSet.delete(k);
			}
		}
		removeWorkspaceSymbolsUnderPrefix(rel);
	};

	watcher.on('add', applyAdd);
	watcher.on('change', applyChange);
	watcher.on('unlink', applyUnlink);
	watcher.on('unlinkDir', applyUnlinkDir);
}

/**
 * 确保当前工作区索引已构建：异步全量扫描 + 启动文件监听；同一 root 的并发调用合并。
 */
export async function ensureWorkspaceFileIndex(rootAbs: string): Promise<string[]> {
	const rootNorm = path.normalize(path.resolve(rootAbs));

	if (cachedRoot === rootNorm && relPathSet.size > 0 && !inFlightRefresh) {
		return sortedFromSet();
	}

	if (inFlightRefresh && cachedRoot === rootNorm) {
		return inFlightRefresh;
	}

	if (cachedRoot !== rootNorm) {
		stopWatcherOnly();
		cachedRoot = rootNorm;
		relPathSet = new Set();
	}

	inFlightRefresh = (async () => {
		const list = await scanFullAsync(rootNorm);
		relPathSet = new Set(list);
		attachWatcher(rootNorm);
		const sorted = sortedFromSet();
		scheduleWorkspaceSymbolFullRebuild(rootNorm, sorted);
		scheduleWorkspaceSemanticRebuild(rootNorm, sorted);
		return sorted;
	})();

	try {
		return await inFlightRefresh;
	} finally {
		inFlightRefresh = null;
	}
}
