import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestJsonMock = vi.hoisted(() => vi.fn());

vi.mock('./common.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./common.js')>();
	return { ...actual, requestJson: requestJsonMock };
});

import { FeishuCardKitClient, FeishuStreamingSession, type CardKitSchema } from './feishuCardKit.js';

function tokenResponse(token = 'tok_test', expire = 7200) {
	return { code: 0, msg: 'ok', tenant_access_token: token, expire };
}

function okResponse<T extends Record<string, unknown> = Record<string, unknown>>(data = {} as T) {
	return { code: 0, msg: 'ok', data };
}

function errorResponse(code: number, msg: string) {
	return { code, msg };
}

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function createClient() {
	return new FeishuCardKitClient({
		appId: 'app_test',
		appSecret: 'secret_test',
		apiBase: 'https://api.test',
	});
}

function mockTokenThenApi(apiResult: unknown) {
	requestJsonMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(apiResult);
}

describe('FeishuCardKitClient', () => {
	beforeEach(() => {
		requestJsonMock.mockReset();
	});

	it('creates a card entity and returns card_id', async () => {
		mockTokenThenApi(okResponse({ card_id: 'card_abc' }));
		const client = createClient();

		const cardId = await client.createCard({
			schema: '2.0',
			config: {
				streaming_mode: true,
				summary: { content: 'test' },
			},
			body: {
				elements: [{ tag: 'markdown', content: 'hi', element_id: 'status' }],
			},
		});

		expect(cardId).toBe('card_abc');
		expect(requestJsonMock).toHaveBeenCalledTimes(2);
		expect(requestJsonMock.mock.calls[1]?.[0]).toBe('https://api.test/cardkit/v1/cards');
	});

	it('updates a component with full element json', async () => {
		mockTokenThenApi(okResponse());
		const client = createClient();

		await client.updateElement(
			'card_1',
			'image_1',
			{
				tag: 'img',
				element_id: 'image_1',
				img_key: 'img_v3_xxx',
				alt: { tag: 'plain_text', content: 'preview' },
			},
			3
		);

		const apiCall = requestJsonMock.mock.calls[1];
		expect(apiCall[0]).toBe('https://api.test/cardkit/v1/cards/card_1/elements/image_1');
		expect(apiCall[1].method).toBe('PUT');
		expect(apiCall[1].body.sequence).toBe(3);
		expect(JSON.parse(apiCall[1].body.element)).toMatchObject({
			tag: 'img',
			element_id: 'image_1',
			img_key: 'img_v3_xxx',
		});
	});

	it('closes streaming mode with a summary', async () => {
		mockTokenThenApi(okResponse());
		const client = createClient();

		await client.closeStreaming('card_1', 'Done', 5);

		const apiCall = requestJsonMock.mock.calls[1];
		expect(apiCall[0]).toBe('https://api.test/cardkit/v1/cards/card_1/settings');
		expect(apiCall[1].method).toBe('PATCH');
		const settings = JSON.parse(apiCall[1].body.settings);
		expect(settings.config.streaming_mode).toBe(false);
		expect(settings.config.summary.content).toBe('Done');
	});

	it('sends the card as an interactive reply message', async () => {
		mockTokenThenApi(okResponse({ message_id: 'msg_123' }));
		const client = createClient();

		const msgId = await client.sendCardMessage('chat_1', 'card_1', 'msg_orig');

		expect(msgId).toBe('msg_123');
		expect(requestJsonMock.mock.calls[1]?.[0]).toBe('https://api.test/im/v1/messages/msg_orig/reply');
	});

	it('retries once on token-expired error', async () => {
		requestJsonMock
			.mockResolvedValueOnce(tokenResponse('tok_old'))
			.mockResolvedValueOnce(errorResponse(99991663, 'token expired'))
			.mockResolvedValueOnce(tokenResponse('tok_new'))
			.mockResolvedValueOnce(okResponse({ card_id: 'card_retry' }));

		const client = createClient();
		const cardId = await client.createCard({
			schema: '2.0',
			config: { streaming_mode: true, summary: { content: '' } },
			body: { elements: [] },
		} as CardKitSchema);

		expect(cardId).toBe('card_retry');
		expect(requestJsonMock).toHaveBeenCalledTimes(4);
	});
});

