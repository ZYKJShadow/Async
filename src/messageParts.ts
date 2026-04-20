import { newSegmentId, skillInvocationWire, type ComposerSegment, type SlashCommandToken } from './composerSegments';

export const THREAD_SCHEMA_VERSION_LEGACY = 1 as const;
export const THREAD_SCHEMA_VERSION_CURRENT = 2 as const;
export type ThreadSchemaVersion = typeof THREAD_SCHEMA_VERSION_LEGACY | typeof THREAD_SCHEMA_VERSION_CURRENT;

export type TextPart = {
	kind: 'text';
	text: string;
};

export type FileRefPart = {
	kind: 'file_ref';
	relPath: string;
};

export type ImageRefPart = {
	kind: 'image_ref';
	relPath: string;
	mimeType: string;
	sizeBytes: number;
	width: number;
	height: number;
	sha256: string;
	/** Runtime-only: set when send-time sha256 diverges from the cached one. Not persisted. */
	staleRef?: boolean;
};

export type CommandPart = {
	kind: 'command';
	command: SlashCommandToken;
};

/** 用户显式调用的 Skill；发送 wire 仍为 `./slug`，`name` 仅用于气泡 chip 展示 */
export type SkillInvokePart = {
	kind: 'skill_invoke';
	slug: string;
	name: string;
};

export type UserMessagePart = TextPart | FileRefPart | ImageRefPart | CommandPart | SkillInvokePart;

const IMAGE_EXT_TO_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
};

export function imageMimeFromExt(ext: string): string | null {
	const key = ext.replace(/^\./, '').toLowerCase();
	return IMAGE_EXT_TO_MIME[key] ?? null;
}

export function isImagePath(relPath: string): boolean {
	const m = relPath.match(/\.([a-zA-Z0-9]+)$/);
	if (!m) {
		return false;
	}
	return imageMimeFromExt(m[1]!) !== null;
}

export function hasAnyImagePart(parts: UserMessagePart[] | undefined): boolean {
	return !!parts?.some((p) => p.kind === 'image_ref');
}

/**
 * Derive the plain-text `content` cache from structured parts.
 *
 * Keep in sync with `ChatComposer` wire format: `file_ref` -> `@<relPath>`,
 * `image_ref` -> `@<relPath>` (same form — renderer distinguishes by lookup).
 * Commands prepend as-is. `skill_invoke` 序列化为 `./slug`（与后端一致）。
 * `content` is a display/fallback cache only; the
 * structured `parts` remain the single source of truth for send/estimate.
 */
/**
 * Map composer UI segments to persistable user message parts.
 * File segments with image metadata become `image_ref`; file segments
 * pointing at known image extensions without metadata are treated as
 * best-effort `image_ref` with zeroed dimensions (resolver re-reads at
 * send time). Non-image files become `file_ref`.
 */
