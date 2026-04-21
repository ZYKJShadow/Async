import { describe, expect, it } from 'vitest';
import {
	formatMcpCommandPreview,
	quoteMcpPreviewToken,
	serializeMcpArgs,
	serializeMcpKeyValueEntries,
} from './mcpFormUtils';

describe('mcpFormUtils', () => {
	it('filters blank MCP args but preserves spacing inside a single argument', () => {
		expect(serializeMcpArgs(['-y', '   ', 'D:\\My Project'])).toEqual(['-y', 'D:\\My Project']);
	});

	it('serializes key-value entries by trimming keys only', () => {
		expect(
			serializeMcpKeyValueEntries([
				{ key: ' API_KEY ', value: 'secret' },
				{ key: '  ', value: 'ignored' },
			])
		).toEqual({ API_KEY: 'secret' });
	});

	it('quotes preview tokens only when needed', () => {
		expect(quoteMcpPreviewToken('-y')).toBe('-y');
		expect(quoteMcpPreviewToken('D:\\My Folder')).toBe('"D:\\My Folder"');
		expect(quoteMcpPreviewToken('say "hello"')).toBe('"say \\"hello\\""');
	});

	it('builds a readable command preview', () => {
		expect(
			formatMcpCommandPreview('npx', ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\My Folder'])
		).toBe('npx -y @modelcontextprotocol/server-filesystem "D:\\My Folder"');
	});
});
