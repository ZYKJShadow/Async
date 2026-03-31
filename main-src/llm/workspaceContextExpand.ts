import * as fs from 'node:fs';
import type { ChatMessage } from '../threadStore.js';
import { getWorkspaceRoot, resolveWorkspacePath } from '../workspace.js';
import { getIndexedWorkspaceFilesIfFresh, listWorkspaceRelativeFiles } from '../workspaceFileIndex.js';
import type { ComposerMode } from './composerMode.js';

/**
 * 与渲染端 `wirePlainToSegments` 一致：按最长路径匹配内联 `@相对路径`。
 */
export function collectAtWorkspacePathsInText(text: string, knownRelativePaths: string[]): string[] {
	const paths = [...new Set(knownRelativePaths.map((p) => p.replace(/\\/g, '/')))].sort(
		(a, b) => b.length - a.length
	);
	const seen = new Set<string>();
	const order: string[] = [];
	let i = 0;
	while (i < text.length) {
		if (text[i] === '@' || text[i] === '\uFF03') {
			const rest = text.slice(i + 1);
			const hit = paths.find((p) => rest.startsWith(p));
			if (hit) {
				if (!seen.has(hit)) {
					seen.add(hit);
					order.push(hit);
				}
				i += 1 + hit.length;
				continue;
			}
		}
		i++;
	}
	return order;
}

function expandUserTextWithWorkspaceFiles(text: string): string {
	const root = getWorkspaceRoot();
	if (!root) {
		return text;
	}
	let known: string[];
	try {
		known = getIndexedWorkspaceFilesIfFresh(root) ?? listWorkspaceRelativeFiles(root);
	} catch {
		return text;
	}
	const refs = collectAtWorkspacePathsInText(text, known);
	if (refs.length === 0) {
		return text;
	}
	const blocks: string[] = [];
	for (const rel of refs) {
		try {
			const full = resolveWorkspacePath(rel);
			const content = fs.readFileSync(full, 'utf8');
			blocks.push(`### 工作区文件: ${rel}\n\`\`\`\n${content}\n\`\`\`\n`);
		} catch {
			blocks.push(`### 工作区文件: ${rel}\n（读取失败）\n`);
		}
	}
	return `${blocks.join('\n')}\n---\n\n${text}`;
}

export function modeExpandsWorkspaceFileContext(mode: ComposerMode): boolean {
	return mode === 'agent' || mode === 'plan' || mode === 'debug';
}

const ASSET_EXTS = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'webp', 'avif', 'tiff', 'tif',
	'woff', 'woff2', 'ttf', 'otf', 'eot',
	'mp3', 'mp4', 'wav', 'ogg', 'webm', 'avi', 'mov', 'flv', 'mkv', 'm4a', 'flac', 'aac',
	'zip', 'tar', 'gz', 'bz2', 'rar', '7z', 'xz', 'zst',
	'exe', 'dll', 'so', 'dylib', 'o', 'obj', 'class', 'pyc', 'pyo', 'wasm',
	'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
	'sqlite', 'db', 'mdb',
	'map',
	'pem', 'crt', 'key', 'p12', 'pfx',
	'lock',
]);

function extOf(filename: string): string {
	const dot = filename.lastIndexOf('.');
	return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/**
 * Build a concise indented file tree for injection into system prompt (Plan mode).
 * Filters out binary/asset files to prioritise code and config files.
 */
export function buildWorkspaceTreeSummary(files: string[], maxLines: number = 150): string {
	if (files.length === 0) {
		return '';
	}

	const codeFiles: string[] = [];
	let assetCount = 0;
	for (const f of files) {
		const ext = extOf(f.split('/').pop()!);
		if (ext && ASSET_EXTS.has(ext)) {
			assetCount++;
		} else {
			codeFiles.push(f);
		}
	}

	if (codeFiles.length === 0) {
		return `## Workspace File Tree\nThe workspace contains ${files.length} files, all of which appear to be binary or asset files (images, fonts, media, etc.). No source code files detected.`;
	}

	interface TreeNode {
		children: Map<string, TreeNode>;
		isFile: boolean;
	}

	const root: TreeNode = { children: new Map(), isFile: false };

	for (const f of codeFiles) {
		const parts = f.split('/');
		let cur = root;
		for (let i = 0; i < parts.length; i++) {
			const name = parts[i]!;
			if (!cur.children.has(name)) {
				cur.children.set(name, { children: new Map(), isFile: i === parts.length - 1 });
			}
			cur = cur.children.get(name)!;
			if (i === parts.length - 1) {
				cur.isFile = true;
			}
		}
	}

	const lines: string[] = [];
	let truncated = false;

	function walk(node: TreeNode, prefix: string, depth: number): void {
		if (truncated) {
			return;
		}
		const entries = [...node.children.entries()].sort(([a, av], [b, bv]) => {
			if (av.isFile !== bv.isFile) {
				return av.isFile ? 1 : -1;
			}
			return a.localeCompare(b, undefined, { sensitivity: 'base' });
		});
		for (const [name, child] of entries) {
			if (lines.length >= maxLines) {
				truncated = true;
				return;
			}
			if (child.isFile && child.children.size === 0) {
				lines.push(`${prefix}${name}`);
			} else {
				const fc = countFiles(child);
				if (depth >= 3 && fc > 10) {
					lines.push(`${prefix}${name}/ (${fc} files)`);
				} else {
					lines.push(`${prefix}${name}/`);
					walk(child, prefix + '  ', depth + 1);
				}
			}
		}
	}

	function countFiles(node: TreeNode): number {
		let count = node.isFile ? 1 : 0;
		for (const child of node.children.values()) {
			count += countFiles(child);
		}
		return count;
	}

	walk(root, '', 0);

	let out = `## Workspace File Tree (${codeFiles.length} code/config files`;
	if (assetCount > 0) {
		out += `, ${assetCount} asset files omitted`;
	}
	out += ')\n```\n';
	out += lines.join('\n');
	if (truncated) {
		out += `\n… (truncated, ${codeFiles.length} code files total)`;
	}
	out += '\n```';
	return out;
}

/** 深拷贝消息列表，并将最后一条 user 的正文展开为「文件内容 + 原消息」（仅影响发往模型的副本）。 */
export function cloneMessagesWithExpandedLastUser(messages: ChatMessage[]): ChatMessage[] {
	const clone = messages.map((m) => ({ ...m }));
	for (let i = clone.length - 1; i >= 0; i--) {
		if (clone[i]!.role === 'user') {
			const cur = clone[i]!;
			clone[i] = { ...cur, content: expandUserTextWithWorkspaceFiles(cur.content) };
			break;
		}
	}
	return clone;
}
