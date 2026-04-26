import { describe, expect, it } from 'vitest';
import type { ShellSettings } from '../settingsStore.js';
import { resolveModelRequest } from './modelResolve.js';

describe('resolveModelRequest OAuth inference', () => {
	it('treats token-shaped Claude Code values as OAuth bearer credentials', () => {
		const settings: ShellSettings = {
			models: {
				providers: [
					{
						id: 'provider-claude-oauth',
						displayName: 'Claude Code',
						paradigm: 'anthropic',
						apiKey: ' sk-ant-oat-token-only ',
					},
				],
				entries: [
					{
						id: 'model-claude',
						providerId: 'provider-claude-oauth',
						displayName: 'Claude',
						requestName: 'claude-sonnet-4-5-20250929',
					},
				],
				enabledIds: ['model-claude'],
			},
			defaultModel: 'model-claude',
		};

		const resolved = resolveModelRequest(settings, 'model-claude');

		expect(resolved.ok).toBe(true);
		if (!resolved.ok) {
			return;
		}
		expect(resolved.oauthAuth).toEqual({
			provider: 'claude',
			accessToken: 'sk-ant-oat-token-only',
			refreshToken: '',
			lastRefreshAt: 0,
		});
		expect(resolved.providerIdentity).toEqual({ preset: 'claude-code' });
	});
});
