import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initSettingsStore, patchSettings } from '../settingsStore.js';
import { bumpPluginDiscoveryVersion } from './pluginDiscoveryVersion.js';
import { getPluginRuntimeState, mergeAgentWithPluginRuntime } from './pluginRuntimeService.js';

const tempRoots: string[] = [];

function makeTempRoot(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempRoots.push(dir);
	return dir;
}

function writeFile(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, 'utf8');
}

afterEach(() => {
	while (tempRoots.length > 0) {
		const dir = tempRoots.pop();
		if (dir && fs.existsSync(dir)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe('pluginRuntimeService', () => {
	it('loads skills, command docs, and MCP servers from installed plugins', () => {
		const userData = makeTempRoot('async-plugin-runtime-settings-');
		const userPluginsRoot = makeTempRoot('async-plugin-runtime-plugins-');
		initSettingsStore(userData);
		patchSettings({
			plugins: {
				userPluginsDir: userPluginsRoot,
			},
		});

		const pluginRoot = path.join(userPluginsRoot, 'ecc');
		writeFile(
			path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
			JSON.stringify(
				{
					name: 'ecc',
					skills: ['./skills/'],
					commands: ['./commands/'],
					agents: ['./agents/architect.md'],
				},
				null,
				2
			)
		);
		writeFile(
			path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
			JSON.stringify(
				{
					name: 'ecc',
					skills: './skills/',
					mcpServers: './.mcp.json',
					interface: { displayName: 'Everything Claude Code' },
				},
				null,
				2
			)
		);
		writeFile(
			path.join(pluginRoot, 'skills', 'tdd-workflow', 'SKILL.md'),
			`---
name: TDD Workflow
description: Test-first workflow
---

Write tests before code.`
		);
		writeFile(
			path.join(pluginRoot, 'commands', 'build-fix.md'),
			`---
description: Fix the build.
---

# Build Fix

Use $ARGUMENTS`
		);
		writeFile(
			path.join(pluginRoot, 'agents', 'architect.md'),
			`---
name: architect
description: Architecture role
---

Design the system.`
		);
		writeFile(
			path.join(pluginRoot, '.mcp.json'),
			JSON.stringify(
				{
					mcpServers: {
						github: {
							command: 'npx',
							args: ['-y', '@modelcontextprotocol/server-github'],
						},
					},
				},
				null,
				2
			)
		);

		bumpPluginDiscoveryVersion();
		const runtime = getPluginRuntimeState(null);
		expect(runtime.plugins).toHaveLength(1);
		expect(runtime.skills.map((skill) => skill.slug).sort()).toEqual(['architect', 'tdd-workflow']);
		expect(runtime.commands.map((command) => command.slash)).toEqual(['build-fix']);
		expect(runtime.commands[0]?.invocation).toBe('prompt');
		const tddSkill = runtime.skills.find((skill) => skill.slug === 'tdd-workflow');
		expect(tddSkill?.skillBaseDirAbs).toBe(path.join(pluginRoot, 'skills', 'tdd-workflow'));
		expect(tddSkill?.pluginRootAbs).toBe(pluginRoot);
		const architectSkill = runtime.skills.find((skill) => skill.slug === 'architect');
		expect(architectSkill?.skillBaseDirAbs).toBe(path.join(pluginRoot, 'agents'));
		expect(architectSkill?.pluginRootAbs).toBe(pluginRoot);
		expect(runtime.commands[0]?.commandBaseDirAbs).toBe(path.join(pluginRoot, 'commands'));
		expect(runtime.commands[0]?.pluginRootAbs).toBe(pluginRoot);
		expect(runtime.mcpServers.map((server) => server.name)).toEqual(['github']);
		expect(runtime.plugins[0]?.pluginName).toBe('Everything Claude Code');
	});

	it('keeps user commands ahead of plugin commands when merging agent runtime', () => {
		const userData = makeTempRoot('async-plugin-runtime-settings-');
		const userPluginsRoot = makeTempRoot('async-plugin-runtime-plugins-');
		initSettingsStore(userData);
		patchSettings({
			plugins: {
				userPluginsDir: userPluginsRoot,
			},
		});
		const pluginRoot = path.join(userPluginsRoot, 'demo-plugin');
		writeFile(
			path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
			JSON.stringify(
				{
					name: 'demo-plugin',
					commands: ['./commands/'],
				},
				null,
				2
			)
		);
		writeFile(
			path.join(pluginRoot, 'commands', 'plan.md'),
			'# Plan\n\nUse $ARGUMENTS'
		);

		bumpPluginDiscoveryVersion();
		const merged = mergeAgentWithPluginRuntime(
			{
				commands: [
					{
						id: 'user-plan',
						name: 'Plan',
						slash: 'plan',
						body: 'User override: {{args}}',
					},
				],
			},
			null
		);
		expect(merged.commands?.map((command) => command.id)).toEqual([
			'user-plan',
			expect.stringMatching(/^plugin-command:/),
		]);
	});

	it('applies persisted plugin MCP overrides without requiring a plugin rescan', () => {
		const userData = makeTempRoot('async-plugin-runtime-settings-');
		const userPluginsRoot = makeTempRoot('async-plugin-runtime-plugins-');
		initSettingsStore(userData);
		patchSettings({
			plugins: {
				userPluginsDir: userPluginsRoot,
			},
		});

		const pluginRoot = path.join(userPluginsRoot, 'ecc');
		writeFile(
			path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
			JSON.stringify(
				{
					name: 'ecc',
					mcpServers: './.mcp.json',
				},
				null,
				2
			)
		);
		writeFile(
			path.join(pluginRoot, '.mcp.json'),
			JSON.stringify(
				{
					mcpServers: {
						github: {
							command: 'npx',
							args: ['-y', '@modelcontextprotocol/server-github'],
						},
					},
				},
				null,
				2
			)
		);

		bumpPluginDiscoveryVersion();
		const initial = getPluginRuntimeState(null);
		expect(initial.mcpServers).toHaveLength(1);
		const github = initial.mcpServers[0];
		expect(github?.enabled).toBe(true);
		expect(github?.autoStart).toBe(true);

		patchSettings({
			pluginMcpOverrides: {
				[github!.id]: {
					enabled: false,
					autoStart: false,
				},
			},
		});

		const overridden = getPluginRuntimeState(null);
		expect(overridden.mcpServers[0]?.id).toBe(github?.id);
		expect(overridden.mcpServers[0]?.enabled).toBe(false);
		expect(overridden.mcpServers[0]?.autoStart).toBe(false);
	});
});
