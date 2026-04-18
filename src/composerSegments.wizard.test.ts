import { describe, expect, it } from 'vitest';
import {
	getLeadingWizardCommand,
	isSlashCommandDomPendingUpgrade,
	newSegmentId,
	segmentsToWireText,
	segmentsTrimmedEmpty,
	SLASH_COMMAND_WIRE,
	userMessageToSegments,
	type ComposerSegment,
} from './composerSegments';

function cmdSeg(command: 'create-skill' | 'create-rule' | 'create-subagent'): ComposerSegment {
	return { id: newSegmentId(), kind: 'command', command };
}

/**
 * UI 交互契约（由本文件断言）：
 * - 历史消息里的 `/create-*` 解析为首段 command chip，便于 UserMessageRich 与发送逻辑一致。
 * - 仅 chip、无正文时视为「空输入」不发送（向导前须有一句说明）。
 * - chip 与紧贴的正文之间 wire 会插空格，避免与 @ 路径粘连。
 */
describe('userMessageToSegments — 向导类 slash wire', () => {
	it.each([
		['create-skill', '/create-skill', '写个 skill'],
		['create-rule', '/create-rule', 'Always 规则'],
		['create-subagent', '/create-subagent', '审核角色'],
	] as const)('解析 %s 为 command + 正文', (_slug, wire, body) => {
		const segs = userMessageToSegments(`${wire} ${body}`, []);
		expect(segs[0]).toMatchObject({ kind: 'command', command: _slug });
		expect(segs[1]).toMatchObject({ kind: 'text', text: body });
	});

	it('更长前缀优先：/create-subagent 不会被 /create-skill 截断', () => {
		const segs = userMessageToSegments('/create-subagent 子代理', []);
		expect(segs[0]).toMatchObject({ kind: 'command', command: 'create-subagent' });
	});

	it('兼容 ZWNJ 分隔（历史消息）', () => {
		const segs = userMessageToSegments(`/create-rule\u200c说明`, []);
		expect(segs[0]).toMatchObject({ kind: 'command', command: 'create-rule' });
		expect(segs[1]).toMatchObject({ kind: 'text', text: '说明' });
	});

	it('可按已注册命令列表解析插件 slash 为 command chip', () => {
		const segs = userMessageToSegments('/build-fix src/App.tsx', [], ['build-fix']);
		expect(segs[0]).toMatchObject({ kind: 'command', command: 'build-fix' });
		expect(segs[1]).toMatchObject({ kind: 'text', text: 'src/App.tsx' });
	});
});

describe('getLeadingWizardCommand — 发送前是否弹出向导', () => {
	it('首段为内置 slash chip 时返回对应 id', () => {
		expect(getLeadingWizardCommand([cmdSeg('create-skill'), { id: 't', kind: 'text', text: 'x' }])).toBe(
			'create-skill'
		);
		expect(getLeadingWizardCommand([cmdSeg('create-rule')])).toBe('create-rule');
	});

	it('首段非 command 返回 null', () => {
		expect(getLeadingWizardCommand([{ id: 't', kind: 'text', text: '/create-skill' }])).toBeNull();
	});
});

describe('segmentsTrimmedEmpty — 向导发送门槛', () => {
	it('仅 wizard chip、无尾部正文 → 视为空', () => {
		expect(segmentsTrimmedEmpty([cmdSeg('create-skill')])).toBe(true);
		expect(segmentsTrimmedEmpty([cmdSeg('create-rule'), { id: 't', kind: 'text', text: '   ' }])).toBe(true);
	});

	it('chip 后有非空白正文 → 可进入向导', () => {
		expect(
			segmentsTrimmedEmpty([cmdSeg('create-subagent'), { id: 't', kind: 'text', text: '  hello  ' }])
		).toBe(false);
	});
});

describe('segmentsToWireText — chip 与正文 glue（与 @ 引用一致）', () => {
	it('command 后紧跟非空白文本时插入 ASCII 空格', () => {
		const wire = segmentsToWireText([
			cmdSeg('create-skill'),
			{ id: 't', kind: 'text', text: 'note' },
		]);
		expect(wire).toBe(`${SLASH_COMMAND_WIRE['create-skill']} note`);
	});

	it('command 后文本以空白开头则不重复加空格', () => {
		const wire = segmentsToWireText([
			cmdSeg('create-rule'),
			{ id: 't', kind: 'text', text: '  x' },
		]);
		expect(wire).toBe(`${SLASH_COMMAND_WIRE['create-rule']}  x`);
	});
});

describe('isSlashCommandDomPendingUpgrade — 菜单选中后允许前缀替换成 chip', () => {
	it('已选中的命令不是当前输入前缀扩展时，也允许把旧 /前缀 升级成 chip', () => {
		expect(
			isSlashCommandDomPendingUpgrade(
				[
					{ id: 'c', kind: 'command', command: 'cpp-xx' },
					{ id: 't', kind: 'text', text: '' },
				],
				[{ id: 'd', kind: 'text', text: '/cr' }]
			)
		).toBe(true);
	});

	it('尾部正文不一致时不误判为可升级', () => {
		expect(
			isSlashCommandDomPendingUpgrade(
				[
					{ id: 'c', kind: 'command', command: 'cpp-xx' },
					{ id: 't', kind: 'text', text: 'hello' },
				],
				[{ id: 'd', kind: 'text', text: '/cr world' }]
			)
		).toBe(false);
	});
});
