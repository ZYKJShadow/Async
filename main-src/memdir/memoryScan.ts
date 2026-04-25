import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { ENTRYPOINT_NAME } from './paths.js';
import { parseMemoryType, type MemoryType } from './memoryTypes.js';

export type MemoryHeader = {
	filename: string;
	filePath: string;
	mtimeMs: number;
	title: string | null;
	description: string | null;
	type: MemoryType | undefined;
};

const MAX_MEMORY_FILES = 200;
const FRONTMATTER_MAX_LINES = 30;

function parseSimpleFrontmatter(text: string): Record<string, string> {
	const trimmed = text.trimStart();
	if (!trimmed.startsWith('---')) {
		return {};
	}
	const end = trimmed.indexOf('\n---', 3);
	if (end < 0) {
		return {};
	}
	const yaml = trimmed.slice(3, end).trim();
	const out: Record<string, string> = {};
	for (const line of yaml.split(/\r?\n/)) {
		const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
		if (!m) {
			continue;
		}
		out[m[1]!] = (m[2] ?? '').replace(/^["']|["']$/g, '').trim();
	}
	return out;
}

async function walkMemoryFiles(memoryDir: string, relativeDir = ''): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(path.join(memoryDir, relativeDir), { withFileTypes: true });
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const ent of entries) {
		const rel = relativeDir ? path.join(relativeDir, ent.name) : ent.name;
		if (ent.isDirectory()) {
			out.push(...(await walkMemoryFiles(memoryDir, rel)));
			continue;
		}
		if (ent.isFile() && ent.name.toLowerCase().endsWith('.md') && ent.name !== ENTRYPOINT_NAME) {
			out.push(rel.split(path.sep).join('/'));
		}
	}
	return out;
}

export async function scanMemoryFiles(memoryDir: string): Promise<MemoryHeader[]> {
	const relativeFiles = await walkMemoryFiles(memoryDir);
	const headers = await Promise.allSettled(
		relativeFiles.map(async (relativePath): Promise<MemoryHeader> => {
			const filePath = path.join(memoryDir, relativePath);
			const stat = await fs.stat(filePath);
			const raw = await fs.readFile(filePath, 'utf8');
			const head = raw.split(/\r?\n/).slice(0, FRONTMATTER_MAX_LINES).join('\n');
			const frontmatter = parseSimpleFrontmatter(head);
			return {
				filename: relativePath,
				filePath,
				mtimeMs: stat.mtimeMs,
				title: frontmatter.name?.trim() || frontmatter.title?.trim() || null,
				description: frontmatter.description?.trim() || null,
				type: parseMemoryType(frontmatter.type),
			};
		})
	);
	return headers
		.filter((r): r is PromiseFulfilledResult<MemoryHeader> => r.status === 'fulfilled')
		.map((r) => r.value)
		.sort((a, b) => b.mtimeMs - a.mtimeMs)
		.slice(0, MAX_MEMORY_FILES);
}

export function formatMemoryManifest(memories: MemoryHeader[]): string {
	return memories
		.map((m) => {
			const tag = m.type ? `[${m.type}] ` : '';
			const ts = new Date(m.mtimeMs).toISOString();
			const display = m.title ? `${m.filename} [${m.title}]` : m.filename;
			return m.description ? `- ${tag}${display} (${ts}): ${m.description}` : `- ${tag}${display} (${ts})`;
		})
		.join('\n');
}
