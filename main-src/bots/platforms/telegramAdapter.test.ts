import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import type { PlatformInboundEnvelope } from './common.js';

const { fetchMock, setProxyMock, closeAllConnectionsMock, fromPartitionMock, requestJsonMock } = vi.hoisted(() => {
	const fetchMock = vi.fn();
	const setProxyMock = vi.fn(async () => {});
	const closeAllConnectionsMock = vi.fn(async () => {});
	const fromPartitionMock = vi.fn(() => ({
		setProxy: setProxyMock,
		closeAllConnections: closeAllConnectionsMock,
		fetch: fetchMock,
	}));
	const requestJsonMock = vi.fn();
	return {
		fetchMock,
		setProxyMock,
		closeAllConnectionsMock,
		fromPartitionMock,
		requestJsonMock,
	};
});

vi.mock('electron', () => ({
	app: {
		getPath: vi.fn(() => os.tmpdir()),
	},
	session: {
		fromPartition: fromPartitionMock,
	},
}));

vi.mock('./common.js', async () => {
	const actual = await vi.importActual<typeof import('./common.js')>('./common.js');
	return {
		...actual,
		requestJson: requestJsonMock,
	};
});

import { TelegramBotAdapter } from './telegramAdapter.js';

function telegramOk<T>(result: T) {
	return { ok: true, result };
}

function jsonResponse(body: unknown) {
	return {
		ok: true,
		json: async () => body,
	};
}

function abortablePending(signal?: AbortSignal) {
	return new Promise<never>((_resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error('aborted'));
			return;
		}
		signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
	});
}

