import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	mergeAgentWithProjectSlice,
	readWorkspaceAgentProjectSlice,
	workspaceAgentJsonPath,
	writeWorkspaceAgentProjectSlice,
} from './workspaceAgentStore.js';

function makeTmpRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'async-store-test-'));
}

function rmDirSafe(dir: string): void {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
}

describe('workspaceAgentStore.readWorkspaceAgentProjectSlice', () => {
	let root: string;
	const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

	beforeEach(() => {
		root = makeTmpRoot();
		warnSpy.mockClear();
	});

	afterEach(() => {
		rmDirSafe(root);
	});

	it('returns empty slice when root is null', () => {
		expect(readWorkspaceAgentProjectSlice(null)).toEqual({});
	});

	it('returns empty slice when agent.json is missing', () => {
		const slice = readWorkspaceAgentProjectSlice(root);
		expect(slice).toEqual({});
	});

	it('returns empty slice when agent.json is a directory, not a file', () => {
		fs.mkdirSync(path.join(root, '.async', 'agent.json'), { recursive: true });
		expect(readWorkspaceAgentProjectSlice(root)).toEqual({});
	});

	it('quarantines invalid JSON to .corrupt-<ts>.bak and returns empty slice', () => {
		const p = workspaceAgentJsonPath(root);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, '{ this is not json', 'utf8');
		const slice = readWorkspaceAgentProjectSlice(root);
		expect(slice).toEqual({});
		expect(fs.existsSync(p)).toBe(false);
		const siblings = fs.readdirSync(path.dirname(p));
		expect(siblings.some((n) => n.startsWith('agent.json.corrupt-') && n.endsWith('.bak'))).toBe(true);
	});

	it('returns empty slice when root is a JSON array (wrong shape)', () => {
		const p = workspaceAgentJsonPath(root);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, '[]', 'utf8');
		expect(readWorkspaceAgentProjectSlice(root)).toEqual({});
	});

	it('returns empty arrays when fields are non-arrays', () => {
		const p = workspaceAgentJsonPath(root);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, JSON.stringify({ rules: 'oops', skills: null, subagents: 7 }), 'utf8');
		const slice = readWorkspaceAgentProjectSlice(root);
		expect(slice).toEqual({ rules: [], skills: [], subagents: [] });
	});

	it('drops malformed rule entries (missing id or name) and keeps valid ones', () => {
		const p = workspaceAgentJsonPath(root);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(
			p,
			JSON.stringify({
				rules: [
					{ id: 'r1', name: 'Good Rule', content: 'body', scope: 'always', enabled: true },
					{ id: '', name: 'No ID' },
					{ name: 'Missing id field', content: 'x' },
					'not-an-object',
					null,
					{ id: 'r2', name: 'Glob Rule', scope: 'glob', globPattern: '*.ts', enabled: false },
				],
			}),
			'utf8'
		);
		const slice = readWorkspaceAgentProjectSlice(root);
		expect(slice.rules).toHaveLength(2);
		expect(slice.rules![0]).toMatchObject({ id: 'r1', name: 'Good Rule', scope: 'always', enabled: true });
		expect(slice.rules![1]).toMatchObject({
			id: 'r2',
			name: 'Glob Rule',
			scope: 'glob',
			globPattern: '*.ts',
			enabled: false,
		});
	});

	it('coerces unknown rule scope to "always" and provides default enabled=true', () => {
		const p = workspaceAgentJsonPath(root);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, JSON.stringify({ rules: [{ id: 'r', name: 'n', scope: 'bogus' }] }), 'utf8');
		const slice = readWorkspaceAgentProjectSlice(root);
		expect(slice.rules![0]).toMatchObject({ scope: 'always', enabled: true });
	});

	it('drops malformed skills (missing id/name/slug) and keeps valid ones', () => {
		const p = workspaceAgentJsonPath(root);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(
			p,
			JSON.stringify({
				skills: [
					{ id: 's1', name: 'Skill A', slug: 'a', description: 'desc', content: 'body' },
					{ id: 's2', name: 'No slug' },
					{ name: 'No id', slug: 'x' },
					{ id: 's3', name: 'Skill C', slug: 'c', pluginSourceKind: 'invalid' },
					{ id: 's4', name: 'Skill D', slug: 'd', pluginSourceKind: 'agent', enabled: true },
				],
			}),
			'utf8'
		);
		const slice = readWorkspaceAgentProjectSlice(root);
		expect(slice.skills!.map((s) => s.id)).toEqual(['s1', 's3', 's4']);
		expect(slice.skills![1].pluginSourceKind).toBeUndefined();
		expect(slice.skills![2].pluginSourceKind).toBe('agent');
	});

	it('drops malformed subagents and preserves valid ones', () => {
		const p = workspaceAgentJsonPath(root);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(
			p,
			JSON.stringify({
				subagents: [
					{ id: 'a1', name: 'Sub', description: 'd', instructions: 'do' },
					{ id: 'a2', name: 'Bogus scope', memoryScope: 'foo' },
					{ id: '', name: 'no id' },
				],
			}),
			'utf8'
		);
		const slice = readWorkspaceAgentProjectSlice(root);
		expect(slice.subagents!.map((s) => s.id)).toEqual(['a1', 'a2']);
		expect(slice.subagents![1].memoryScope).toBeUndefined();
	});

	it('round-trips: write then read returns equivalent shape', () => {
		writeWorkspaceAgentProjectSlice(root, {
			rules: [{ id: 'r1', name: 'R', content: 'c', scope: 'always', enabled: true }],
			skills: [{ id: 's1', name: 'S', slug: 'sl', description: 'd', content: 'c' }],
			subagents: [{ id: 'a1', name: 'A', description: 'd', instructions: 'i' }],
		});
		const slice = readWorkspaceAgentProjectSlice(root);
		expect(slice.rules![0].id).toBe('r1');
		expect(slice.skills![0].slug).toBe('sl');
		expect(slice.subagents![0].id).toBe('a1');
	});
});

describe('workspaceAgentStore.mergeAgentWithProjectSlice', () => {
	it('concatenates user and project arrays without dropping order', () => {
		const merged = mergeAgentWithProjectSlice(
			{
				rules: [{ id: 'u-r', name: 'U', content: '', scope: 'always', enabled: true }],
				skills: [{ id: 'u-s', name: 'U', slug: 'u', description: '', content: '' }],
				subagents: [{ id: 'u-a', name: 'U', description: '', instructions: '' }],
			},
			{
				rules: [{ id: 'p-r', name: 'P', content: '', scope: 'always', enabled: true }],
				skills: [{ id: 'p-s', name: 'P', slug: 'p', description: '', content: '' }],
				subagents: [{ id: 'p-a', name: 'P', description: '', instructions: '' }],
			}
		);
		expect(merged.rules!.map((r) => r.id)).toEqual(['u-r', 'p-r']);
		expect(merged.skills!.map((s) => s.id)).toEqual(['u-s', 'p-s']);
		expect(merged.subagents!.map((a) => a.id)).toEqual(['u-a', 'p-a']);
	});

	it('handles undefined user agent gracefully', () => {
		const merged = mergeAgentWithProjectSlice(undefined, {
			rules: [{ id: 'p-r', name: 'P', content: '', scope: 'always', enabled: true }],
		});
		expect(merged.rules!.map((r) => r.id)).toEqual(['p-r']);
		expect(merged.skills).toEqual([]);
		expect(merged.subagents).toEqual([]);
	});
});
