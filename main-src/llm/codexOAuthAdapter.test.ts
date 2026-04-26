import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellSettings, ProviderOAuthAuthRecord } from '../settingsStore.js';
import { runCodexOAuthResponseText, streamCodexOAuth } from './codexOAuthAdapter.js';
import type { SendableMessage } from './sendResolved.js';
import type { UnifiedChatOptions } from './types.js';

const mocks = vi.hoisted(() => ({
	electronNetFetch: vi.fn(),
	ensureFreshOAuthAuthForRequest: vi.fn(),
}));

vi.mock('./electronNetFetch.js', () => ({
	electronNetFetch: mocks.electronNetFetch,
}));

vi.mock('./providerOAuthLogin.js', () => ({
	ensureFreshOAuthAuthForRequest: mocks.ensureFreshOAuthAuthForRequest,
}));

function sseResponse(events: Record<string, unknown>[]): Response {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
		status: 200,
		headers: { 'content-type': 'text/event-stream' },
	});
}

function capturedBody(): Record<string, unknown> {
	const init = mocks.electronNetFetch.mock.calls[0]?.[1] as { body?: unknown } | undefined;
	return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

describe('Codex OAuth Responses requests', () => {
	const auth: ProviderOAuthAuthRecord = {
		provider: 'codex',
		accessToken: 'codex-access-token',
		refreshToken: 'codex-refresh-token',
		lastRefreshAt: 0,
		accountId: 'account-id',
	};

	beforeEach(() => {
		mocks.electronNetFetch.mockReset();
		mocks.ensureFreshOAuthAuthForRequest.mockReset();
		mocks.ensureFreshOAuthAuthForRequest.mockImplementation(async (_providerId: string | undefined, inputAuth: ProviderOAuthAuthRecord) => inputAuth);
	});

	it('sets store false on text helper requests', async () => {
		mocks.electronNetFetch.mockResolvedValueOnce(sseResponse([
			{
				type: 'response.completed',
				response: {
					output: [{ content: [{ text: 'ok' }] }],
				},
			},
		]));

		await runCodexOAuthResponseText({
			auth,
			model: 'gpt-5.3-codex',
			instructions: 'Summarize.',
			input: 'hello',
		});

		expect(capturedBody().store).toBe(false);
	});

	it('sets store false on chat streaming requests', async () => {
		mocks.electronNetFetch.mockResolvedValueOnce(sseResponse([
			{ type: 'response.output_text.delta', delta: 'ok' },
			{ type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } },
		]));
		const done = vi.fn();
		const messages: SendableMessage[] = [
			{ role: 'system', content: 'system' },
			{ role: 'user', content: 'hello' },
		];
		const options = {
			mode: 'ask',
			signal: new AbortController().signal,
			requestProviderId: 'provider-id',
			requestModelId: 'gpt-5.3-codex',
			requestOAuthAuth: auth,
			maxOutputTokens: 100,
			temperatureMode: 'auto',
			thinkingLevel: 'off',
		} as UnifiedChatOptions;

		await streamCodexOAuth({} as ShellSettings, messages, options, {
			onDelta: vi.fn(),
			onDone: done,
			onError: vi.fn(),
		}, auth);

		expect(capturedBody().store).toBe(false);
		expect(done).toHaveBeenCalled();
	});
});