describe('TelegramBotAdapter', () => {
	const tempDirs: string[] = [];

	beforeEach(() => {
		vi.useRealTimers();
		setProxyMock.mockClear();
		closeAllConnectionsMock.mockClear();
		fromPartitionMock.mockClear();
		requestJsonMock.mockReset();
		fetchMock.mockReset();
	});

	afterEach(() => {
		for (const dir of tempDirs.splice(0, tempDirs.length)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it('uploads reply images and files back to Telegram with reply context', async () => {
		let getUpdatesCalls = 0;
		fetchMock.mockImplementation(async (url: string, options?: { signal?: AbortSignal }) => {
			if (url.endsWith('/getMe')) {
				return jsonResponse(telegramOk({ username: 'async_bot' }));
			}
			if (url.endsWith('/getUpdates')) {
				if (getUpdatesCalls === 0) {
					getUpdatesCalls += 1;
					return jsonResponse(
						telegramOk([
							{
								update_id: 1,
								message: {
									message_id: 321,
									message_thread_id: 654,
									text: 'send it back',
									chat: { id: 123456, type: 'supergroup' },
									from: { id: 7, username: 'alice' },
								},
							},
						])
					);
				}
				return await abortablePending(options?.signal);
			}
			throw new Error(`Unexpected fetch URL: ${url}`);
		});
		requestJsonMock.mockResolvedValue(telegramOk({ message_id: 999 }));

		const integration: BotIntegrationConfig = {
			id: 'tg-1',
			name: 'Telegram',
			platform: 'telegram',
			telegram: {
				botToken: 'secret-token',
				requireMentionInGroups: false,
			},
		};

		const adapter = new TelegramBotAdapter(integration);
		let resolveEnvelope: ((value: PlatformInboundEnvelope) => void) | null = null;
		const envelopePromise = new Promise<PlatformInboundEnvelope>((resolve) => {
			resolveEnvelope = resolve;
		});

		await adapter.start(async (envelope) => {
			resolveEnvelope?.(envelope);
		});

		const envelope = await envelopePromise;
		expect(envelope.replyImage).toBeTypeOf('function');
		expect(envelope.replyFile).toBeTypeOf('function');

		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'async-tg-test-'));
		tempDirs.push(tempDir);
		const imagePath = path.join(tempDir, 'capture.png');
		const filePath = path.join(tempDir, 'report.txt');
		fs.writeFileSync(imagePath, 'png');
		fs.writeFileSync(filePath, 'report');

		await envelope.replyImage?.(imagePath);
		await envelope.replyFile?.(filePath);
		await adapter.stop();

		expect(requestJsonMock).toHaveBeenCalledTimes(2);
		expect(requestJsonMock).toHaveBeenNthCalledWith(
			1,
			'https://api.telegram.org/botsecret-token/sendPhoto',
			expect.objectContaining({
				method: 'POST',
				proxyUrl: undefined,
			})
		);
		expect(requestJsonMock).toHaveBeenNthCalledWith(
			2,
			'https://api.telegram.org/botsecret-token/sendDocument',
			expect.objectContaining({
				method: 'POST',
				proxyUrl: undefined,
			})
		);

		const firstBody = requestJsonMock.mock.calls[0]?.[1]?.body as { _streams?: unknown[] };
		const secondBody = requestJsonMock.mock.calls[1]?.[1]?.body as { _streams?: unknown[] };
		const firstSerialized = (firstBody._streams ?? []).filter((item): item is string => typeof item === 'string').join('\n');
		const secondSerialized = (secondBody._streams ?? []).filter((item): item is string => typeof item === 'string').join('\n');

		expect(firstSerialized).toContain('name="chat_id"');
		expect(firstSerialized).toContain('123456');
		expect(firstSerialized).toContain('name="reply_to_message_id"');
		expect(firstSerialized).toContain('321');
		expect(firstSerialized).toContain('name="message_thread_id"');
		expect(firstSerialized).toContain('654');
		expect(firstSerialized).toContain('name="photo"');
		expect(firstSerialized).toContain('filename="capture.png"');

		expect(secondSerialized).toContain('name="document"');
		expect(secondSerialized).toContain('filename="report.txt"');
		expect(closeAllConnectionsMock).toHaveBeenCalled();
	});

	it('provides streamReply callbacks that send and edit progress messages', async () => {
		vi.useFakeTimers();
		let getUpdatesCalls = 0;
		fetchMock.mockImplementation(async (url: string, options?: { signal?: AbortSignal; body?: string }) => {
			if (url.endsWith('/getMe')) {
				return jsonResponse(telegramOk({ username: 'async_bot' }));
			}
			if (url.endsWith('/getUpdates')) {
				if (getUpdatesCalls === 0) {
					getUpdatesCalls += 1;
					return jsonResponse(
						telegramOk([
							{
								update_id: 2,
								message: {
									message_id: 555,
									text: 'stream please',
									chat: { id: 10001, type: 'private' },
									from: { id: 8, username: 'bob' },
								},
							},
						])
					);
				}
				return await abortablePending(options?.signal);
			}
			if (url.endsWith('/sendMessage')) {
				return jsonResponse(telegramOk({ message_id: 777 }));
			}
			if (url.endsWith('/editMessageText')) {
				return jsonResponse(telegramOk({ message_id: 777 }));
			}
			throw new Error(`Unexpected fetch URL: ${url}`);
		});

		const integration: BotIntegrationConfig = {
			id: 'tg-stream',
			name: 'Telegram',
			platform: 'telegram',
			telegram: {
				botToken: 'secret-token',
			},
		};

		const adapter = new TelegramBotAdapter(integration);
		let resolveEnvelope: ((value: PlatformInboundEnvelope) => void) | null = null;
		const envelopePromise = new Promise<PlatformInboundEnvelope>((resolve) => {
			resolveEnvelope = resolve;
		});

		await adapter.start(async (envelope) => {
			resolveEnvelope?.(envelope);
		});
		const envelope = await envelopePromise;
		expect(envelope.streamReply).toBeTruthy();

		await envelope.streamReply!.onStart();
		await envelope.streamReply!.onDelta('正在打开页面');
		await vi.advanceTimersByTimeAsync(1000);
		await envelope.streamReply!.onToolStatus('Browser', 'running', '浏览器：navigate');
		await vi.advanceTimersByTimeAsync(1000);
		await envelope.streamReply!.onDone('最终完成');
		await adapter.stop();

		const sendMessageCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/sendMessage'));
		const editCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/editMessageText'));
		expect(sendMessageCalls.length).toBeGreaterThanOrEqual(1);
		expect(editCalls.length).toBeGreaterThanOrEqual(1);

		const firstSendBody = JSON.parse(String(sendMessageCalls[0]?.[1]?.body ?? '{}')) as Record<string, unknown>;
		expect(String(firstSendBody.text ?? '')).toContain('处理中');

		const lastEditBody = JSON.parse(String(editCalls.at(-1)?.[1]?.body ?? '{}')) as Record<string, unknown>;
		expect(String(lastEditBody.text ?? '')).toContain('最终完成');
	});
});
