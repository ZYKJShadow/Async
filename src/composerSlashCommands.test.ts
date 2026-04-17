import { describe, expect, it } from 'vitest';
import type { AgentCommand } from './agentSettingsTypes';
import {
	agentCommandsToSlashMenuEntries,
	buildSlashCommandListRows,
	BUILTIN_SLASH_COMMANDS,
	filterSlashMenuEntries,
	getLeadingSlashCommandQuery,
	mergeSlashMenuEntries,
	resolveSlashMenuRow,
	slashMenuEntryLabel,
} from './composerSlashCommands';

/** 稳定占位：与真实 i18n 解耦，仅验证 key 被走到 */
const mockT = (key: string) => `[t:${key}]`;

describe('composerSlashCommands — 合并设置与内置（UI：菜单一条龙、内置优先）', () => {
	it('mergeSlashMenuEntries：内置三项在前，顺序稳定', () => {
		const merged = mergeSlashMenuEntries(undefined);
		expect(merged.map((e) => e.name)).toEqual(['create-skill', 'create-rule', 'create-subagent']);
		expect(merged.every((e) => e.source === 'builtin')).toBe(true);
	});

	it('agentCommandsToSlashMenuEntries：与内置同名的用户 slash 被丢弃（避免覆盖向导 chip）', () => {
		const user: AgentCommand[] = [
			{ id: '1', name: '假 skill', slash: 'create-skill', body: 'x', description: 'd' },
			{ id: '2', name: '我的', slash: 'plan', body: '{{args}}', description: '跑计划' },
		];
		const userOnly = agentCommandsToSlashMenuEntries(user);
		expect(userOnly.map((e) => e.name)).toEqual(['plan']);
		expect(userOnly[0]!.insert).toEqual({ type: 'chip', chip: 'plan' });
	});

	it('slashMenuEntryLabel：chip 统一显示为 /name', () => {
		const merged = mergeSlashMenuEntries([
			{ id: 'a', name: 'L', slash: 'lint', body: 'x', description: '' },
		]);
		const chip = merged.find((e) => e.name === 'create-rule')!;
		const text = merged.find((e) => e.name === 'lint')!;
		expect(slashMenuEntryLabel(chip)).toBe('/create-rule');
		expect(slashMenuEntryLabel(text)).toBe('/lint');
		expect(text.insert).toEqual({ type: 'chip', chip: 'lint' });
	});

	it('filterSlashMenuEntries：按 name 前缀与描述子串过滤（模拟输入框 / 查询）', () => {
		const entries = mergeSlashMenuEntries([
			{ id: '1', name: 'x', slash: 'deploy', body: 'b', description: '生产发布' },
		]);
		expect(filterSlashMenuEntries(entries, 'create').map((e) => e.name)).toEqual([
			'create-skill',
			'create-rule',
			'create-subagent',
		]);
		expect(filterSlashMenuEntries(entries, '发布').map((e) => e.name)).toEqual(['deploy']);
		expect(filterSlashMenuEntries(entries, '').length).toBe(entries.length);
	});

	it('buildSlashCommandListRows：设置页 / 帮助弹层同源数据（builtin + user 带 source）', () => {
		const rows = buildSlashCommandListRows(
			[{ id: 'u1', name: 'N', slash: '/foo', body: 'b', description: '用户说明' }],
			mockT
		);
		const builtins = rows.filter((r) => r.source === 'builtin');
		const customs = rows.filter((r) => r.source === 'user');
		expect(builtins.length).toBe(BUILTIN_SLASH_COMMANDS.length);
		expect(builtins[0]!.description.startsWith('[t:')).toBe(true);
		expect(customs).toEqual([{ label: '/foo', description: '用户说明', source: 'user' }]);
	});

	it('resolveSlashMenuRow：无 description 时用 name 作字面说明', () => {
		const entry = agentCommandsToSlashMenuEntries([
			{ id: '1', name: '显示名', slash: 'bar', body: 'x' },
		])[0]!;
		const row = resolveSlashMenuRow(entry, mockT);
		expect(row.description).toBe('显示名');
	});
});

describe('getLeadingSlashCommandQuery — 补全菜单何时出现（UI：仅在「命令 token」内）', () => {
	it('光标在 /cre 内返回 cre', () => {
		expect(getLeadingSlashCommandQuery('/create-skill', '/cre')).toBe('cre');
	});

	it('已进入参数区（token 后有空格）返回 null', () => {
		expect(getLeadingSlashCommandQuery('/create-skill more', '/create-skill ')).toBeNull();
	});

	it('plainPrefix 与首段不对齐返回 null', () => {
		expect(getLeadingSlashCommandQuery('/foo', 'x')).toBeNull();
	});
});
