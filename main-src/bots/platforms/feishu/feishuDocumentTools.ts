import type { AgentToolDef, ToolCall, ToolResult } from '../../../agent/agentTools.js';
import {
	type FeishuApiClient,
	makeErrorResult,
	makeJsonResult,
} from './feishuApiClient.js';

type Handler = (call: ToolCall) => Promise<ToolResult>;

/** Strip a doc URL down to its 22-char doc_id if a URL was passed. */
function normalizeDocId(raw: string): string {
	const trimmed = String(raw ?? '').trim();
	if (!trimmed) return '';
	const m = trimmed.match(/(?:docx?|docs|wiki)\/([A-Za-z0-9]+)/);
	return m?.[1] ?? trimmed;
}

/**
 * Minimal block-descriptor → Feishu block payload converter.
 *
 * Supported kinds (cover ~95% of agent-generated content):
 * - text (with optional bold/italic/code/strike)
 * - heading (level 1-9)
 * - bullet, ordered (single-paragraph items)
 * - todo (checkbox)
 * - code (with language)
 * - quote
 * - divider
 * - callout
 *
 * We deliberately do NOT port the upstream 681-line blockFactory: tables,
 * whiteboards, formula blocks, and image binding are out of scope for v1
 * — agents writing full reports can always create text/heading/code/list
 * which round-trips losslessly through the docx_v1 batch_create API.
 */

type SimpleBlock = {
	kind: 'text' | 'heading' | 'bullet' | 'ordered' | 'todo' | 'code' | 'quote' | 'divider' | 'callout';
	text?: string;
	headingLevel?: number;
	codeLanguage?: string;
	bold?: boolean;
	italic?: boolean;
	inlineCode?: boolean;
	strikethrough?: boolean;
	checked?: boolean;
};

const HEADING_BLOCK_TYPES: Record<number, number> = {
	1: 3,
	2: 4,
	3: 5,
	4: 6,
	5: 7,
	6: 8,
	7: 9,
	8: 10,
	9: 11,
};

function buildElement(block: SimpleBlock) {
	const text = block.text ?? '';
	return [
		{
			text_run: {
				content: text,
				text_element_style: {
					bold: Boolean(block.bold),
					italic: Boolean(block.italic),
					inline_code: Boolean(block.inlineCode),
					strikethrough: Boolean(block.strikethrough),
				},
			},
		},
	];
}

function buildBlock(block: SimpleBlock): Record<string, unknown> {
	switch (block.kind) {
		case 'text':
			return {
				block_type: 2,
				text: { elements: buildElement(block), style: {} },
			};
		case 'heading': {
			const level = Math.min(Math.max(block.headingLevel ?? 1, 1), 9);
			const blockType = HEADING_BLOCK_TYPES[level]!;
			const fieldName = `heading${level}`;
			return {
				block_type: blockType,
				[fieldName]: { elements: buildElement(block), style: {} },
			};
		}
		case 'bullet':
			return {
				block_type: 12,
				bullet: { elements: buildElement(block), style: {} },
			};
		case 'ordered':
			return {
				block_type: 13,
				ordered: { elements: buildElement(block), style: {} },
			};
		case 'todo':
			return {
				block_type: 17,
				todo: {
					elements: buildElement(block),
					style: { done: Boolean(block.checked) },
				},
			};
		case 'code':
			return {
				block_type: 14,
				code: {
					elements: buildElement(block),
					style: { language: codeLanguageId(block.codeLanguage) },
				},
			};
		case 'quote':
			return {
				block_type: 15,
				quote: { elements: buildElement(block), style: {} },
			};
		case 'divider':
			return { block_type: 22, divider: {} };
		case 'callout':
			return {
				block_type: 19,
				callout: { elements: buildElement(block), style: {} },
			};
	}
}

