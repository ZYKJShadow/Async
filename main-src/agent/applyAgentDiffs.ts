/**
 * Agent 模式：从助手 Markdown 中提取 ```diff / unified diff，并写入当前工作区。
 * 这里采用“应用补丁”的方式处理改动，而不是长工具循环。
 */

import { applyPatch } from 'diff';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveWorkspacePath, isPathInsideRoot } from '../workspace.js';
import {
	isProbablyTextBuffer,
	readTextFileSyncWithMetadata,
	writeTextFileAtomicSync,
	type TextEncoding,
} from '../textEncoding.js';

export type ApplyAgentDiffsResult = {
	applied: string[];
	failed: { path: string; reason: string }[];
};

export type AgentDiffListItem = {
	chunk: string;
	relPath: string | null;
};

function splitUnifiedDiffFiles(raw: string): string[] {
	const t = raw.trim();
	if (!t) {
		return [];
	}
	if (!/^diff --git /m.test(t)) {
		return [t];
	}
	const lines = t.split('\n');
	const chunks: string[][] = [];
	let cur: string[] = [];
	for (const line of lines) {
		if (line.startsWith('diff --git ') && cur.length > 0) {
			chunks.push(cur);
			cur = [line];
		} else {
			cur.push(line);
		}
	}
	if (cur.length) {
		chunks.push(cur);
	}
	return chunks.map((c) => c.join('\n'));
}

function isUnifiedDiffBody(body: string): boolean {
	return /^\s*diff --git /m.test(body);
}

/** 与渲染端 segmentAssistantContent 一致：只处理围栏内的 diff。 */
function extractDiffChunksFromAssistantMarkdown(text: string): string[] {
	const out: string[] = [];
	let i = 0;
	const n = text.length;
	while (i < n) {
		const fence = text.indexOf('```', i);
		if (fence === -1) {
			break;
		}
		const langEnd = text.indexOf('\n', fence + 3);
		if (langEnd === -1) {
			break;
		}
		const lang = text.slice(fence + 3, langEnd).trim();
		const close = text.indexOf('```', langEnd + 1);
		if (close === -1) {
			break;
		}
		const body = text.slice(langEnd + 1, close);
		if (lang === 'diff' || isUnifiedDiffBody(body)) {
			for (const piece of splitUnifiedDiffFiles(body)) {
				const t0 = piece.trim();
				if (t0) {
					out.push(t0.trimEnd());
				}
			}
		}
		i = close + 3;
	}
	return out;
}

/** 优先围栏内 diff；若无，则尝试从首个 `diff --git` 起的正文（兼容未写 ```diff 的模型）。 */
function extractAllDiffChunks(text: string): string[] {
	const fromFences = extractDiffChunksFromAssistantMarkdown(text);
	if (fromFences.length > 0) {
		return fromFences;
	}
	const m = text.match(/^diff --git .+$/m);
	if (!m || m.index === undefined) {
		return [];
	}
	const tail = text.slice(m.index);
	return splitUnifiedDiffFiles(tail)
		.map((s) => s.trimEnd())
		.filter((s) => s.length > 0);
}

function normalizeRelPath(p: string): string {
	return p
		.replace(/\\/g, '/')
		.replace(/^\.\/+/, '')
		.trim();
}

function targetRelPathFromChunk(chunk: string): string | null {
	const git = chunk.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
	if (git) {
		const bSide = normalizeRelPath(git[2] ?? '');
		if (bSide === '/dev/null' || bSide === 'dev/null') {
			return normalizeRelPath(git[1] ?? '');
		}
		return bSide;
	}
	const pm = chunk.match(/^\+\+\+ b\/(.+)$/m);
	if (pm) {
		const p = normalizeRelPath(pm[1] ?? '');
		if (p === '/dev/null' || p === 'dev/null') {
			return null;
		}
		return p;
	}
	const pm2 = chunk.match(/^\+\+\+ (.+)$/m);
	if (pm2) {
		const p = normalizeRelPath(pm2[1] ?? '');
		if (p === '/dev/null' || p === 'dev/null') {
			return null;
		}
		if (p.startsWith('b/')) {
			return normalizeRelPath(p.slice(2));
		}
		return p;
	}
	return null;
}

function isNewFileChunk(chunk: string): boolean {
	return /^\-\-\- (?:a\/)?\/dev\/null\s*$/m.test(chunk);
}

function isDeleteFileChunk(chunk: string): boolean {
	return /^\+\+\+ (?:b\/)?\/dev\/null\s*$/m.test(chunk);
}

function safeResolveRel(rel: string, root: string): string | null {
	if (!rel || rel.includes('..')) {
		return null;
	}
	try {
		const full = resolveWorkspacePath(rel, root);
		if (!isPathInsideRoot(full, root)) {
			return null;
		}
		return full;
	} catch {
		return null;
	}
}

/** 供审阅 UI：列出可独立应用的 unified diff 块（顺序与自动应用时一致）。 */
export function listAgentDiffChunks(assistantText: string): AgentDiffListItem[] {
	return extractAllDiffChunks(assistantText).map((chunk) => ({
		chunk,
		relPath: targetRelPathFromChunk(chunk),
	}));
}

