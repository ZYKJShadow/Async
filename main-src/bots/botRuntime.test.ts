import { describe, expect, it } from 'vitest';
import type { BotIntegrationConfig } from '../botSettingsTypes.js';
import type { ShellSettings } from '../settingsStore.js';
import { buildBotOrchestratorPrompt, type BotInboundMessage, type BotSessionState } from './botRuntime.js';

describe('buildBotOrchestratorPrompt', () => {
	it('applies global always rules and auto reply language guidance to bot bridge replies', () => {
		const settings: ShellSettings = {
			language: 'zh-CN',
			agent: {
				rules: [
					{
						id: 'always-rule',
						name: 'Japanese Replies',
						content: 'Always reply in Japanese.',
						scope: 'always',
						enabled: true,
					},
					{
						id: 'glob-rule',
						name: 'TypeScript Only',
						content: 'Only apply on TypeScript files.',
						scope: 'glob',
						globPattern: '**/*.ts',
						enabled: true,
					},
				],
			},
		};
		const integration: BotIntegrationConfig = {
			id: 'bot-1',
			name: 'Test Bot',
			platform: 'telegram',
		};
		const session: BotSessionState = {
			integrationId: integration.id,
			conversationKey: 'conv-1',
			workspaceRoot: null,
			modelId: 'model-1',
			mode: 'agent',
			threadIdsByWorkspace: {},
			leaderMessages: [],
		};
		const inbound: BotInboundMessage = {
			conversationKey: 'conv-1',
			text: 'hello',
			senderName: 'Alice',
		};

		const prompt = buildBotOrchestratorPrompt(settings, integration, session, inbound);

		expect(prompt).toContain('## 全局回复规则');
		expect(prompt).toContain('#### Rule: Japanese Replies');
		expect(prompt).toContain('Always reply in Japanese.');
		expect(prompt).not.toContain('#### Rule（路径匹配）: TypeScript Only');
		expect(prompt).toContain('#### Rule: 自动语言：默认使用简体中文回复');
		expect(prompt).toContain('screenshot_page');
		expect(prompt).toContain('close_sidebar');
	});
});
