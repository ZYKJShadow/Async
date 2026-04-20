import { describe, expect, it } from 'vitest';
import type { BotIntegrationConfig } from '../botSettingsTypes.js';
import type { ShellSettings } from '../settingsStore.js';
import {
	buildBotOrchestratorPrompt,
	looksLikeQrLoginConfirmation,
	looksLikeQrLoginScreenshotResendRequest,
	type BotInboundMessage,
	type BotSessionState,
} from './botRuntime.js';

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
			skills: [
				{
					id: 'skill-1',
					name: 'Ops Runbook',
					description: 'Triage production issues first.',
					slug: 'ops-runbook',
					content: 'Always collect impact, scope, timeline, and rollback status before proposing actions.',
					enabled: true,
				},
			],
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
		expect(prompt).toContain('#### Rule: 自动语言：默认使用简体中文回应');
		expect(prompt).toContain('screenshot_page');
		expect(prompt).toContain('click_element');
		expect(prompt).toContain('BrowserCapture');
		expect(prompt).toContain('pause_for_qr_login');
		expect(prompt).toContain('## Bot 专属 Skills');
		expect(prompt).toContain('Ops Runbook (./ops-runbook)');
		expect(prompt).toContain('Triage production issues first.');
		expect(prompt).toContain('Always collect impact, scope, timeline, and rollback status before proposing actions.');
	});
});

describe('QR login helpers', () => {
	it('recognizes common QR login confirmation phrases', () => {
		expect(looksLikeQrLoginConfirmation('已登录')).toBe(true);
		expect(looksLikeQrLoginConfirmation('扫码完成')).toBe(true);
		expect(looksLikeQrLoginConfirmation('logged in')).toBe(true);
		expect(looksLikeQrLoginConfirmation('还没扫')).toBe(false);
	});

	it('detects requests to resend the QR screenshot', () => {
		expect(looksLikeQrLoginScreenshotResendRequest('请再发一下二维码')).toBe(true);
		expect(looksLikeQrLoginScreenshotResendRequest('resend the qr')).toBe(true);
		expect(looksLikeQrLoginScreenshotResendRequest('我已经登录了')).toBe(false);
	});
});