function codeLanguageId(name?: string): number {
	const lang = (name ?? '').toLowerCase().trim();
	const map: Record<string, number> = {
		text: 1,
		plaintext: 1,
		bash: 5,
		shell: 5,
		c: 6,
		'c++': 8,
		cpp: 8,
		csharp: 9,
		go: 16,
		html: 19,
		java: 23,
		javascript: 24,
		js: 24,
		json: 25,
		kotlin: 28,
		markdown: 32,
		md: 32,
		objectivec: 35,
		php: 39,
		python: 49,
		py: 49,
		rust: 53,
		scala: 54,
		sql: 56,
		swift: 58,
		typescript: 63,
		ts: 63,
		xml: 65,
		yaml: 67,
		yml: 67,
	};
	return map[lang] ?? 1;
}

export const FEISHU_DOCUMENT_TOOL_NAMES = [
	'create_feishu_document',
	'get_feishu_document_blocks',
	'batch_create_feishu_blocks',
	'search_feishu_documents',
] as const;

export const feishuDocumentToolDefs: AgentToolDef[] = [
	{
		name: 'create_feishu_document',
		description:
			'Create a new Feishu Docs document under a specified Drive folder. Returns { document_id, title, url }. Use create_feishu_folder first if you need a new folder.',
		parameters: {
			type: 'object',
			properties: {
				title: { type: 'string', description: 'Document title.' },
				folderToken: {
					type: 'string',
					description: 'Target folder token (suffix in folder URL). Cannot be empty.',
				},
			},
			required: ['title', 'folderToken'],
		},
	},
	{
		name: 'get_feishu_document_blocks',
		description:
			'Fetch the full block tree of a Feishu Docs document. Pass documentId (doc_id or full doc URL — wiki nodes must first be resolved). Auto-paginates internally; returns the flat block array.',
		parameters: {
			type: 'object',
			properties: {
				documentId: { type: 'string', description: 'Document id or full URL.' },
				pageSize: { type: 'number', description: 'Page size (default 500, max 500).' },
			},
			required: ['documentId'],
		},
	},
	{
		name: 'batch_create_feishu_blocks',
		description:
			'Append a batch of blocks under a parent block in a Feishu Docs document. parentBlockId defaults to the document root (= documentId). Each `blocks[i]` is a simple descriptor: { kind: text|heading|bullet|ordered|todo|code|quote|divider|callout, text, headingLevel?, codeLanguage?, bold?, italic?, inlineCode?, strikethrough?, checked? }. Use this to write text/headings/code/lists into a document.',
		parameters: {
			type: 'object',
			properties: {
				documentId: { type: 'string', description: 'Document id (or full URL).' },
				parentBlockId: {
					type: 'string',
					description: 'Parent block id to append under. Omit to append at document root.',
				},
				index: { type: 'number', description: 'Insert position among siblings. Omit to append at end.' },
				blocks: { type: 'array', description: 'Array of block descriptors (see top-level description).' },
			},
			required: ['documentId', 'blocks'],
		},
	},
	{
		name: 'search_feishu_documents',
		description:
			'Full-text search Feishu Docs by keyword. Returns up to maxSize results (default first page ~50). Pagination via offset.',
		parameters: {
			type: 'object',
			properties: {
				searchKey: { type: 'string', description: 'Keyword.' },
				maxSize: { type: 'number', description: 'Cap on returned results. Omit for first page only.' },
				offset: { type: 'number', description: 'Starting offset. Default 0.' },
			},
			required: ['searchKey'],
		},
	},
];

