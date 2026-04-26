import type { AgentToolDef, ToolCall, ToolResult } from '../../../agent/agentTools.js';
import {
	type FeishuApiClient,
	makeErrorResult,
	makeJsonResult,
} from './feishuApiClient.js';

type Handler = (call: ToolCall) => Promise<ToolResult>;

export const FEISHU_FOLDER_TOOL_NAMES = ['get_feishu_folder_files', 'create_feishu_folder'] as const;

export const feishuFolderToolDefs: AgentToolDef[] = [
	{
		name: 'get_feishu_folder_files',
		description:
			'List files and subfolders inside a Feishu Drive folder. Provide folderToken (the suffix in the folder URL). Optional orderBy ("EditedTime"|"CreatedTime") and direction ("ASC"|"DESC", default DESC). Works with tenant or user token.',
		parameters: {
			type: 'object',
			properties: {
				folderToken: { type: 'string', description: 'Folder token. Use empty string for the root folder of the user (user token only).' },
				orderBy: { type: 'string', description: 'Sort field. Default "EditedTime".' },
				direction: { type: 'string', description: 'Sort direction "ASC"|"DESC". Default "DESC".' },
			},
			required: ['folderToken'],
		},
	},
	{
		name: 'create_feishu_folder',
		description:
			'Create a new subfolder under a Feishu Drive folder. Provide parent folderToken (token of parent folder) and the new folder name. Returns { token, url }. Works with tenant or user token.',
		parameters: {
			type: 'object',
			properties: {
				folderToken: { type: 'string', description: 'Parent folder token.' },
				name: { type: 'string', description: 'New folder display name.' },
			},
			required: ['folderToken', 'name'],
		},
	},
];

export function buildFeishuFolderHandlers(client: FeishuApiClient): Record<string, Handler> {
	return {
		get_feishu_folder_files: async (call) => {
			try {
				const folderToken = String(call.arguments.folderToken ?? '').trim();
				const orderBy = String(call.arguments.orderBy ?? 'EditedTime').trim() || 'EditedTime';
				const direction = String(call.arguments.direction ?? 'DESC').trim() || 'DESC';
				const params: Record<string, unknown> = { order_by: orderBy, direction };
				if (folderToken) params.folder_token = folderToken;
				const res = await client.request<{ data?: { files?: unknown[]; has_more?: boolean; next_page_token?: string } }>({
					method: 'GET',
					url: '/open-apis/drive/v1/files',
					params,
					userToken: client.hasUserToken,
				});
				const data = res?.data ?? (res as { files?: unknown[]; has_more?: boolean; next_page_token?: string });
				return makeJsonResult(call.id, call.name, {
					files: data?.files ?? [],
					has_more: Boolean(data?.has_more),
					next_page_token: data?.next_page_token,
				});
			} catch (e) {
				return makeErrorResult(call.id, call.name, e);
			}
		},
		create_feishu_folder: async (call) => {
			try {
				const folderToken = String(call.arguments.folderToken ?? '').trim();
				const name = String(call.arguments.name ?? '').trim();
				if (!folderToken) {
					return makeErrorResult(call.id, call.name, new Error('folderToken is required.'));
				}
				if (!name) {
					return makeErrorResult(call.id, call.name, new Error('name is required.'));
				}
				const res = await client.request<{ data?: { token?: string; url?: string } }>({
					method: 'POST',
					url: '/open-apis/drive/v1/files/create_folder',
					data: { folder_token: folderToken, name },
					userToken: client.hasUserToken,
				});
				const data = res?.data ?? (res as { token?: string; url?: string });
				return makeJsonResult(call.id, call.name, { token: data?.token, url: data?.url });
			} catch (e) {
				return makeErrorResult(call.id, call.name, e);
			}
		},
	};
}
