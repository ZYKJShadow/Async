import { describe, expect, it, vi } from 'vitest';
import type { ToolCall } from '../../../agent/agentTools.js';
import type { FeishuApiClient } from './feishuApiClient.js';
import { buildFeishuFolderHandlers } from './feishuFolderTools.js';

function mockClient(request: ReturnType<typeof vi.fn>, hasUserToken = false): FeishuApiClient {
	return {
		lark: null as unknown as FeishuApiClient['lark'],
		userAccessToken: hasUserToken ? 'u' : '',
		hasUserToken,
		canRefresh: false,
		request,
	};
}

const c = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
	id: `id-${name}`,
	name,
	arguments: args,
});

describe('feishu folder tools', () => {
	it('get_feishu_folder_files passes folder_token + sort params', async () => {
		const request = vi.fn().mockResolvedValue({
			data: { files: [{ token: 'f1', name: 'doc' }], has_more: false },
		});
		const h = buildFeishuFolderHandlers(mockClient(request));
		const res = await h.get_feishu_folder_files!(c('get_feishu_folder_files', { folderToken: 'fld' }));
		expect(res.isError).toBe(false);
		const params = request.mock.calls[0]![0].params;
		expect(params.folder_token).toBe('fld');
		expect(params.order_by).toBe('EditedTime');
		expect(params.direction).toBe('DESC');
	});

	it('get_feishu_folder_files omits folder_token for empty (root) request', async () => {
		const request = vi.fn().mockResolvedValue({ data: { files: [], has_more: false } });
		const h = buildFeishuFolderHandlers(mockClient(request));
		await h.get_feishu_folder_files!(c('get_feishu_folder_files', { folderToken: '' }));
		expect(request.mock.calls[0]![0].params.folder_token).toBeUndefined();
	});

	it('create_feishu_folder requires both folderToken and name', async () => {
		const h = buildFeishuFolderHandlers(mockClient(vi.fn()));
		const r1 = await h.create_feishu_folder!(c('create_feishu_folder', { folderToken: '', name: 'n' }));
		expect(r1.isError).toBe(true);
		const r2 = await h.create_feishu_folder!(c('create_feishu_folder', { folderToken: 'f', name: '' }));
		expect(r2.isError).toBe(true);
	});

	it('create_feishu_folder posts folder_token + name', async () => {
		const request = vi.fn().mockResolvedValue({
			data: { token: 'newtok', url: 'https://feishu.example/folder/newtok' },
		});
		const h = buildFeishuFolderHandlers(mockClient(request));
		const res = await h.create_feishu_folder!(
			c('create_feishu_folder', { folderToken: 'parent', name: 'sub' })
		);
		expect(res.isError).toBe(false);
		const parsed = JSON.parse(res.content);
		expect(parsed.token).toBe('newtok');
		expect(request.mock.calls[0]![0].data).toEqual({ folder_token: 'parent', name: 'sub' });
	});

	it('userToken flag follows hasUserToken on the client', async () => {
		const request = vi.fn().mockResolvedValue({ data: { files: [], has_more: false } });
		const h = buildFeishuFolderHandlers(mockClient(request, true));
		await h.get_feishu_folder_files!(c('get_feishu_folder_files', { folderToken: 'f' }));
		expect(request.mock.calls[0]![0].userToken).toBe(true);
	});
});
