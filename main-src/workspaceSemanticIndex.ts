/**
 * 本地 TF-IDF 语义块检索（无 embedding API），为 Agent 注入相关代码片段。
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { getSettings } from './settingsStore.js';
import { getWorkspaceSemanticIndexPath } from './workspaceIndexPaths.js';

const CODE_EXT = new Set([
	'ts',
	'tsx',
	'js',
	'jsx',
	'mjs',
	'cjs',
	'json',
	'md',
	'py',
	'go',
	'rs',
	'java',
	'kt',
	'cs',
	'css',
	'html',
	'vue',
	'svelte',
	'yml',
	'yaml',
	'toml',
]);

const STOP = new Set([
	'the',
	'and',
	'for',
	'are',
	'but',
	'not',
	'you',
	'all',
	'can',
	'her',
	'was',
	'one',
	'our',
	'out',
	'day',
	'get',
	'has',
	'him',
	'his',
	'how',
	'its',
	'may',
	'new',
	'now',
	'old',
	'see',
	'two',
	'way',
	'who',
	'bot',
	'let',
	'var',
	'const',
	'this',
	'that',
	'with',
	'from',
	'your',
	'have',
	'will',
	'just',
	'than',
	'then',
	'them',
	'been',
	'into',
	'more',
	'only',
	'some',
	'time',
	'very',
	'when',
	'come',
	'here',
	'also',
	'back',
	'after',
	'use',
	'she',
	'her',
	'many',
]);

type Chunk = {
	id: number;
	relPath: string;
	startLine: number;
	text: string;
	tf: Map<string, number>;
};

let semRoot: string | null = null;
let chunks: Chunk[] = [];
let idf = new Map<string, number>();
let chunkCount = 0;
let rebuildBusy: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function clearWorkspaceSemanticIndex(): void {
	semRoot = null;
	chunks = [];
	idf = new Map();
	chunkCount = 0;
	rebuildBusy = null;
	lazyLoadAttempted = false;
	if (persistTimer) {
		clearTimeout(persistTimer);
		persistTimer = null;
	}
}

function schedulePersistWorkspaceSemanticIndex(): void {
	if (!semRoot) {
		return;
	}
	if (persistTimer) {
		clearTimeout(persistTimer);
	}
	persistTimer = setTimeout(() => {
		persistTimer = null;
		void persistWorkspaceSemanticIndex();
	}, 250);
}

async function persistWorkspaceSemanticIndex(): Promise<void> {
	if (!semRoot) {
		return;
	}
	const target = getWorkspaceSemanticIndexPath(semRoot);
	try {
		await fsp.mkdir(path.dirname(target), { recursive: true });
		await fsp.writeFile(
			target,
			JSON.stringify(
				{
					version: 1,
					root: semRoot,
					generatedAt: new Date().toISOString(),
					chunks: chunks.map((ch) => ({
						id: ch.id,
						relPath: ch.relPath,
						startLine: ch.startLine,
						text: ch.text,
						tf: [...ch.tf.entries()],
					})),
					idf: [...idf.entries()],
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

function isCodeRel(rel: string): boolean {
	const ext = path.extname(rel).slice(1).toLowerCase();
	return CODE_EXT.has(ext);
}

function isSemanticEligibleRel(rel: string): boolean {
	const normalized = rel.replace(/\\/g, '/');
	if (normalized === '.async/memory/MEMORY.md' || normalized.startsWith('.async/memory/')) {
		return false;
	}
	return isCodeRel(normalized);
}

function tokenize(text: string): string[] {
	const out: string[] = [];
	const lower = text.toLowerCase();
	const re = /[A-Za-z_][\w$]{2,}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(lower)) !== null) {
		const w = m[0];
		if (STOP.has(w)) {
			continue;
		}
		out.push(w);
	}
	/* camelCase / snake 拆分 */
	const extra: string[] = [];
	for (const w of out) {
		const parts = w.split(/_|(?=[A-Z])/);
		for (const p of parts) {
			const s = p.toLowerCase();
			if (s.length >= 3 && !STOP.has(s)) {
				extra.push(s);
			}
		}
	}
	return [...out, ...extra];
}

function buildTf(text: string): Map<string, number> {
	const tf = new Map<string, number>();
	for (const t of tokenize(text)) {
		tf.set(t, (tf.get(t) ?? 0) + 1);
	}
	return tf;
}

function chunkFileContent(relPath: string, content: string): Chunk[] {
	const lines = content.split(/\r?\n/);
	const lineStride = 50;
	const maxChunkChars = 2400;
	const out: Chunk[] = [];
	let idLocal = 0;
	for (let start = 0; start < lines.length; start += lineStride) {
		const slice = lines.slice(start, start + lineStride);
		let text = slice.join('\n');
		if (text.length > maxChunkChars) {
			text = text.slice(0, maxChunkChars);
		}
		if (text.trim().length < 20) {
			continue;
		}
		const tf = buildTf(text);
		if (tf.size === 0) {
			continue;
		}
		out.push({
			id: idLocal++,
			relPath: relPath,
			startLine: start + 1,
			text,
			tf,
		});
	}
	return out;
}

