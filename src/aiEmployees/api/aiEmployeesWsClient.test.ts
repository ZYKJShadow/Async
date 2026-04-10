import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiEmployeesWsClient } from './ws';

type WsInstance = {
	url: string;
	readyState: number;
	onopen: (() => void) | null;
	onmessage: ((ev: { data: unknown }) => void) | null;
	onclose: (() => void) | null;
	onerror: (() => void) | null;
	close: ReturnType<typeof vi.fn>;
	simulateMessage: (data: string) => void;
};

describe('AiEmployeesWsClient', () => {
	const OriginalWebSocket = globalThis.WebSocket;
	let created: WsInstance[];

	beforeEach(() => {
		created = [];
		class MockWebSocket {
			static CONNECTING = 0;
			static OPEN = 1;
			url: string;
			readyState = MockWebSocket.CONNECTING;
			onopen: (() => void) | null = null;
			onmessage: ((ev: { data: unknown }) => void) | null = null;
			onclose: (() => void) | null = null;
			onerror: (() => void) | null = null;
			close = vi.fn(() => {
				this.readyState = 3;
				queueMicrotask(() => this.onclose?.());
			});

			constructor(url: string) {
				this.url = url;
				created.push(this);
				queueMicrotask(() => {
					this.readyState = MockWebSocket.OPEN;
					this.onopen?.();
				});
			}

			simulateMessage(data: string) {
				this.onmessage?.({ data });
			}
		}
		(
			globalThis as unknown as {
				WebSocket: typeof WebSocket & (new (url: string | URL, protocols?: string | string[]) => WsInstance);
			}
		).WebSocket = MockWebSocket as unknown as typeof WebSocket &
			(new (url: string | URL, protocols?: string | string[]) => WsInstance);
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		globalThis.WebSocket = OriginalWebSocket;
	});

	it('connect builds URL with token and workspace_id', () => {
		const conn = { apiBaseUrl: 'http://x', wsBaseUrl: 'ws://127.0.0.1:8080/ws', token: 'abc' };
		const c = new AiEmployeesWsClient(conn, 'b0000001-0001-4000-8000-000000000001');
		c.connect();
		expect(created).toHaveLength(1);
		const u = new URL(created[0]!.url);
		expect(u.searchParams.get('token')).toBe('abc');
		expect(u.searchParams.get('workspace_id')).toBe('b0000001-0001-4000-8000-000000000001');
	});

	it('dispatches registered handlers by event type', () => {
		const conn = { apiBaseUrl: 'http://x', wsBaseUrl: 'ws://h/ws', token: 't' };
		const c = new AiEmployeesWsClient(conn, '00000000-0000-0000-0000-000000000001');
		const fn = vi.fn();
		c.on('issue:updated', fn);
		c.connect();
		const payload = { issue: { id: '1' } };
		created[0]!.simulateMessage(JSON.stringify({ type: 'issue:updated', payload, actor_id: 'actor' }));
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith(payload, 'actor');
	});

	it('ignores malformed JSON', () => {
		const conn = { apiBaseUrl: 'http://x', wsBaseUrl: 'ws://h/ws', token: 't' };
		const c = new AiEmployeesWsClient(conn, '00000000-0000-0000-0000-000000000001');
		const fn = vi.fn();
		c.on('issue:created', fn);
		c.connect();
		created[0]!.simulateMessage('not-json{{{');
		expect(fn).not.toHaveBeenCalled();
	});

	it('unsubscribe removes handler', () => {
		const conn = { apiBaseUrl: 'http://x', wsBaseUrl: 'ws://h/ws', token: 't' };
		const c = new AiEmployeesWsClient(conn, '00000000-0000-0000-0000-000000000001');
		const fn = vi.fn();
		const off = c.on('task:progress', fn);
		c.connect();
		off();
		created[0]!.simulateMessage(JSON.stringify({ type: 'task:progress', payload: {} }));
		expect(fn).not.toHaveBeenCalled();
	});

	it('disconnect prevents reconnect on close', async () => {
		const conn = { apiBaseUrl: 'http://x', wsBaseUrl: 'ws://h/ws', token: 't' };
		const c = new AiEmployeesWsClient(conn, '00000000-0000-0000-0000-000000000001');
		c.connect();
		expect(created).toHaveLength(1);
		c.disconnect();
		created[0]!.onclose?.();
		await vi.advanceTimersByTimeAsync(5000);
		expect(created).toHaveLength(1);
	});

	it('onReconnect runs before reconnecting socket', async () => {
		const conn = { apiBaseUrl: 'http://x', wsBaseUrl: 'ws://h/ws', token: 't' };
		const c = new AiEmployeesWsClient(conn, '00000000-0000-0000-0000-000000000001');
		const fn = vi.fn();
		c.onReconnect(fn);
		c.connect();
		expect(created).toHaveLength(1);
		created[0]!.onclose?.();
		await vi.advanceTimersByTimeAsync(4000);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(created.length).toBeGreaterThanOrEqual(2);
		c.disconnect();
	});
});
