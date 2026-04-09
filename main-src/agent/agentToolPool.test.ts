import { describe, expect, it, vi, beforeEach } from 'vitest';
import { assembleAgentToolPool, filterMcpToolsByDenyPrefixes } from './agentToolPool.js';
import type { AgentToolDef } from './agentTools.js';

const mockGetAgentTools = vi.fn<() => AgentToolDef[]>(() => []);

vi.mock('../mcp/index.js', () => ({
	getMcpManager: () => ({
		getAgentTools: () => mockGetAgentTools(),
	}),
}));

function tool(name: string): AgentToolDef {
	return {
		name,
		description: 'd',
		parameters: { type: 'object', properties: {}, required: [] },
	};
}

describe('filterMcpToolsByDenyPrefixes', () => {
	it('returns unchanged when deny list empty or undefined', () => {
		const tools = [tool('mcp__a__t1'), tool('mcp__b__t2')];
		expect(filterMcpToolsByDenyPrefixes(tools, undefined)).toEqual(tools);
		expect(filterMcpToolsByDenyPrefixes(tools, [])).toEqual(tools);
	});

	it('filters by prefix', () => {
		const tools = [tool('mcp__bad__x'), tool('mcp__good__y')];
		const out = filterMcpToolsByDenyPrefixes(tools, ['mcp__bad']);
		expect(out.map((t) => t.name)).toEqual(['mcp__good__y']);
	});

	it('ignores empty string prefixes', () => {
		const tools = [tool('mcp__a__t')];
		expect(filterMcpToolsByDenyPrefixes(tools, ['', 'mcp__none'])).toEqual(tools);
	});
});

describe('assembleAgentToolPool', () => {
	beforeEach(() => {
		mockGetAgentTools.mockReset();
		mockGetAgentTools.mockReturnValue([]);
	});

	it('plan mode excludes dynamic mcp tools', () => {
		mockGetAgentTools.mockReturnValue([tool('mcp__srv__ping')]);
		const pool = assembleAgentToolPool('plan');
		expect(pool.some((t) => t.name.startsWith('mcp__'))).toBe(false);
		expect(pool.some((t) => t.name === 'ListMcpResourcesTool')).toBe(true);
		expect(pool.some((t) => t.name === 'ask_plan_question')).toBe(true);
	});

	it('agent mode appends sorted mcp tools after builtins', () => {
		mockGetAgentTools.mockReturnValue([tool('mcp__z__t'), tool('mcp__a__t')]);
		const pool = assembleAgentToolPool('agent');
		const mcpNames = pool.filter((t) => t.name.startsWith('mcp__')).map((t) => t.name);
		expect(mcpNames).toEqual(['mcp__a__t', 'mcp__z__t']);
		const readIdx = pool.findIndex((t) => t.name === 'Read');
		const firstMcp = pool.findIndex((t) => t.name.startsWith('mcp__'));
		expect(readIdx).toBeLessThan(firstMcp);
	});

	it('agent mode applies deny prefixes', () => {
		mockGetAgentTools.mockReturnValue([tool('mcp__x__a'), tool('mcp__y__b')]);
		const pool = assembleAgentToolPool('agent', { mcpToolDenyPrefixes: ['mcp__x'] });
		expect(pool.some((t) => t.name.startsWith('mcp__x'))).toBe(false);
		expect(pool.some((t) => t.name === 'mcp__y__b')).toBe(true);
	});

	it('agent mode drops mcp tools that collide with builtin names', () => {
		mockGetAgentTools.mockReturnValue([tool('Write')]);
		const pool = assembleAgentToolPool('agent');
		expect(pool.filter((t) => t.name === 'Write').length).toBe(1);
	});
});
