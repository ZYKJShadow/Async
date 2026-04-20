import { describe, expect, it } from 'vitest';
import { splitPreflightAndOutcome, type RenderUnit } from './preflightSplit';

const md = (text: string): RenderUnit => ({ type: 'markdown', text });
const think = (text = '思考'): RenderUnit => ({
	type: 'thinking_group',
	chunks: [{ type: 'thinking', id: 't1', text }],
});
const activity = (status: 'pending' | 'success' | 'error' | 'info' = 'success'): RenderUnit => ({
	type: 'activity',
	text: 'reading file.ts',
	status,
});
const activityGroup = (pending = false): RenderUnit => ({
	type: 'activity_group',
	items: [],
	pending,
	summary: 'Explored 2 files',
});
const fileEdit = (): RenderUnit => ({
	type: 'file_edit',
	tool: 'edit',
	path: 'a.ts',
	isStreaming: false,
	hasError: false,
	args: {},
	rawResult: null,
	id: 'fe-1',
} as unknown as RenderUnit);
const command = (): RenderUnit => ({ type: 'command', lang: 'bash', body: 'ls' });
const marker = (): RenderUnit => ({ type: 'outcome_marker' });

describe('splitPreflightAndOutcome', () => {
	it('空 units 返回空 preflight 和空 outcome', () => {
		const r = splitPreflightAndOutcome([]);
		expect(r.preflight).toEqual([]);
		expect(r.outcome).toEqual([]);
	});

	it('纯 markdown：完成态走兜底归 outcome；流式期间留 preflight（防外→内跳变）', () => {
		const units = [md('hello'), md('world')];
		const done = splitPreflightAndOutcome(units, { liveTurn: false });
		expect(done.preflight).toEqual([]);
		expect(done.outcome).toEqual(units);
		const live = splitPreflightAndOutcome(units, { liveTurn: true });
		expect(live.preflight).toEqual(units);
		expect(live.outcome).toEqual([]);
	});

	it('强结果（file_edit）出现 → 在该位置切分（流式与完成态行为一致）', () => {
		const t = think();
		const a = activity();
		const fe = fileEdit();
		const tail = md('done');
		const units = [t, a, fe, tail];
		const live = splitPreflightAndOutcome(units, { liveTurn: true });
		expect(live.preflight).toEqual([t, a]);
		expect(live.outcome).toEqual([fe, tail]);
		const done = splitPreflightAndOutcome(units, { liveTurn: false });
		expect(done.preflight).toEqual([t, a]);
		expect(done.outcome).toEqual([fe, tail]);
	});

	it('多个强结果按第一个切分', () => {
		const t = think();
		const c1 = command();
		const c2 = command();
		const r = splitPreflightAndOutcome([t, c1, c2], { liveTurn: false });
		expect(r.preflight).toEqual([t]);
		expect(r.outcome).toEqual([c1, c2]);
	});

	it('liveTurn=false：尾部 markdown 在过程单元后 → 切到 outcome 当总结', () => {
		const t = think();
		const a = activity();
		const tail = md('完成。');
		const r = splitPreflightAndOutcome([t, a, tail], { liveTurn: false });
		expect(r.preflight).toEqual([t, a]);
		expect(r.outcome).toEqual([tail]);
	});

	it('liveTurn=true：尾部 markdown 永不外置，留在 preflight', () => {
		const t = think();
		const a = activity();
		const tail1 = md('总结一下：');
		const tail2 = md('完成 X、Y。');
		const r = splitPreflightAndOutcome([t, a, tail1, tail2], { liveTurn: true });
		expect(r.preflight).toEqual([t, a, tail1, tail2]);
		expect(r.outcome).toEqual([]);
	});

	it('单向迁移不变量：流式期间无论顺序如何，markdown 永远不会从 outcome 跳回 preflight', () => {
		// 阶段 1：纯 markdown
		const m1 = md('我先看一下');
		const phase1 = splitPreflightAndOutcome([m1], { liveTurn: true });
		expect(phase1.outcome).toEqual([]);
		// 阶段 2：追加 process unit
		const a = activity('pending');
		const phase2 = splitPreflightAndOutcome([m1, a], { liveTurn: true });
		expect(phase2.outcome).toEqual([]);
		// 阶段 3：再追加 markdown
		const m2 = md('结论');
		const phase3 = splitPreflightAndOutcome([m1, a, m2], { liveTurn: true });
		expect(phase3.outcome).toEqual([]);
		// 阶段 4：才出现强结果，cutoff 切在强结果处
		const fe = fileEdit();
		const phase4 = splitPreflightAndOutcome([m1, a, m2, fe], { liveTurn: true });
		expect(phase4.preflight).toEqual([m1, a, m2]);
		expect(phase4.outcome).toEqual([fe]);
	});

	it('过程单元 + markdown + 强结果 + 尾部 markdown：在强结果处切，尾部 markdown 跟着进 outcome', () => {
		const t = think();
		const m1 = md('我修改一下');
		const fe = fileEdit();
		const m2 = md('改好了');
		const r = splitPreflightAndOutcome([t, m1, fe, m2], { liveTurn: false });
		expect(r.preflight).toEqual([t, m1]);
		expect(r.outcome).toEqual([fe, m2]);
	});

	it('activity_group(pending) 也算过程单元；流式期间 markdown 仍留 preflight', () => {
		const ag = activityGroup(true);
		const tail = md('结果如下…');
		const r = splitPreflightAndOutcome([ag, tail], { liveTurn: true });
		expect(r.preflight).toEqual([ag, tail]);
		expect(r.outcome).toEqual([]);
	});

	it('opts 完全省略：等同 liveTurn=false（按完成态切尾部 markdown）', () => {
		const t = think();
		const a = activity();
		const tail = md('done');
		const r = splitPreflightAndOutcome([t, a, tail]);
		expect(r.preflight).toEqual([t, a]);
		expect(r.outcome).toEqual([tail]);
	});

	it('强结果在最前面 + 完成态：preflight 空，全部 outcome —— 走纯文本兜底', () => {
		const fe = fileEdit();
		const m = md('done');
		const r = splitPreflightAndOutcome([fe, m], { liveTurn: false });
		expect(r.preflight).toEqual([]);
		expect(r.outcome).toEqual([fe, m]);
	});

	it('强结果在最前面 + 流式期间：cutoff 已切到强结果，preflight 空，outcome 全部', () => {
		const fe = fileEdit();
		const m = md('done');
		const r = splitPreflightAndOutcome([fe, m], { liveTurn: true });
		expect(r.preflight).toEqual([]);
		expect(r.outcome).toEqual([fe, m]);
	});

	it('单独的过程单元、无 markdown、无强结果：留 preflight', () => {
		const t = think();
		const a = activity('pending');
		const r = splitPreflightAndOutcome([t, a], { liveTurn: true });
		expect(r.preflight).toEqual([t, a]);
		expect(r.outcome).toEqual([]);
	});

	it('关键不变量：流式期间 preflight + outcome 拼接顺序 = 原 units', () => {
		const units = [think(), activity(), md('a'), md('b')];
		const r = splitPreflightAndOutcome(units, { liveTurn: true });
		expect([...r.preflight, ...r.outcome]).toEqual(units);
	});

	it('关键不变量：强结果切分时 preflight + outcome 顺序还原 = 原 units', () => {
		const units = [think(), md('mid'), fileEdit(), md('post')];
		const r = splitPreflightAndOutcome(units, { liveTurn: false });
		expect([...r.preflight, ...r.outcome]).toEqual(units);
	});

	it('liveTurn 切换：同一序列在 true → false 跳变时，trailing markdown 从 preflight 一次性切到 outcome', () => {
		const units = [think(), activity(), md('总结')];
		const live = splitPreflightAndOutcome(units, { liveTurn: true });
		expect(live.preflight).toEqual(units);
		expect(live.outcome).toEqual([]);
		const done = splitPreflightAndOutcome(units, { liveTurn: false });
		expect(done.preflight).toEqual([units[0], units[1]]);
		expect(done.outcome).toEqual([units[2]]);
	});

	describe('outcome_marker (begin_outcome 工具显式切分)', () => {
		it('marker 之前归 preflight，marker 自身及之后归 outcome', () => {
			const t = think();
			const a = activity();
			const mk = marker();
			const tail = md('总结开始');
			const r = splitPreflightAndOutcome([t, a, mk, tail], { liveTurn: true });
			expect(r.preflight).toEqual([t, a]);
			expect(r.outcome).toEqual([mk, tail]);
		});

		it('marker 优先级高于强结果：即便后面有 file_edit，也按 marker 位置切', () => {
			const t = think();
			const mk = marker();
			const fe = fileEdit();
			const r = splitPreflightAndOutcome([t, mk, fe], { liveTurn: true });
			expect(r.preflight).toEqual([t]);
			expect(r.outcome).toEqual([mk, fe]);
		});

		it('marker 优先级高于强结果：即便强结果在 marker 之前出现，也按 marker 位置切', () => {
			// 罕见场景：LLM 顺序混乱，marker 在 file_edit 之后才调用。仍以 marker 为准。
			const t = think();
			const fe = fileEdit();
			const mk = marker();
			const tail = md('总结');
			const r = splitPreflightAndOutcome([t, fe, mk, tail], { liveTurn: true });
			expect(r.preflight).toEqual([t, fe]);
			expect(r.outcome).toEqual([mk, tail]);
		});

		it('LLM 重复调用 begin_outcome：以首次出现为准，避免切分点回退', () => {
			const t = think();
			const mk1 = marker();
			const m1 = md('开始');
			const mk2 = marker();
			const m2 = md('继续');
			const r = splitPreflightAndOutcome([t, mk1, m1, mk2, m2], { liveTurn: true });
			expect(r.preflight).toEqual([t]);
			expect(r.outcome).toEqual([mk1, m1, mk2, m2]);
		});

		it('liveTurn 切换不影响 marker 切分（行为完全一致）', () => {
			const units = [think(), activity(), marker(), md('总结')];
			const live = splitPreflightAndOutcome(units, { liveTurn: true });
			const done = splitPreflightAndOutcome(units, { liveTurn: false });
			expect(live).toEqual(done);
			expect(live.preflight).toEqual([units[0], units[1]]);
			expect(live.outcome).toEqual([units[2], units[3]]);
		});

		it('marker 在 units 头部：preflight 空，outcome 全部', () => {
			const mk = marker();
			const tail = md('一上来就答复');
			const r = splitPreflightAndOutcome([mk, tail], { liveTurn: true });
			expect(r.preflight).toEqual([]);
			expect(r.outcome).toEqual([mk, tail]);
		});

		it('marker 后面没有任何内容：preflight 完整，outcome 仅 marker', () => {
			const t = think();
			const mk = marker();
			const r = splitPreflightAndOutcome([t, mk], { liveTurn: true });
			expect(r.preflight).toEqual([t]);
			expect(r.outcome).toEqual([mk]);
		});

		it('单向不变量：marker 之前的 unit 在多帧之间永远在 preflight，marker 之后永远在 outcome', () => {
			const t = think();
			const a = activity();
			const mk = marker();

			// 阶段 1：思考、工具
			const phase1 = splitPreflightAndOutcome([t, a], { liveTurn: true });
			expect(phase1.preflight).toEqual([t, a]);
			expect(phase1.outcome).toEqual([]);

			// 阶段 2：marker 出现
			const phase2 = splitPreflightAndOutcome([t, a, mk], { liveTurn: true });
			expect(phase2.preflight).toEqual([t, a]);
			expect(phase2.outcome).toEqual([mk]);

			// 阶段 3：marker 之后追加 markdown
			const m1 = md('总结');
			const phase3 = splitPreflightAndOutcome([t, a, mk, m1], { liveTurn: true });
			expect(phase3.preflight).toEqual([t, a]);
			expect(phase3.outcome).toEqual([mk, m1]);

			// 阶段 4：再追加 file_edit；marker 仍是切分点，t/a 不会被吸到 outcome
			const fe = fileEdit();
			const phase4 = splitPreflightAndOutcome([t, a, mk, m1, fe], { liveTurn: true });
			expect(phase4.preflight).toEqual([t, a]);
			expect(phase4.outcome).toEqual([mk, m1, fe]);
		});

		it('历史消息无 marker：完全退化到原逻辑（强结果切分 + 兜底）', () => {
			const t = think();
			const a = activity();
			const fe = fileEdit();
			const tail = md('完成');
			const r = splitPreflightAndOutcome([t, a, fe, tail], { liveTurn: false });
			expect(r.preflight).toEqual([t, a]);
			expect(r.outcome).toEqual([fe, tail]);
		});
	});
});
