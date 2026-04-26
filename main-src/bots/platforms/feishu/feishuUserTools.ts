import type { AgentToolDef, ToolCall, ToolResult } from '../../../agent/agentTools.js';
import {
	type FeishuApiClient,
	makeErrorResult,
	makeJsonResult,
} from './feishuApiClient.js';

type Handler = (call: ToolCall) => Promise<ToolResult>;

const USER_PAGE_SIZE = 200;

export const FEISHU_USER_TOOL_NAMES = ['get_feishu_users'] as const;

export const feishuUserToolDefs: AgentToolDef[] = [
	{
		name: 'get_feishu_users',
		description:
			'Look up Feishu users by EITHER (1) name search via `queries` (1–20 query items, each with optional pageToken) OR (2) batch-by-id via `userIdsParam` (1–50 ids, each with idType: open_id|union_id|user_id). Returns user_id, open_id, name, department_ids, email, mobile, avatar, etc. Requires user_access_token configured on the integration.',
		parameters: {
			type: 'object',
			properties: {
				queries: {
					type: 'array',
					description: 'Array of { query, pageToken? } items to search by display name. Min 1, max 20.',
				},
				userIdsParam: {
					type: 'array',
					description:
						'Array of { id, idType } items for batch lookup. idType: open_id (default) | union_id | user_id. Min 1, max 50.',
				},
			},
			required: [],
		},
	},
];

type SearchQuery = { query?: unknown; pageToken?: unknown };
type IdQuery = { id?: unknown; idType?: unknown };

export function buildFeishuUserHandlers(client: FeishuApiClient): Record<string, Handler> {
	return {
		get_feishu_users: async (call) => {
			try {
				if (!client.hasUserToken) {
					return makeErrorResult(
						call.id,
						call.name,
						new Error('user_access_token is not configured for this Feishu integration.')
					);
				}
				const queries = Array.isArray(call.arguments.queries) ? (call.arguments.queries as SearchQuery[]) : [];
				const userIdsParam = Array.isArray(call.arguments.userIdsParam)
					? (call.arguments.userIdsParam as IdQuery[])
					: [];
				if (queries.length === 0 && userIdsParam.length === 0) {
					return makeErrorResult(
						call.id,
						call.name,
						new Error('Provide either queries (name search) or userIdsParam (batch by id).')
					);
				}
				if (queries.length > 20) {
					return makeErrorResult(call.id, call.name, new Error('queries cannot exceed 20 items.'));
				}
				if (userIdsParam.length > 50) {
					return makeErrorResult(call.id, call.name, new Error('userIdsParam cannot exceed 50 items.'));
				}

				const result: {
					searches?: Array<{ query: string; users: unknown[]; page_token?: string; has_more?: boolean }>;
					batches?: Array<{ idType: string; users: unknown[] }>;
				} = {};

				if (queries.length > 0) {
					result.searches = [];
					for (const q of queries) {
						const queryStr = String(q.query ?? '').trim();
						if (!queryStr) continue;
						const params: Record<string, unknown> = { query: queryStr, page_size: USER_PAGE_SIZE };
						if (typeof q.pageToken === 'string' && q.pageToken) {
							params.page_token = q.pageToken;
						}
						try {
							const res = await client.request<{
								data?: { users?: unknown[]; page_token?: string; has_more?: boolean };
							}>({
								method: 'GET',
								url: '/open-apis/search/v1/user',
								params,
								userToken: true,
							});
							const data = res?.data ?? (res as { users?: unknown[]; page_token?: string; has_more?: boolean });
							result.searches.push({
								query: queryStr,
								users: data?.users ?? [],
								page_token: data?.page_token,
								has_more: data?.has_more,
							});
						} catch (e) {
							result.searches.push({
								query: queryStr,
								users: [],
								page_token: undefined,
								has_more: false,
								// @ts-expect-error attach error per query
								error: e instanceof Error ? e.message : String(e),
							});
						}
					}
				}

				if (userIdsParam.length > 0) {
					result.batches = [];
					const byType: Record<string, string[]> = {};
					for (const item of userIdsParam) {
						const id = String(item.id ?? '').trim();
						if (!id) continue;
						const idType = ['open_id', 'union_id', 'user_id'].includes(String(item.idType))
							? String(item.idType)
							: 'open_id';
						(byType[idType] = byType[idType] ?? []).push(id);
					}
					for (const [idType, ids] of Object.entries(byType)) {
						const qs = new URLSearchParams();
						ids.forEach((id) => qs.append('user_ids', id));
						qs.set('user_id_type', idType);
						try {
							const res = await client.request<{ data?: { items?: unknown[] } }>({
								method: 'GET',
								url: `/open-apis/contact/v3/users/batch?${qs.toString()}`,
								userToken: true,
							});
							const data = res?.data ?? (res as { items?: unknown[] });
							result.batches.push({ idType, users: data?.items ?? [] });
						} catch (e) {
							result.batches.push({
								idType,
								users: [],
								// @ts-expect-error attach error per batch
								error: e instanceof Error ? e.message : String(e),
							});
						}
					}
				}

				return makeJsonResult(call.id, call.name, result);
			} catch (e) {
				return makeErrorResult(call.id, call.name, e);
			}
		},
	};
}
