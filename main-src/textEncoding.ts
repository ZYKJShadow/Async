import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TextDecoder } from 'node:util';
import iconv from 'iconv-lite';

export type TextEncoding =
	| 'utf8'
	| 'utf8-bom'
	| 'utf16le'
	| 'utf16le-bom'
	| 'utf16be'
	| 'utf16be-bom'
	| (string & {});

export type LineEndingType = 'LF' | 'CRLF' | 'mixed' | 'none';

export type DecodedText = {
	text: string;
	encoding: TextEncoding;
	hadBom: boolean;
};

export type TextFileMetadata = DecodedText & {
	lineEndings: LineEndingType;
};

export type DecodeTextOptions = {
	preferredLegacyEncoding?: string | null;
	fallbackEncodings?: string[];
};

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);

let cachedWindowsLegacyEncoding: string | null | undefined;

function startsWithBytes(buffer: Buffer, prefix: Buffer): boolean {
	return buffer.length >= prefix.length && prefix.every((value, index) => buffer[index] === value);
}

function stripLeadingBomChar(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeIconvEncoding(encoding: string): string {
	switch (encoding.toLowerCase()) {
		case 'utf8-bom':
			return 'utf8';
		case 'utf16le-bom':
			return 'utf16le';
		case 'utf16be':
		case 'utf16be-bom':
			return 'utf16-be';
		default:
			return encoding;
	}
}

function decodeWithIconv(buffer: Buffer, encoding: string): string {
	return iconv.decode(buffer, normalizeIconvEncoding(encoding) as Parameters<typeof iconv.decode>[1], { stripBOM: false });
}

function encodeWithIconv(text: string, encoding: string): Buffer {
	return iconv.encode(text, normalizeIconvEncoding(encoding) as Parameters<typeof iconv.encode>[1]);
}

function tryDecodeUtf8Strict(buffer: Buffer): string | null {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
	} catch {
		return null;
	}
}

function nullByteStats(buffer: Buffer): { evenZeros: number; oddZeros: number; pairs: number } {
	const sampleLength = Math.min(buffer.length - (buffer.length % 2), 4096);
	let evenZeros = 0;
	let oddZeros = 0;
	for (let i = 0; i < sampleLength; i += 2) {
		if (buffer[i] === 0) evenZeros++;
		if (buffer[i + 1] === 0) oddZeros++;
	}
	return { evenZeros, oddZeros, pairs: sampleLength / 2 };
}

function looksLikeUtf16LE(buffer: Buffer): boolean {
	if (startsWithBytes(buffer, UTF16LE_BOM)) return true;
	const { evenZeros, oddZeros, pairs } = nullByteStats(buffer);
	return pairs >= 4 && oddZeros / pairs > 0.2 && oddZeros > evenZeros * 2;
}

function looksLikeUtf16BE(buffer: Buffer): boolean {
	if (startsWithBytes(buffer, UTF16BE_BOM)) return true;
	const { evenZeros, oddZeros, pairs } = nullByteStats(buffer);
	return pairs >= 4 && evenZeros / pairs > 0.2 && evenZeros > oddZeros * 2;
}

function decodedTextScore(text: string): number {
	let score = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code === 0xfffd || code === 0) {
			score += 1000;
		} else if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
			score += 50;
		} else if (code >= 0xd800 && code <= 0xdfff) {
			score += 100;
		}
	}
	return score;
}

function mapWindowsCodePageToEncoding(codePage: string): string | null {
	const cp = codePage.trim();
	if (!cp) return null;
	if (cp === '65001') return 'utf8';
	if (cp === '936') return 'gb18030';
	if (cp === '950') return 'big5';
	if (cp === '932') return 'shift_jis';
	if (cp === '949') return 'euc-kr';
	const direct = `cp${cp}`;
	if (iconv.encodingExists(direct)) return direct;
	const windowsName = `windows-${cp}`;
	if (iconv.encodingExists(windowsName)) return windowsName;
	return null;
}

function getWindowsLegacyEncoding(): string | null {
	if (cachedWindowsLegacyEncoding !== undefined) {
		return cachedWindowsLegacyEncoding;
	}
	if (process.platform !== 'win32') {
		cachedWindowsLegacyEncoding = null;
		return cachedWindowsLegacyEncoding;
	}
	try {
		const output = execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'chcp'], {
			encoding: 'ascii',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 1000,
			windowsHide: true,
		});
		const codePage = String(output).match(/\d+/)?.[0] ?? '';
		cachedWindowsLegacyEncoding = mapWindowsCodePageToEncoding(codePage);
	} catch {
		cachedWindowsLegacyEncoding = null;
	}
	return cachedWindowsLegacyEncoding;
}

function uniqueEncodings(encodings: Array<string | null | undefined>): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const encoding of encodings) {
		const normalized = encoding?.trim();
		if (!normalized || seen.has(normalized.toLowerCase())) continue;
		if (!iconv.encodingExists(normalizeIconvEncoding(normalized))) continue;
		seen.add(normalized.toLowerCase());
		out.push(normalized);
	}
	return out;
}