/** 让出事件循环，使 IPC 等高优先级回调有机会执行 */
function yieldEventLoop(): Promise<void> {
	return new Promise((r) => setImmediate(r));
}

/** 限制并发数的批量执行 */
async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let cursor = 0;
	async function worker() {
		while (cursor < items.length) {
			const idx = cursor++;
			results[idx] = await fn(items[idx]!);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
	return results;
}

/** 懒加载标记：是否已经尝试过从磁盘加载 */
let lazyLoadAttempted = false;

async function rebuildInternal(rootNorm: string, relativeFiles: string[]): Promise<void> {
	if (getSettings().indexing?.semanticIndexEnabled === false) {
		return;
	}
	const codeFiles = relativeFiles.filter(isSemanticEligibleRel);

	// 按最近修改时间降序排序，优先索引活跃文件（避免大仓固定前缀截断遗漏重要文件）
	// 限制并发 stat 数量，避免启动时 I/O 饱和阻塞 IPC
	const STAT_SAMPLE = 5000;
	const INDEX_LIMIT = 2500;
	const STAT_CONCURRENCY = 50;
	const YIELD_EVERY = 40;
	const sample = codeFiles.slice(0, STAT_SAMPLE);
	const withMtime = await mapConcurrent(sample, STAT_CONCURRENCY, async (rel) => {
		try {
			const st = await fsp.stat(path.join(rootNorm, rel.split('/').join(path.sep)));
			return { rel, mtime: st.mtimeMs };
		} catch {
			return { rel, mtime: 0 };
		}
	});
	withMtime.sort((a, b) => b.mtime - a.mtime);
	const targets = withMtime.slice(0, INDEX_LIMIT).map((x) => x.rel);

	const next: Chunk[] = [];
	let gid = 0;
	for (let i = 0; i < targets.length; i++) {
		const rel = targets[i]!;
		const full = path.join(rootNorm, rel.split('/').join(path.sep));
		try {
			const st = await fsp.stat(full);
			if (!st.isFile() || st.size > 120_000) {
				continue;
			}
			const buf = await fsp.readFile(full);
			if (buf.includes(0)) {
				continue;
			}
			const text = buf.toString('utf8');
			for (const c of chunkFileContent(rel, text)) {
				next.push({ ...c, id: gid++ });
			}
		} catch {
			/* skip */
		}
		if ((i + 1) % YIELD_EVERY === 0) {
			await yieldEventLoop();
		}
	}

	const df = new Map<string, number>();
	for (const ch of next) {
		const seen = new Set<string>();
		for (const term of ch.tf.keys()) {
			if (seen.has(term)) {
				continue;
			}
			seen.add(term);
			df.set(term, (df.get(term) ?? 0) + 1);
		}
	}
	const N = Math.max(1, next.length);
	const nextIdf = new Map<string, number>();
	for (const [term, d] of df) {
		nextIdf.set(term, Math.log((N + 1) / (d + 1)) + 1);
	}

	semRoot = rootNorm;
	chunks = next.slice(0, 4000);
	idf = nextIdf;
	chunkCount = chunks.length;
	schedulePersistWorkspaceSemanticIndex();
}

/**
 * 在后台构建/刷新索引（与文件列表快照一致）。已在重建时跳过，避免堆积任务。
 */
export function getWorkspaceSemanticIndexStats(): { chunks: number; busy: boolean; root: string | null } {
	return { chunks: chunks.length, busy: rebuildBusy != null, root: semRoot };
}

/**
 * 尝试从磁盘加载上次持久化的语义索引。返回 true 表示加载成功（跳过全量重建）。
 */
async function tryLoadSemanticFromDisk(rootNorm: string): Promise<boolean> {
	const target = getWorkspaceSemanticIndexPath(rootNorm);
	try {
		const raw = await fsp.readFile(target, 'utf8');
		const data = JSON.parse(raw) as {
			version?: number;
			root?: string;
			generatedAt?: string;
			chunks?: Array<{
				id: number;
				relPath: string;
				startLine: number;
				text: string;
				tf: Array<[string, number]>;
			}>;
			idf?: Array<[string, number]>;
		};
		if (data.version !== 1 || !Array.isArray(data.chunks) || !Array.isArray(data.idf)) {
			return false;
		}
		const loadedChunks: Chunk[] = data.chunks.map((ch) => ({
			id: ch.id,
			relPath: ch.relPath,
			startLine: ch.startLine,
			text: ch.text,
			tf: new Map(ch.tf),
		}));
		if (loadedChunks.length === 0) {
			return false;
		}
		semRoot = rootNorm;
		chunks = loadedChunks;
		idf = new Map(data.idf);
		chunkCount = chunks.length;
		return true;
	} catch {
		return false;
	}
}

export function scheduleWorkspaceSemanticRebuild(rootNorm: string, relativeFiles: string[]): void {
	if (getSettings().indexing?.semanticIndexEnabled === false) {
		return;
	}
	if (rebuildBusy) {
		return;
	}
	rebuildBusy = (async () => {
		try {
			const t0 = Date.now();
			if (await tryLoadSemanticFromDisk(rootNorm)) {
				console.log(`[semanticIndex] loaded from disk: ${chunks.length} chunks in ${Date.now() - t0}ms`);
				lazyLoadAttempted = true;
				return;
			}
			console.log(`[semanticIndex] disk cache miss, rebuilding…`);
			await rebuildInternal(rootNorm, relativeFiles);
			console.log(`[semanticIndex] rebuild done: ${chunks.length} chunks in ${Date.now() - t0}ms`);
			lazyLoadAttempted = true;
		} catch {
			/* ignore */
		} finally {
			rebuildBusy = null;
		}
	})();
}

/**
 * 懒加载：在首次需要语义索引时，从磁盘缓存加载或触发重建。
 * 调用方在发送聊天消息时触发，不在启动时执行。
 */
async function ensureSemanticIndexLoaded(rootNorm: string): Promise<void> {
	if (lazyLoadAttempted || chunks.length > 0 || rebuildBusy) {
		if (rebuildBusy) {
			await rebuildBusy;
		}
		return;
	}
	lazyLoadAttempted = true;
	const t0 = Date.now();
	if (await tryLoadSemanticFromDisk(rootNorm)) {
		console.log(`[semanticIndex] lazy loaded from disk: ${chunks.length} chunks in ${Date.now() - t0}ms`);
		return;
	}
	// 磁盘无缓存，触发后台重建（不阻塞当前调用，本次搜索返回空）
	const { ensureWorkspaceFileIndex } = await import('./workspaceFileIndex.js');
	const files = await ensureWorkspaceFileIndex(rootNorm);
	scheduleWorkspaceSemanticRebuild(rootNorm, files);
	console.log(`[semanticIndex] lazy rebuild scheduled in ${Date.now() - t0}ms`);
}

function scoreChunk(queryTf: Map<string, number>, ch: Chunk): number {
	let s = 0;
	for (const [term, qtf] of queryTf) {
		const ctf = ch.tf.get(term);
		if (!ctf) {
			continue;
		}
		const idfV = idf.get(term) ?? 1;
		s += qtf * ctf * idfV * idfV;
	}
	return s;
}

export function semanticSearchChunks(query: string, topK: number): Chunk[] {
	if (!query.trim() || chunks.length === 0) {
		return [];
	}
	const qText = buildTf(query);
	if (qText.size === 0) {
		return [];
	}
	const scored = chunks
		.map((c) => ({ c, s: scoreChunk(qText, c) }))
		.filter((x) => x.s > 0)
		.sort((a, b) => b.s - a.s);
	return scored.slice(0, topK).map((x) => x.c);
}

/**
 * 注入到 system append 的 Markdown 块（同步；索引未就绪时返回空串）。
 * @param recentPaths 最近触碰的文件相对路径列表（来自 fileStates），用于 boosting。
 * @param excludePaths 已通过 @ 引用或工具读取的路径，对应 chunk 将被过滤以避免重复注入。
 */
export async function buildSemanticContextBlock(
	query: string,
	maxChunks: number,
	recentPaths?: string[],
	excludePaths?: string[],
	workspaceRoot?: string | null
): string {
	if (getSettings().indexing?.semanticIndexEnabled === false) {
		return '';
	}
	if (workspaceRoot && chunks.length === 0) {
		await ensureSemanticIndexLoaded(path.resolve(workspaceRoot));
	}
	const rawHits = semanticSearchChunks(query, maxChunks * 2);
	if (rawHits.length === 0) {
		return '';
	}

	// 过滤掉已在上下文中的路径（避免重复）
	let filtered = rawHits;
	if (excludePaths && excludePaths.length > 0) {
		const excludeSet = new Set(excludePaths.map((p) => p.replace(/\\/g, '/')));
		filtered = rawHits.filter((c) => !excludeSet.has(c.relPath.replace(/\\/g, '/')));
	}

	if (filtered.length === 0) {
		return '';
	}

	let hits = filtered;
	if (recentPaths && recentPaths.length > 0) {
		const recentSet = new Set(recentPaths.map((p) => p.replace(/\\/g, '/')));
		// 最近触碰文件的 chunk 提升到前面，其余按原顺序
		const boosted = filtered.filter((c) => recentSet.has(c.relPath.replace(/\\/g, '/')));
		const rest = filtered.filter((c) => !recentSet.has(c.relPath.replace(/\\/g, '/')));
		hits = [...boosted, ...rest].slice(0, maxChunks);
	} else {
		hits = filtered.slice(0, maxChunks);
	}

	const body = hits
		.map(
			(h, i) =>
				`### 片段 ${i + 1}: ${h.relPath}:${h.startLine}\n\`\`\`\n${h.text.slice(0, 2000)}${h.text.length > 2000 ? '\n…' : ''}\n\`\`\``
		)
		.join('\n\n');
	return `## Semantic code retrieval (TF–IDF, local)\n以下片段由本地关键词相关性检索选出，非向量嵌入；请结合路径打开文件核对。\n\n${body}`;
}
