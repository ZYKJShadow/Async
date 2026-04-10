import { describe, expect, it } from 'vitest';
import { AI_EMPLOYEES_WS_EVENT_NAMES } from './wsEventNames';
import type { WSMessage } from './types';

/** 契约：代理 WebSocket 广播 JSON 形状（type + payload + 可选 actor_id） */
describe('aiEmployees WS message contract', () => {
	it('accepts proxy envelope with type and payload', () => {
		const raw = '{"type":"issue:updated","payload":{"issue":{"id":"x"}},"actor_id":"u1"}';
		const msg = JSON.parse(raw) as WSMessage;
		expect(msg.type).toBe('issue:updated');
		expect(msg.payload).toEqual({ issue: { id: 'x' } });
		expect(msg.actor_id).toBe('u1');
	});

	it('every protocol event name round-trips as JSON type field', () => {
		for (const eventType of AI_EMPLOYEES_WS_EVENT_NAMES) {
			const msg: WSMessage = { type: eventType, payload: {} };
			const again = JSON.parse(JSON.stringify(msg)) as WSMessage;
			expect(again.type).toBe(eventType);
			expect(again.payload).toEqual({});
		}
	});
});
