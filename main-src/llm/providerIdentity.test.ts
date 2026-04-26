import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAnthropicAuthOptions, createAnthropicClient } from './providerIdentity.js';

function capturedHeader(headers: unknown, name: string): string {
	if (headers instanceof Headers) {
		return headers.get(name) ?? '';
	}
	if (!headers || typeof headers !== 'object') {
		return '';
	}
	const record = headers as Record<string, unknown>;
	const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
	const value = key ? record[key] : undefined;
	return typeof value === 'string' ? value : '';
}

describe('buildAnthropicAuthOptions', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

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

	it('forces Claude Code OAuth wire headers on streaming requests', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.stubEnv('ANTHROPIC_BASE_URL', 'https://coder.api.visioncoder.cn');
		let capturedUrl = '';
		let capturedInit: { headers?: unknown; body?: unknown } = {};
		const client = createAnthropicClient({
			apiKey: null,
			authToken: 'sk-ant-oat-test',
			defaultQuery: { beta: 'true' },
			maxRetries: 0,
			fetch: async (url, init) => {
				capturedUrl = String(url);
				capturedInit = init ?? {};
				return new Response(JSON.stringify({ error: { type: 'authentication_error', message: 'stop' } }), {
					status: 401,
					headers: { 'content-type': 'application/json' },
				}) as never;
			},
		});

		await expect((client as any).request({
			method: 'post',
			path: '/v1/messages',
			stream: true,
			body: {
				model: 'claude-sonnet-4-6',
				max_tokens: 1,
				messages: [{ role: 'user', content: 'hi' }],
			},
		})).rejects.toThrow();

		const captured = new URL(capturedUrl);
		expect(captured.origin).toBe('https://api.anthropic.com');
		expect(captured.pathname).toBe('/v1/messages');
		expect(captured.searchParams.get('beta')).toBe('true');
		expect(capturedHeader(capturedInit.headers, 'Authorization')).toBe('Bearer sk-ant-oat-test');
		expect(capturedHeader(capturedInit.headers, 'x-api-key')).toBe('');
		expect(capturedHeader(capturedInit.headers, 'Accept')).toBe('text/event-stream');
		expect(capturedHeader(capturedInit.headers, 'Accept-Encoding')).toBe('identity');
		expect(capturedHeader(capturedInit.headers, 'Anthropic-Beta')).toContain('oauth-2025-04-20');
		expect(capturedHeader(capturedInit.headers, 'X-App')).toBe('cli');
		expect(capturedHeader(capturedInit.headers, 'X-Claude-Code-Session-Id')).toBeTruthy();
		const body = JSON.parse(String(capturedInit.body)) as {
			system: Array<{ text?: string }>;
			metadata: { user_id?: string };
		};
		expect(body.system).toHaveLength(3);
		expect(body.system[0]?.text).toMatch(/^x-anthropic-billing-header: .* cch=(?!00000)[0-9a-f]{5};$/);
		expect(body.system[1]?.text).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
		expect(body.metadata.user_id).toMatch(
			/^user_[a-f0-9]{64}_account_[0-9a-f-]{36}_session_[0-9a-f-]{36}$/
		);
		expect(capturedHeader(capturedInit.headers, 'Content-Length')).toBe(String(Buffer.byteLength(String(capturedInit.body))));
	});
});
