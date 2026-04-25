import { describe, expect, it, vi } from 'vitest';
import type { ToolCall } from '../../../agent/agentTools.js';
import type { FeishuApiClient } from './feishuApiClient.js';
import { buildFeishuDocumentHandlers } from './feishuDocumentTools.js';

function mockClient(request: ReturnType<typeof vi.fn>): FeishuApiClient {
	return {
		lark: null as unknown as FeishuApiClient['lark'],
		userAccessToken: '',
		hasUserToken: false,
		canRefresh: false,
		request,
	};
}

const c = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
	id: `id-${name}`,
	name,
	arguments: args,
});

describe('feishu document tools', () => {
	it('create_feishu_document POSTs title + folder_token', async () => {
		const request = vi.fn().mockResolvedValue({
			data: { document: { document_id: 'doc1', title: 't', url: 'u' } },
		});
		const h = buildFeishuDocumentHandlers(mockClient(request));
		const res = await h.create_feishu_document!(
			c('create_feishu_document', { title: 't', folderToken: 'fld' })
		);
		expect(res.isError).toBe(false);
		expect(request.mock.calls[0]![0].method).toBe('POST');
		expect(request.mock.calls[0]![0].data).toEqual({ title: 't', folder_token: 'fld' });
	});

	it('create_feishu_document rejects missing title or folderToken', async () => {
		const h = buildFeishuDocumentHandlers(mockClient(vi.fn()));
		expect((await h.create_feishu_document!(c('create_feishu_document', { title: '', folderToken: 'f' }))).isError).toBe(true);
		expect((await h.create_feishu_document!(c('create_feishu_document', { title: 't', folderToken: '' }))).isError).toBe(true);
	});

	it('get_feishu_document_blocks normalizes a doc URL down to doc_id', async () => {
		const request = vi.fn().mockResolvedValue({ data: { items: [{ block_id: 'b1' }], has_more: false } });
		const h = buildFeishuDocumentHandlers(mockClient(request));
		await h.get_feishu_document_blocks!(
			c('get_feishu_document_blocks', { documentId: 'https://feishu.cn/docx/DOC123ABC?from=share' })
		);
		expect(request.mock.calls[0]![0].url).toBe('/open-apis/docx/v1/documents/DOC123ABC/blocks');
	});

	it('get_feishu_document_blocks paginates until has_more is false', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({ data: { items: [{ block_id: 'a' }], page_token: 'p1', has_more: true } })
			.mockResolvedValueOnce({ data: { items: [{ block_id: 'b' }], page_token: '', has_more: false } });
		const h = buildFeishuDocumentHandlers(mockClient(request));
		const res = await h.get_feishu_document_blocks!(
			c('get_feishu_document_blocks', { documentId: 'doc1' })
		);
		const parsed = JSON.parse(res.content);
		expect(parsed.count).toBe(2);
		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls[1]![0].params.page_token).toBe('p1');
	});

	it('batch_create_feishu_blocks builds heading + text + code blocks', async () => {
		const request = vi.fn().mockResolvedValue({ data: { children: [{ block_id: 'x' }, { block_id: 'y' }, { block_id: 'z' }] } });
		const h = buildFeishuDocumentHandlers(mockClient(request));
		const res = await h.batch_create_feishu_blocks!(
			c('batch_create_feishu_blocks', {
				documentId: 'doc1',
				blocks: [
					{ kind: 'heading', headingLevel: 2, text: 'Title' },
					{ kind: 'text', text: 'hello', bold: true },
					{ kind: 'code', text: 'console.log(1)', codeLanguage: 'typescript' },
				],
			})
		);
		expect(res.isError).toBe(false);
		const body = request.mock.calls[0]![0].data;
		expect(body.children).toHaveLength(3);
		// heading2 -> block_type 4
		expect(body.children[0].block_type).toBe(4);
		expect(body.children[0].heading2.elements[0].text_run.content).toBe('Title');
		// text bold flag
		expect(body.children[1].text.elements[0].text_run.text_element_style.bold).toBe(true);
		// code language id 63 = typescript
		expect(body.children[2].code.style.language).toBe(63);
		// URL appends parent block id (= documentId by default)
		expect(request.mock.calls[0]![0].url).toBe('/open-apis/docx/v1/documents/doc1/blocks/doc1/children');
	});

	it('batch_create_feishu_blocks errors on empty blocks array', async () => {
		const h = buildFeishuDocumentHandlers(mockClient(vi.fn()));
		const res = await h.batch_create_feishu_blocks!(
			c('batch_create_feishu_blocks', { documentId: 'd', blocks: [] })
		);
		expect(res.isError).toBe(true);
	});

	it('search_feishu_documents POSTs to suite/docs-api/search/object', async () => {
		const request = vi.fn().mockResolvedValue({
			data: { docs_entities: [{ docs_token: 't1' }], has_more: false },
		});
		const h = buildFeishuDocumentHandlers(mockClient(request));
		await h.search_feishu_documents!(c('search_feishu_documents', { searchKey: 'roadmap' }));
		expect(request.mock.calls[0]![0].url).toBe('/open-apis/suite/docs-api/search/object');
		expect(request.mock.calls[0]![0].data).toEqual({
			search_key: 'roadmap',
			docs_types: ['doc'],
			count: 50,
			offset: 0,
		});
	});

	it('search_feishu_documents respects maxSize and stops paginating at the cap', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({
				data: { docs_entities: Array.from({ length: 50 }, (_, i) => ({ docs_token: `t${i}` })), has_more: true },
			})
			.mockResolvedValueOnce({
				data: { docs_entities: [{ docs_token: 't50' }], has_more: false },
			});
		const h = buildFeishuDocumentHandlers(mockClient(request));
		const res = await h.search_feishu_documents!(
			c('search_feishu_documents', { searchKey: 'q', maxSize: 51 })
		);
		const parsed = JSON.parse(res.content);
		expect(parsed.items).toHaveLength(51);
		expect(request).toHaveBeenCalledTimes(2);
	});
});
