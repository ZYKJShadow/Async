import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import type { ChatMessage } from '../threadStore.js';
import type { UserMessagePart } from '../../src/messageParts.js';
import { skillInvocationWire } from '../../src/composerSegments.js';
import { resolveWorkspacePath } from '../workspace.js';
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
	| { kind: 'image_asset'; asset: ResolvedImageAsset }
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
			return {
				kind: 'image_error',
				relPath: part.relPath,
				error: { kind: 'io_error', detail: 'Image file not found.' },
			};
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

function flatTextFor(segments: ResolvedUserSegment[]): string {
	const parts: string[] = [];
	for (const s of segments) {
		if (s.kind === 'text') {
			parts.push(s.text);
			continue;
		}
		if (s.kind === 'image_asset') {
			continue;
		}
		if (s.kind === 'image_error') {
			parts.push(`[image error (${s.error.kind}): ${s.relPath}]`);
		}
	}
	return parts.join('');
}

function shouldInsertSpaceAfter(parts: UserMessagePart[], index: number): boolean {
	const next = parts[index + 1];
	if (!next) {
		return false;
	}
	if (next.kind === 'text') {
		return next.text.length > 0 && !/^\s/u.test(next.text);
	}
	return next.kind === 'command' || next.kind === 'skill_invoke' || next.kind === 'file_ref';
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
			let slash = String(p.command).startsWith('/') ? String(p.command) : `/${String(p.command)}`;
			if (shouldInsertSpaceAfter(parts, i) || parts[i + 1]?.kind === 'image_ref') {
				slash += ' ';
			}
			segments.push({ kind: 'text', text: slash });
		} else if (p.kind === 'skill_invoke') {
			let wire = skillInvocationWire(p.slug);
			if (shouldInsertSpaceAfter(parts, i) || parts[i + 1]?.kind === 'image_ref') {
				wire += ' ';
			}
			segments.push({ kind: 'text', text: wire });
		} else if (p.kind === 'file_ref') {
			let text = `@${p.relPath}`;
			if (shouldInsertSpaceAfter(parts, i)) {
				text += ' ';
			}
			segments.push({ kind: 'text', text });
		} else if (p.kind === 'image_ref') {
			segments.push(await resolveImagePart(p, workspaceRoot));
		}
	}
	const hasImages = segments.some((s) => s.kind === 'image_asset');
	return { segments, flatText: flatTextFor(segments), hasImages };
}

async function resolveLegacyTextMessage(content: string, _workspaceRoot: string): Promise<ResolvedUserMessage> {
	const segments: ResolvedUserSegment[] = [{ kind: 'text', text: content }];
	return { segments, flatText: flatTextFor(segments), hasImages: false };
}

/**
 * Resolve all user messages in the conversation for sending. Messages with
 * structured `parts` (v2) are resolved via `parts`; legacy text-only messages
 * are forwarded as-is. Text file references stay as path mentions so the model
 * can decide whether to use workspace tools to read them. Image references are
 * still resolved into multimodal payloads.
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
