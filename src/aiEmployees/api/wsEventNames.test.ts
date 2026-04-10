import { describe, expect, it } from 'vitest';
import { AI_EMPLOYEES_WS_EVENT_NAMES } from './wsEventNames';

describe('AI_EMPLOYEES_WS_EVENT_NAMES', () => {
	it('has a stable count for proxy protocol coverage', () => {
		expect(AI_EMPLOYEES_WS_EVENT_NAMES.length).toBe(43);
	});

	it('has no duplicate entries', () => {
		const set = new Set(AI_EMPLOYEES_WS_EVENT_NAMES);
		expect(set.size).toBe(AI_EMPLOYEES_WS_EVENT_NAMES.length);
	});

	it('uses colon-separated segments', () => {
		for (const e of AI_EMPLOYEES_WS_EVENT_NAMES) {
			expect(e).toMatch(/^[a-z_]+:[a-z0-9_-]+$/);
		}
	});

	it('includes core workspace event names', () => {
		expect(AI_EMPLOYEES_WS_EVENT_NAMES).toContain('issue:created');
		expect(AI_EMPLOYEES_WS_EVENT_NAMES).toContain('task:progress');
		expect(AI_EMPLOYEES_WS_EVENT_NAMES).toContain('daemon:heartbeat');
	});
});