function decodeLegacy(buffer: Buffer, options: DecodeTextOptions): DecodedText {
	const candidates = uniqueEncodings([
		options.preferredLegacyEncoding,
		process.env.ASYNC_SHELL_OUTPUT_ENCODING,
		process.env.ASYNC_LEGACY_TEXT_ENCODING,
		getWindowsLegacyEncoding(),
		...(options.fallbackEncodings ?? []),
		'gb18030',
		'big5',
		'shift_jis',
		'euc-kr',
		'windows-1252',
		'windows-1251',
		'cp866',
		'cp437',
	]);

	let best: DecodedText | null = null;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const encoding of candidates) {
		try {
			const text = decodeWithIconv(buffer, encoding);
			const score = decodedTextScore(text);
			if (score < bestScore) {
				best = { text, encoding, hadBom: false };
				bestScore = score;
			}
			if (score === 0 && encoding === options.preferredLegacyEncoding) {
				break;
			}
		} catch {
			// Try the next legacy encoding.
		}
	}
	return best ?? { text: buffer.toString('latin1'), encoding: 'latin1', hadBom: false };
}

export function decodeTextBuffer(buffer: Buffer, options: DecodeTextOptions = {}): DecodedText {
	if (buffer.length === 0) {
		return { text: '', encoding: 'utf8', hadBom: false };
	}
	if (startsWithBytes(buffer, UTF8_BOM)) {
		return { text: stripLeadingBomChar(decodeWithIconv(buffer, 'utf8')), encoding: 'utf8-bom', hadBom: true };
	}
	if (startsWithBytes(buffer, UTF16LE_BOM)) {
		return { text: decodeWithIconv(buffer.subarray(2), 'utf16le'), encoding: 'utf16le-bom', hadBom: true };
	}
	if (startsWithBytes(buffer, UTF16BE_BOM)) {
		return { text: decodeWithIconv(buffer.subarray(2), 'utf16be'), encoding: 'utf16be-bom', hadBom: true };
	}
	if (looksLikeUtf16LE(buffer)) {
		return { text: decodeWithIconv(buffer, 'utf16le'), encoding: 'utf16le', hadBom: false };
	}
	if (looksLikeUtf16BE(buffer)) {
		return { text: decodeWithIconv(buffer, 'utf16be'), encoding: 'utf16be', hadBom: false };
	}
	const utf8 = tryDecodeUtf8Strict(buffer);
	if (utf8 !== null) {
		return { text: stripLeadingBomChar(utf8), encoding: 'utf8', hadBom: false };
	}
	return decodeLegacy(buffer, options);
}

export function decodeShellOutput(buffer: Buffer): string {
	return decodeTextBuffer(buffer).text;
}

export function encodeTextBuffer(text: string, encoding: TextEncoding): Buffer {
	switch (encoding.toLowerCase()) {
		case 'utf8-bom':
			return Buffer.concat([UTF8_BOM, encodeWithIconv(text, 'utf8')]);
		case 'utf16le-bom':
			return Buffer.concat([UTF16LE_BOM, encodeWithIconv(text, 'utf16le')]);
		case 'utf16be-bom':
			return Buffer.concat([UTF16BE_BOM, encodeWithIconv(text, 'utf16be')]);
		default:
			return encodeWithIconv(text, encoding);
	}
}

export function detectLineEndings(text: string): LineEndingType {
	const crlf = (text.match(/\r\n/g) ?? []).length;
	const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
	if (crlf === 0 && lf === 0) return 'none';
	if (crlf > 0 && lf > 0) return 'mixed';
	return crlf > 0 ? 'CRLF' : 'LF';
}

export function isProbablyTextBuffer(buffer: Buffer): boolean {
	if (buffer.length === 0 || startsWithBytes(buffer, UTF8_BOM) || looksLikeUtf16LE(buffer) || looksLikeUtf16BE(buffer)) {
		return true;
	}
	const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
	let control = 0;
	for (const byte of sample) {
		if (byte === 0) return false;
		if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) {
			control++;
		}
	}
	return control / Math.max(1, sample.length) < 0.05;
}

export function readTextFileSyncWithMetadata(filePath: string): TextFileMetadata {
	const buffer = fs.readFileSync(filePath);
	if (!isProbablyTextBuffer(buffer)) {
		throw new Error('File appears to be binary.');
	}
	const decoded = decodeTextBuffer(buffer);
	return {
		...decoded,
		lineEndings: detectLineEndings(decoded.text),
	};
}

export function readTextFileIfExistsSync(filePath: string): string | null {
	try {
		if (!fs.existsSync(filePath)) return null;
		return readTextFileSyncWithMetadata(filePath).text;
	} catch {
		return null;
	}
}

export function writeTextFileAtomicSync(filePath: string, content: string, encoding: TextEncoding = 'utf8'): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });

	let targetPath = filePath;
	try {
		if (fs.lstatSync(filePath).isSymbolicLink()) {
			const linkTarget = fs.readlinkSync(filePath);
			targetPath = path.isAbsolute(linkTarget) ? linkTarget : path.resolve(path.dirname(filePath), linkTarget);
		}
	} catch {
		// Missing files and non-symlinks are handled by writing filePath directly.
	}

	const bytes = encodeTextBuffer(content, encoding);
	const tempPath = path.join(
		path.dirname(targetPath),
		`.${path.basename(targetPath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
	);
	let mode: number | undefined;
	try {
		mode = fs.statSync(targetPath).mode;
	} catch {
		mode = undefined;
	}

	try {
		fs.writeFileSync(tempPath, bytes, mode === undefined ? undefined : { mode });
		if (mode !== undefined) {
			fs.chmodSync(tempPath, mode);
		}
		fs.renameSync(tempPath, targetPath);
	} catch (error) {
		try {
			if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
		} catch {
			// Ignore cleanup failures and surface the original write failure.
		}
		throw error;
	}
}
