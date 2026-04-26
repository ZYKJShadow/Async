import { describe, expect, it } from 'vitest';
import { buildAnthropicAuthOptions } from './providerIdentity.js';

describe('buildAnthropicAuthOptions', () => {
	it('uses bearer auth for Claude Code OAuth tokens', () => {
		expect(buildAnthropicAuthOptions('sk-ant-oat-stale', {
			provider: 'claude',
			accessToken: ' sk-ant-oat-fresh ',
		})).toEqual({
			authToken: 'sk-ant-oat-fresh',
			apiKey: null,
			defaultQuery: { beta: 'true' },
		});
	});

	it('treats token-shaped Claude Code OAuth values as bearer auth', () => {
		expect(buildAnthropicAuthOptions(' sk-ant-oat-token-only ')).toEqual({
			authToken: 'sk-ant-oat-token-only',
			apiKey: null,
			defaultQuery: { beta: 'true' },
		});
	});

	it('uses x-api-key auth for normal Anthropic API keys', () => {
		expect(buildAnthropicAuthOptions(' sk-ant-api-key ')).toEqual({
			apiKey: 'sk-ant-api-key',
		});
	});
});