export function buildFeishuDocumentHandlers(client: FeishuApiClient): Record<string, Handler> {
	return {
		create_feishu_document: async (call) => {
			try {
				const title = String(call.arguments.title ?? '').trim();
				const folderToken = String(call.arguments.folderToken ?? '').trim();
				if (!title) return makeErrorResult(call.id, call.name, new Error('title is required.'));
				if (!folderToken) return makeErrorResult(call.id, call.name, new Error('folderToken is required.'));
				const res = await client.request<{ data?: { document?: unknown } }>({
					method: 'POST',
					url: '/open-apis/docx/v1/documents',
					data: { title, folder_token: folderToken },
					userToken: client.hasUserToken,
				});
				const doc = res?.data?.document ?? res?.data ?? res;
				return makeJsonResult(call.id, call.name, doc);
			} catch (e) {
				return makeErrorResult(call.id, call.name, e);
			}
		},
		get_feishu_document_blocks: async (call) => {
			try {
				const documentId = normalizeDocId(String(call.arguments.documentId ?? ''));
				if (!documentId) return makeErrorResult(call.id, call.name, new Error('documentId is required.'));
				const pageSize = Math.min(Number(call.arguments.pageSize ?? 500) || 500, 500);
				const allBlocks: unknown[] = [];
				let pageToken = '';
				const MAX_PAGES = 50;
				for (let page = 0; page < MAX_PAGES; page++) {
					const params: Record<string, unknown> = { page_size: pageSize, document_revision_id: -1 };
					if (pageToken) params.page_token = pageToken;
					const res = await client.request<{
						data?: { items?: unknown[]; page_token?: string; has_more?: boolean };
					}>({
						method: 'GET',
						url: `/open-apis/docx/v1/documents/${documentId}/blocks`,
						params,
						userToken: client.hasUserToken,
					});
					const data = res?.data ?? (res as { items?: unknown[]; page_token?: string; has_more?: boolean });
					allBlocks.push(...(data?.items ?? []));
					if (!data?.has_more || !data?.page_token) break;
					pageToken = data.page_token;
				}
				return makeJsonResult(call.id, call.name, { blocks: allBlocks, count: allBlocks.length });
			} catch (e) {
				return makeErrorResult(call.id, call.name, e);
			}
		},
		batch_create_feishu_blocks: async (call) => {
			try {
				const documentId = normalizeDocId(String(call.arguments.documentId ?? ''));
				if (!documentId) return makeErrorResult(call.id, call.name, new Error('documentId is required.'));
				const blocksRaw = Array.isArray(call.arguments.blocks) ? call.arguments.blocks : [];
				if (blocksRaw.length === 0) {
					return makeErrorResult(call.id, call.name, new Error('blocks must contain at least one item.'));
				}
				const built = blocksRaw.map((b) => buildBlock(b as SimpleBlock));
				const parentBlockId =
					String(call.arguments.parentBlockId ?? '').trim() || documentId;
				const body: Record<string, unknown> = { children: built };
				if (typeof call.arguments.index === 'number') {
					body.index = call.arguments.index;
				}
				const res = await client.request<{ data?: { children?: unknown[] } }>({
					method: 'POST',
					url: `/open-apis/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children`,
					data: body,
					userToken: client.hasUserToken,
				});
				const data = res?.data ?? (res as { children?: unknown[] });
				return makeJsonResult(call.id, call.name, {
					children: data?.children ?? [],
					count: data?.children?.length ?? 0,
				});
			} catch (e) {
				return makeErrorResult(call.id, call.name, e);
			}
		},
		search_feishu_documents: async (call) => {
			try {
				const searchKey = String(call.arguments.searchKey ?? '').trim();
				if (!searchKey) return makeErrorResult(call.id, call.name, new Error('searchKey is required.'));
				const maxSize = typeof call.arguments.maxSize === 'number' ? call.arguments.maxSize : undefined;
				let offset = typeof call.arguments.offset === 'number' ? call.arguments.offset : 0;
				const PAGE_SIZE = 50;
				const items: unknown[] = [];
				let hasMore = true;
				const MAX_PAGES = 20;
				for (let page = 0; page < MAX_PAGES && hasMore && (maxSize === undefined || items.length < maxSize); page++) {
					const res = await client.request<{
						data?: { docs_entities?: unknown[]; has_more?: boolean };
					}>({
						method: 'POST',
						url: '/open-apis/suite/docs-api/search/object',
						data: {
							search_key: searchKey,
							docs_types: ['doc'],
							count: PAGE_SIZE,
							offset,
						},
						userToken: client.hasUserToken,
					});
					const data = res?.data ?? (res as { docs_entities?: unknown[]; has_more?: boolean });
					const batch = data?.docs_entities ?? [];
					items.push(...batch);
					offset += batch.length;
					hasMore = Boolean(data?.has_more) && batch.length > 0;
					if (maxSize === undefined) break;
				}
				return makeJsonResult(call.id, call.name, {
					items: maxSize !== undefined ? items.slice(0, maxSize) : items,
					hasMore,
					nextOffset: offset,
				});
			} catch (e) {
				return makeErrorResult(call.id, call.name, e);
			}
		},
	};
}