export function segmentsToParts(segments: ComposerSegment[]): UserMessagePart[] {
	const out: UserMessagePart[] = [];
	for (const s of segments) {
		if (s.kind === 'text') {
			if (s.text.length > 0) {
				out.push({ kind: 'text', text: s.text });
			}
			continue;
		}
		if (s.kind === 'command') {
			out.push({ kind: 'command', command: s.command });
			continue;
		}
		if (s.kind === 'skill') {
			const slug = String(s.slug ?? '').trim().replace(/^\.\//, '');
			const name = String(s.name ?? '').trim();
			if (slug.length > 0) {
				out.push({ kind: 'skill_invoke', slug, name: name.length > 0 ? name : slug });
			}
			continue;
		}
		if (s.imageMeta) {
			out.push({
				kind: 'image_ref',
				relPath: s.path,
				mimeType: s.imageMeta.mimeType,
				sizeBytes: s.imageMeta.sizeBytes,
				width: s.imageMeta.width,
				height: s.imageMeta.height,
				sha256: s.imageMeta.sha256,
			});
			continue;
		}
		if (isImagePath(s.path)) {
			out.push({
				kind: 'image_ref',
				relPath: s.path,
				mimeType: imageMimeFromExt(s.path.split('.').pop() ?? '') ?? 'application/octet-stream',
				sizeBytes: 0,
				width: 0,
				height: 0,
				sha256: '',
			});
			continue;
		}
		out.push({ kind: 'file_ref', relPath: s.path });
	}
	return out;
}

export function partsContainImages(parts: UserMessagePart[] | undefined): boolean {
	return !!parts?.some((p) => p.kind === 'image_ref');
}

/**
 * Inverse of `segmentsToParts`: produce display-ready composer segments from
 * persisted `parts`. Images/files both map to `kind: 'file'` (renderer already
 * distinguishes visually by extension). Image meta is preserved so follow-on
 * re-send keeps the cached sha256/dims instead of re-probing. Text parts are
 * merged with neighbouring text so `UserMessageRich` doesn't render split
 * `<span>`s for what was one composer text run.
 */
export function partsToSegments(parts: UserMessagePart[]): ComposerSegment[] {
	const out: ComposerSegment[] = [];
	for (const p of parts) {
		if (p.kind === 'text') {
			if (p.text.length === 0) {
				continue;
			}
			const last = out[out.length - 1];
			if (last?.kind === 'text') {
				last.text += p.text;
				continue;
			}
			out.push({ id: newSegmentId(), kind: 'text', text: p.text });
			continue;
		}
		if (p.kind === 'command') {
			out.push({ id: newSegmentId(), kind: 'command', command: p.command });
			continue;
		}
		if (p.kind === 'skill_invoke') {
			const slug = String(p.slug ?? '').trim().replace(/^\.\//, '');
			const name = String(p.name ?? '').trim();
			if (slug.length === 0) {
				continue;
			}
			out.push({
				id: newSegmentId(),
				kind: 'skill',
				slug,
				name: name.length > 0 ? name : slug,
			});
			continue;
		}
		if (p.kind === 'image_ref') {
			out.push({
				id: newSegmentId(),
				kind: 'file',
				path: p.relPath,
				imageMeta: {
					mimeType: p.mimeType,
					sizeBytes: p.sizeBytes,
					width: p.width,
					height: p.height,
					sha256: p.sha256,
				},
			});
			continue;
		}
		out.push({ id: newSegmentId(), kind: 'file', path: p.relPath });
	}
	return out;
}

export function deriveContentFromParts(parts: UserMessagePart[]): string {
	let out = '';
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i]!;
		if (p.kind === 'text') {
			out += p.text;
			continue;
		}
		if (p.kind === 'command') {
			const slash = String(p.command).startsWith('/') ? String(p.command) : `/${String(p.command)}`;
			out += slash;
			const next = parts[i + 1];
			if (next && next.kind === 'text' && next.text.length > 0 && !/^\s/.test(next.text)) {
				out += ' ';
			} else if (
				next &&
				(next.kind === 'file_ref' || next.kind === 'image_ref' || next.kind === 'skill_invoke')
			) {
				out += ' ';
			}
			continue;
		}
		if (p.kind === 'skill_invoke') {
			out += skillInvocationWire(p.slug);
			const next = parts[i + 1];
			if (next && next.kind === 'text' && next.text.length > 0 && !/^\s/.test(next.text)) {
				out += ' ';
			} else if (
				next &&
				(next.kind === 'file_ref' ||
					next.kind === 'image_ref' ||
					next.kind === 'command' ||
					next.kind === 'skill_invoke')
			) {
				out += ' ';
			}
			continue;
		}
		out += `@${p.relPath}`;
		const next = parts[i + 1];
		if (next && next.kind === 'text' && next.text.length > 0 && !/^\s/.test(next.text)) {
			out += ' ';
		} else if (next && (next.kind === 'command' || next.kind === 'skill_invoke')) {
			out += ' ';
		}
	}
	return out;
}