describe('FeishuStreamingSession', () => {
	let client: FeishuCardKitClient;

	beforeEach(() => {
		requestJsonMock.mockReset();
		vi.useFakeTimers();
		requestJsonMock
			.mockResolvedValueOnce(tokenResponse())
			.mockResolvedValueOnce(okResponse({ card_id: 'card_stream' }))
			.mockResolvedValueOnce(okResponse({ message_id: 'msg_stream' }));
		client = createClient();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('creates a multi-section streaming card on start', async () => {
		const session = new FeishuStreamingSession(client);

		await session.start('chat_1', 'msg_reply');

		expect(session.isActive).toBe(true);
		expect(requestJsonMock).toHaveBeenCalledTimes(3);
		const createCardBody = requestJsonMock.mock.calls[1]?.[1]?.body as Record<string, unknown>;
		const payload = JSON.parse(String(createCardBody.data ?? '{}'));
		expect(payload.body.elements).toHaveLength(8);
		expect(payload.body.elements[0]).toMatchObject({ element_id: 'status', tag: 'markdown' });
		expect(payload.body.elements[3]).toMatchObject({ element_id: 'output', tag: 'markdown' });
	});

	it('waits for startup before sending the final close update', async () => {
		requestJsonMock.mockReset();
		const token = createDeferred<{ code: number; msg: string; tenant_access_token: string; expire: number }>();
		const createCard = createDeferred<{ code: number; msg: string; data: { card_id: string } }>();
		const sendMessage = createDeferred<{ code: number; msg: string; data: { message_id: string } }>();
		const updateStatus = createDeferred<{ code: number; msg: string; data: Record<string, unknown> }>();
		const updateProgress = createDeferred<{ code: number; msg: string; data: Record<string, unknown> }>();
		const updateOutput = createDeferred<{ code: number; msg: string; data: Record<string, unknown> }>();
		const closeStreaming = createDeferred<{ code: number; msg: string; data: Record<string, unknown> }>();
		requestJsonMock
			.mockReturnValueOnce(token.promise)
			.mockReturnValueOnce(createCard.promise)
			.mockReturnValueOnce(sendMessage.promise)
			.mockReturnValueOnce(updateStatus.promise)
			.mockReturnValueOnce(updateProgress.promise)
			.mockReturnValueOnce(updateOutput.promise)
			.mockReturnValueOnce(closeStreaming.promise);

		const session = new FeishuStreamingSession(createClient());
		const startPromise = session.start('chat_1', 'msg_reply');
		session.update('Final answer.');
		const closePromise = session.close('Final answer.');

		token.resolve(tokenResponse());
		createCard.resolve(okResponse({ card_id: 'card_race' }));
		sendMessage.resolve(okResponse({ message_id: 'msg_race' }));
		updateStatus.resolve(okResponse());
		updateProgress.resolve(okResponse());
		updateOutput.resolve(okResponse());
		closeStreaming.resolve(okResponse());

		await startPromise;
		await closePromise;

		expect(requestJsonMock.mock.calls[3]?.[0]).toContain('/cardkit/v1/cards/card_race/elements/status');
		expect(requestJsonMock.mock.calls[4]?.[0]).toContain('/cardkit/v1/cards/card_race/elements/progress');
		expect(requestJsonMock.mock.calls[5]?.[0]).toContain('/cardkit/v1/cards/card_race/elements/output');
		expect(requestJsonMock.mock.calls[6]?.[0]).toContain('/cardkit/v1/cards/card_race/settings');
	});

	it('throttles text updates and renders them into the output element', async () => {
		const session = new FeishuStreamingSession(client);
		await session.start('chat_1');
		requestJsonMock.mockResolvedValue(okResponse());

		session.update('Hello');
		session.update('Hello world');
		session.update('Hello world!');

		expect(requestJsonMock).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(500);

		const updateCalls = requestJsonMock.mock.calls.slice(3);
		expect(updateCalls.some((call) => String(call[0]).includes('/elements/output'))).toBe(true);
		const outputCall = updateCalls.find((call) => String(call[0]).includes('/elements/output'));
		const outputElement = JSON.parse(String(outputCall?.[1]?.body?.element ?? '{}'));
		expect(outputElement.content).toContain('Hello world!');
	});

	it('keeps concrete tool progress visible even after output starts', async () => {
		const session = new FeishuStreamingSession(client);
		await session.start('chat_1');
		requestJsonMock.mockResolvedValue(okResponse());

		session.setToolStatus('Browser', 'running', '浏览器：navigate');
		session.update('Collecting details...');
		await vi.advanceTimersByTimeAsync(500);

		const progressCall = requestJsonMock.mock.calls
			.slice(3)
			.find((call) => String(call[0]).includes('/elements/progress'));
		const progressElement = JSON.parse(String(progressCall?.[1]?.body?.element ?? '{}'));
		expect(progressElement.content).toContain('[当前] 浏览器：navigate');
		expect(progressElement.content).toContain('**进展**');
	});

	it('renders todo items in a dedicated section', async () => {
		const session = new FeishuStreamingSession(client);
		await session.start('chat_1');
		requestJsonMock.mockResolvedValue(okResponse());

		session.setTodos([
			{ content: 'Inspect workspace', status: 'completed' },
			{ content: 'Trace settings flow', status: 'in_progress', activeForm: 'Tracing settings flow' },
			{ content: 'Write fix', status: 'pending' },
		]);
		await vi.advanceTimersByTimeAsync(300);

		const todoCall = requestJsonMock.mock.calls
			.slice(3)
			.find((call) => String(call[0]).includes('/elements/todo'));
		const todoElement = JSON.parse(String(todoCall?.[1]?.body?.element ?? '{}'));
		expect(todoElement.content).toContain('[已完成] Inspect workspace');
		expect(todoElement.content).toContain('[进行中] Tracing settings flow');
		expect(todoElement.content).toContain('[待处理] Write fix');
	});

	it('uploads inline images into dedicated img components', async () => {
		const uploadImage = vi.fn(async () => 'img_v3_uploaded');
		const session = new FeishuStreamingSession(client, { uploadImage });
		await session.start('chat_1');
		requestJsonMock.mockResolvedValue(okResponse());

		const handled = await session.attachImage('C:\\Temp\\capture.png', 'capture.png');
		await vi.advanceTimersByTimeAsync(300);

		expect(handled).toBe(true);
		expect(uploadImage).toHaveBeenCalledWith('C:\\Temp\\capture.png');
		const imageCall = requestJsonMock.mock.calls
			.slice(3)
			.find((call) => String(call[0]).includes('/elements/image_1'));
		const imageElement = JSON.parse(String(imageCall?.[1]?.body?.element ?? '{}'));
		expect(imageElement).toMatchObject({
			tag: 'img',
			element_id: 'image_1',
			img_key: 'img_v3_uploaded',
		});
	});

	it('closes as paused when aborted', async () => {
		const session = new FeishuStreamingSession(client);
		await session.start('chat_1');
		requestJsonMock.mockResolvedValue(okResponse());

		await session.abort('已按指令暂停当前任务。');

		const callsAfterStart = requestJsonMock.mock.calls.slice(3);
		const statusCall = callsAfterStart.find((call) => String(call[0]).includes('/elements/status'));
		const statusElement = JSON.parse(String(statusCall?.[1]?.body?.element ?? '{}'));
		expect(statusElement.content).toContain('**已暂停**');

		const closeCall = callsAfterStart.at(-1);
		const settings = JSON.parse(String(closeCall?.[1]?.body?.settings ?? '{}'));
		expect(settings.config.summary.content).toBe('已暂停');
	});
});
