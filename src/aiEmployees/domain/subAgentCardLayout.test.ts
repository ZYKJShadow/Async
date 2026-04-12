import { describe, expect, it } from 'vitest';
import {
	subAgentCardCompactHead,
	subAgentCardShowBody,
	subAgentCardShowDesc,
} from './subAgentCardLayout';

describe('subAgentCardLayout', () => {
	it('showBody: always when no timeline; only when open if timeline', () => {
		expect(subAgentCardShowBody(false, false)).toBe(true);
		expect(subAgentCardShowBody(false, true)).toBe(true);
		expect(subAgentCardShowBody(true, false)).toBe(false);
		expect(subAgentCardShowBody(true, true)).toBe(true);
	});

	it('showDesc: needs text; gated by timeline open when timeline exists', () => {
		expect(subAgentCardShowDesc(undefined, false, false)).toBe(false);
		expect(subAgentCardShowDesc('  ', true, false)).toBe(false);
		expect(subAgentCardShowDesc('note', false, false)).toBe(true);
		expect(subAgentCardShowDesc('note', true, false)).toBe(false);
		expect(subAgentCardShowDesc('note', true, true)).toBe(true);
	});

	it('compactHead: only when timeline exists and collapsed', () => {
		expect(subAgentCardCompactHead(false, false)).toBe(false);
		expect(subAgentCardCompactHead(true, true)).toBe(false);
		expect(subAgentCardCompactHead(true, false)).toBe(true);
	});
});
