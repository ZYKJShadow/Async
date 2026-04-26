import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	decodeTextBuffer,
	encodeTextBuffer,
	readTextFileSyncWithMetadata,
	writeTextFileAtomicSync,
} from './textEncoding.js';

describe('text encoding helpers', () => {
	it('decodes UTF-8 shell output with CJK text', () => {
		const decoded = decodeTextBuffer(Buffer.from('中文输出 OK', 'utf8'));
		expect(decoded.text).toBe('中文输出 OK');
		expect(decoded.encoding).toBe('utf8');
	});

	it('decodes UTF-16LE output without a BOM, including WSL-style Chinese errors', () => {
		const message = '适用于 Linux 的 Windows 子系统没有已安装的分发。\n';
		const decoded = decodeTextBuffer(Buffer.from(message, 'utf16le'));
		expect(decoded.text).toBe(message);
		expect(decoded.encoding).toBe('utf16le');
	});

	it('decodes legacy GB18030 when selected as the preferred legacy encoding', () => {
		const decoded = decodeTextBuffer(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), {
			preferredLegacyEncoding: 'gb18030',
		});
		expect(decoded.text).toBe('中文');
		expect(decoded.encoding).toBe('gb18030');
	});

	it('preserves UTF-16LE BOM when writing text back', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'async-encoding-'));
		const file = path.join(dir, 'utf16.txt');
		fs.writeFileSync(file, encodeTextBuffer('你好\r\nold', 'utf16le-bom'));

		const meta = readTextFileSyncWithMetadata(file);
		expect(meta.encoding).toBe('utf16le-bom');
		expect(meta.lineEndings).toBe('CRLF');

		writeTextFileAtomicSync(file, meta.text.replace('old', 'new'), meta.encoding);
		const raw = fs.readFileSync(file);
		expect([...raw.subarray(0, 2)]).toEqual([0xff, 0xfe]);
		expect(readTextFileSyncWithMetadata(file).text).toBe('你好\r\nnew');
	});
});
