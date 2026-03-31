/**
 * 本地 TF-IDF 语义块检索（无 embedding API），为 Agent 注入相关代码片段。
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

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

export function clearWorkspaceSemanticIndex(): void {
	semRoot = null;
	chunks = [];
	idf = new Map();
	chunkCount = 0;
	rebuildBusy = null;
}

function isCodeRel(rel: string): boolean {
	const ext = path.extname(rel).slice(1).toLowerCase();
	return CODE_EXT.has(ext);
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

async function rebuildInternal(rootNorm: string, relativeFiles: string[]): Promise<void> {
	const targets = relativeFiles.filter(isCodeRel).slice(0, 2500);
	const next: Chunk[] = [];
	let gid = 0;
	for (const rel of targets) {
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
}

/**
 * 在后台构建/刷新索引（与文件列表快照一致）。已在重建时跳过，避免堆积任务。
 */
export function scheduleWorkspaceSemanticRebuild(rootNorm: string, relativeFiles: string[]): void {
	if (rebuildBusy) {
		return;
	}
	rebuildBusy = (async () => {
		try {
			await rebuildInternal(rootNorm, relativeFiles);
		} catch {
			/* ignore */
		} finally {
			rebuildBusy = null;
		}
	})();
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
 */
export function buildSemanticContextBlock(query: string, maxChunks: number): string {
	const hits = semanticSearchChunks(query, maxChunks);
	if (hits.length === 0) {
		return '';
	}
	const body = hits
		.map(
			(h, i) =>
				`### 片段 ${i + 1}: ${h.relPath}:${h.startLine}\n\`\`\`\n${h.text.slice(0, 2000)}${h.text.length > 2000 ? '\n…' : ''}\n\`\`\``
		)
		.join('\n\n');
	return `## Semantic code retrieval (TF–IDF, local)\n以下片段由本地关键词相关性检索选出，非向量嵌入；请结合路径打开文件核对。\n\n${body}`;
}
