import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import type { ChatMessage } from '../threadStore.js';
import type { UserMessagePart } from '../../src/messageParts.js';
import { skillInvocationWire } from '../../src/composerSegments.js';
import { resolveWorkspacePath } from '../workspace.js';
import { getIndexedWorkspaceFilesIfFresh, listWorkspaceRelativeFiles } from '../workspaceFileIndex.js';
import { collectAtWorkspacePathsInText } from './workspaceContextExpand.js';
import {
	preprocessImageForSend,
	type ImageProcessError,
	type ProcessedImage,
} from './imagePreprocess.js';

export type ResolvedImageAsset = {
	relPath: string;
	mimeType: ProcessedImage['mimeType'];
	buffer: Buffer;
	sizeBytes: number;
	width: number;
	height: number;
	/** sha256 of the original on-disk bytes (not the preprocessed derivative). */
	sha256: string;
	/** True when the cached sha256 in the persisted part no longer matches disk. */
	stale: boolean;
};

export type ResolvedUserSegment =
	| { kind: 'text'; text: string }
	| { kind: 'expanded_text_file'; relPath: string; body: string; binary: boolean }
	| { kind: 'image_asset'; asset: ResolvedImageAsset }
	| { kind: 'missing_file'; relPath: string }
	| { kind: 'image_error'; relPath: string; error: ImageProcessError };

export type ResolvedUserMessage = {
	segments: ResolvedUserSegment[];
	/**
	 * Flat-text rendering of the resolved message, used by adapters that cannot
	 * accept multimodal input (fallback) or by helpers that only need text.
	 */
	flatText: string;
	/** True when any `image_asset` survived resolution; adapters use this to switch to multimodal serialization. */
	hasImages: boolean;
};

export type SendableMessage = ChatMessage & { resolved?: ResolvedUserMessage };

const MAX_EXPANDED_FILE_BYTES = 512 * 1024;

function readFileText(fullPath: string): { body: string; binary: boolean } | null {
	try {
		const buf = fs.readFileSync(fullPath);
		if (buf.includes(0)) {
			return { body: `（二进制文件，${buf.length} 字节 — 已引用路径，可通过工具读取。）`, binary: true };
		}
		const sliced = buf.length > MAX_EXPANDED_FILE_BYTES ? buf.subarray(0, MAX_EXPANDED_FILE_BYTES) : buf;
		const text = sliced.toString('utf8');
		const truncated = buf.length > MAX_EXPANDED_FILE_BYTES ? `\n\n… (truncated, ${buf.length} bytes total)` : '';
		return { body: text + truncated, binary: false };
	} catch {
		return null;
	}
}

function sha256Hex(buf: Buffer): string {
	return crypto.createHash('sha256').update(buf).digest('hex');
}

async function resolveImagePart(
	part: Extract<UserMessagePart, { kind: 'image_ref' }>,
	workspaceRoot: string
): Promise<ResolvedUserSegment> {
	let full: string;
	try {
		full = resolveWorkspacePath(part.relPath, workspaceRoot);
	} catch (err) {
		return { kind: 'image_error', relPath: part.relPath, error: { kind: 'io_error', detail: String(err) } };
	}
	let buf: Buffer;
	try {
		if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
			return { kind: 'missing_file', relPath: part.relPath };
		}
		buf = fs.readFileSync(full);
	} catch (err) {
		return {
			kind: 'image_error',
			relPath: part.relPath,
			error: { kind: 'io_error', detail: err instanceof Error ? err.message : String(err) },
		};
	}
	const diskSha = sha256Hex(buf);
	const result = await preprocessImageForSend(buf);
	if (!result.ok) {
		return { kind: 'image_error', relPath: part.relPath, error: result.error };
	}
	const stale = part.sha256.length > 0 && part.sha256 !== diskSha;
	return {
		kind: 'image_asset',
		asset: {
			relPath: part.relPath,
			mimeType: result.image.mimeType,
			buffer: result.image.buffer,
			sizeBytes: result.image.sizeBytes,
			width: result.image.width,
			height: result.image.height,
			sha256: diskSha,
			stale,
		},
	};
}

function resolveFileRef(relPath: string, workspaceRoot: string): ResolvedUserSegment {
	let full: string;
	try {
		full = resolveWorkspacePath(relPath, workspaceRoot);
	} catch {
		return { kind: 'missing_file', relPath };
	}
	if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
		return { kind: 'missing_file', relPath };
	}
	const read = readFileText(full);
	if (!read) {
		return { kind: 'missing_file', relPath };
	}
	return { kind: 'expanded_text_file', relPath, body: read.body, binary: read.binary };
}

