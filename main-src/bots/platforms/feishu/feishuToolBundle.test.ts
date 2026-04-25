import { describe, expect, it } from 'vitest';
import type { BotIntegrationConfig } from '../../../botSettingsTypes.js';
import {
	ALL_FEISHU_TOOL_NAMES,
	buildFeishuToolBundle,
} from './feishuToolBundle.js';

function feishuIntegration(overrides: Partial<BotIntegrationConfig['feishu']> = {}): BotIntegrationConfig {
	return {
		id: 'i',
		name: 'feishu test',
		platform: 'feishu',
		feishu: {
			appId: 'cli_xxx',
			appSecret: 'secret_xxx',
			...overrides,
		},
	};
}

describe('buildFeishuToolBundle (platform scoping)', () => {
	it('returns null for non-feishu platforms', () => {
		const bundle = buildFeishuToolBundle({
			id: 'i',
			name: 't',
			platform: 'telegram',
			telegram: { botToken: 'x' },
		} as BotIntegrationConfig);
		expect(bundle).toBeNull();
	});

	it('returns null when feishu appId or appSecret is missing', () => {
		expect(buildFeishuToolBundle(feishuIntegration({ appId: '' }))).toBeNull();
		expect(buildFeishuToolBundle(feishuIntegration({ appSecret: '' }))).toBeNull();
	});

	it('without user_access_token: hides task + user tools', () => {
		const bundle = buildFeishuToolBundle(feishuIntegration())!;
		expect(bundle).not.toBeNull();
		const names = bundle.toolDefs.map((d) => d.name).sort();
		// document + folder tools only
		expect(names).toEqual(
			[
				'batch_create_feishu_blocks',
				'create_feishu_document',
				'create_feishu_folder',
				'get_feishu_document_blocks',
				'get_feishu_folder_files',
				'search_feishu_documents',
			].sort()
		);
		// handlers must still exist for hidden tools (so stale transcripts get a clean error, not a crash)
		for (const name of bundle.userTokenOnlyToolNames) {
			expect(bundle.handlers[name]).toBeTypeOf('function');
		}
	});

	it('with user_access_token: exposes all 11 tool defs', () => {
		const bundle = buildFeishuToolBundle(feishuIntegration({ userAccessToken: 'u_xxx' }))!;
		expect(bundle.toolDefs).toHaveLength(ALL_FEISHU_TOOL_NAMES.length);
		const names = new Set(bundle.toolDefs.map((d) => d.name));
		for (const expected of ALL_FEISHU_TOOL_NAMES) {
			expect(names.has(expected)).toBe(true);
		}
	});

	it('every defined tool has a handler', () => {
		const bundle = buildFeishuToolBundle(feishuIntegration({ userAccessToken: 'u_xxx' }))!;
		for (const def of bundle.toolDefs) {
			expect(bundle.handlers[def.name], `missing handler for ${def.name}`).toBeTypeOf('function');
		}
	});
});