/** 应用单个 diff 块（与 `applyAgentDiffsFromAssistantText` 中单次迭代语义一致）。 */
export function applyAgentDiffChunk(chunk: string, workspaceRoot: string | null): ApplyAgentDiffsResult {
	const result: ApplyAgentDiffsResult = { applied: [], failed: [] };
	const root = workspaceRoot;
	if (!root) {
		result.failed.push({ path: '(workspace)', reason: '未打开工作区' });
		return result;
	}

	const rel = targetRelPathFromChunk(chunk);
	if (!rel) {
		result.failed.push({ path: '(unknown)', reason: '无法从补丁中解析目标文件路径' });
		return result;
	}

	const full = safeResolveRel(rel, root);
	if (!full) {
		result.failed.push({ path: rel, reason: '路径无效或超出工作区' });
		return result;
	}

	if (isDeleteFileChunk(chunk)) {
		try {
			if (fs.existsSync(full)) {
				fs.unlinkSync(full);
				result.applied.push(`${rel} (已删除)`);
			} else {
				result.applied.push(`${rel} (删除：文件本不存在)`);
			}
		} catch (e) {
			result.failed.push({ path: rel, reason: String(e) });
		}
		return result;
	}

	let source = '';
	let encoding: TextEncoding = 'utf8';
	try {
		if (fs.existsSync(full)) {
			const buf = fs.readFileSync(full);
			if (!isProbablyTextBuffer(buf)) {
				result.failed.push({ path: rel, reason: '跳过二进制文件' });
				return result;
			}
			const meta = readTextFileSyncWithMetadata(full);
			source = meta.text;
			encoding = meta.encoding;
		} else if (!isNewFileChunk(chunk)) {
			source = '';
		}
	} catch (e) {
		result.failed.push({ path: rel, reason: `读取失败: ${e}` });
		return result;
	}

	const patched = applyPatch(source, chunk, { fuzzFactor: 3 });
	if (patched === false) {
		result.failed.push({
			path: rel,
			reason: '补丁与磁盘上文件内容不匹配（请检查上下文或手动应用）',
		});
		return result;
	}

	try {
		fs.mkdirSync(path.dirname(full), { recursive: true });
		writeTextFileAtomicSync(full, patched, encoding);
		result.applied.push(rel);
	} catch (e) {
		result.failed.push({ path: rel, reason: `写入失败: ${e}` });
	}

	return result;
}

/** 按顺序应用多个 diff 块。 */
export function applyAgentDiffChunks(chunks: string[], workspaceRoot: string | null): ApplyAgentDiffsResult {
	const aggregated: ApplyAgentDiffsResult = { applied: [], failed: [] };
	for (const chunk of chunks) {
		const r = applyAgentDiffChunk(chunk, workspaceRoot);
		aggregated.applied.push(...r.applied);
		aggregated.failed.push(...r.failed);
	}
	return aggregated;
}

export type AgentPatchItem = { id: string; chunk: string };

/** 逐项应用并返回成功项 id（供审阅 UI 局部移除列表）。 */
export function applyAgentPatchItems(
	items: AgentPatchItem[],
	workspaceRoot: string | null
): ApplyAgentDiffsResult & { succeededIds: string[] } {
	const aggregated: ApplyAgentDiffsResult = { applied: [], failed: [] };
	const succeededIds: string[] = [];
	for (const { id, chunk } of items) {
		const r = applyAgentDiffChunk(chunk, workspaceRoot);
		aggregated.applied.push(...r.applied);
		aggregated.failed.push(...r.failed);
		if (r.applied.length > 0) {
			succeededIds.push(id);
		}
	}
	return { ...aggregated, succeededIds };
}

export function formatAgentApplyFooter(ar: ApplyAgentDiffsResult): string {
	if (ar.applied.length === 0 && ar.failed.length === 0) {
		return '';
	}
	const lines: string[] = [];
	if (ar.applied.length > 0) {
		lines.push(`**已写入工作区：** ${ar.applied.map((p) => `\`${p}\``).join('，')}`);
	}
	if (ar.failed.length > 0) {
		lines.push(
			`**未能自动应用：** ${ar.failed.map((f) => `\`${f.path}\`（${f.reason}）`).join('；')}`
		);
	}
	return `\n\n---\n${lines.join('\n')}`;
}

/** 单次应用后追加到助手消息的简短脚注。 */
export function formatAgentApplyIncremental(ar: ApplyAgentDiffsResult): string {
	if (ar.applied.length === 0 && ar.failed.length === 0) {
		return '';
	}
	const parts: string[] = [];
	if (ar.applied.length > 0) {
		parts.push(`**已应用：** ${ar.applied.map((p) => `\`${p}\``).join('，')}`);
	}
	if (ar.failed.length > 0) {
		parts.push(`**未应用：** ${ar.failed.map((f) => `\`${f.path}\`（${f.reason}）`).join('；')}`);
	}
	return `\n\n—\n${parts.join(' ')}`;
}

/**
 * 解析并应用助手回复中的 unified diff（仅 ```diff 围栏或围栏内以 diff --git 开头的内容）。
 */
export function applyAgentDiffsFromAssistantText(
	assistantText: string,
	workspaceRoot: string | null
): ApplyAgentDiffsResult {
	const chunks = extractAllDiffChunks(assistantText);
	return applyAgentDiffChunks(chunks, workspaceRoot);
}