function flatTextFor(segments: ResolvedUserSegment[]): string {
	const blocks: string[] = [];
	const prelude: string[] = [];
	const main: string[] = [];
	for (const s of segments) {
		if (s.kind === 'text') {
			main.push(s.text);
			continue;
		}
		if (s.kind === 'expanded_text_file') {
			prelude.push(
				s.binary
					? `### 工作区文件: ${s.relPath}\n${s.body}\n`
					: `### 工作区文件: ${s.relPath}\n\`\`\`\n${s.body}\n\`\`\`\n`
			);
			continue;
		}
		if (s.kind === 'image_asset') {
			main.push(`[image: ${s.asset.relPath}]`);
			continue;
		}
		if (s.kind === 'missing_file') {
			main.push(`[missing: ${s.relPath}]`);
			continue;
		}
		if (s.kind === 'image_error') {
			main.push(`[image error (${s.error.kind}): ${s.relPath}]`);
		}
	}
	if (prelude.length > 0) {
		blocks.push(prelude.join('\n'));
		blocks.push('---\n');
	}
	blocks.push(main.join(''));
	return blocks.join('\n');
}

async function resolveStructuredUserMessage(
	parts: UserMessagePart[],
	workspaceRoot: string
): Promise<ResolvedUserMessage> {
	const segments: ResolvedUserSegment[] = [];
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i]!;
		if (p.kind === 'text') {
			segments.push({ kind: 'text', text: p.text });
		} else if (p.kind === 'command') {
			const slash = String(p.command).startsWith('/') ? String(p.command) : `/${String(p.command)}`;
			segments.push({ kind: 'text', text: slash });
		} else if (p.kind === 'skill_invoke') {
			let wire = skillInvocationWire(p.slug);
			const next = parts[i + 1];
			if (next?.kind === 'text' && next.text.length > 0 && !/^\s/u.test(next.text)) {
				wire += ' ';
			} else if (
				next &&
				(next.kind === 'file_ref' ||
					next.kind === 'image_ref' ||
					next.kind === 'command' ||
					next.kind === 'skill_invoke')
			) {
				wire += ' ';
			}
			segments.push({ kind: 'text', text: wire });
		} else if (p.kind === 'file_ref') {
			segments.push(resolveFileRef(p.relPath, workspaceRoot));
		} else if (p.kind === 'image_ref') {
			segments.push(await resolveImagePart(p, workspaceRoot));
		}
	}
	const hasImages = segments.some((s) => s.kind === 'image_asset');
	return { segments, flatText: flatTextFor(segments), hasImages };
}

async function resolveLegacyTextMessage(content: string, workspaceRoot: string): Promise<ResolvedUserMessage> {
	let known: string[] = [];
	try {
		known = getIndexedWorkspaceFilesIfFresh(workspaceRoot) ?? listWorkspaceRelativeFiles(workspaceRoot);
	} catch {
		known = [];
	}
	const refs = collectAtWorkspacePathsInText(content, known);
	const expansions: ResolvedUserSegment[] = refs.map((rel) => resolveFileRef(rel, workspaceRoot));
	const segments: ResolvedUserSegment[] = [...expansions, { kind: 'text', text: content }];
	return { segments, flatText: flatTextFor(segments), hasImages: false };
}

/**
 * Resolve all user messages in the conversation for sending. Messages with
 * structured `parts` (v2) are resolved via `parts`; legacy text-only messages
 * fall back to inline `@path` expansion. Non-user messages pass through.
 */
export async function resolveMessagesForSend(
	messages: ChatMessage[],
	workspaceRoot: string | null
): Promise<SendableMessage[]> {
	const out: SendableMessage[] = [];
	for (const m of messages) {
		if (m.role !== 'user') {
			out.push({ ...m });
			continue;
		}
		if (!workspaceRoot) {
			out.push({ ...m });
			continue;
		}
		if (m.parts && m.parts.length > 0) {
			const resolved = await resolveStructuredUserMessage(m.parts, workspaceRoot);
			out.push({ ...m, resolved });
			continue;
		}
		const resolved = await resolveLegacyTextMessage(m.content, workspaceRoot);
		out.push({ ...m, resolved });
	}
	return out;
}

/** Extract the text body an adapter should use when falling back to string content. */
export function userMessageTextForSend(m: SendableMessage): string {
	if (m.resolved) {
		return m.resolved.flatText;
	}
	return m.content;
}
