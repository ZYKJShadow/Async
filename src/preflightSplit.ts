/**
 * 用户气泡正下方「过程区 (preflight) / assistant 气泡 (outcome)」的切分纯函数。
 *
 * 设计原则：流式期间 markdown 尽量不 preflight/outcome 间迁移以避免抖动；
 * 「用户澄清」外置为该原则的例外。
 *
 * 切分规则（按优先级）：
 *   0) 显式信号 `outcome_marker`（由 LLM 调用 begin_outcome 工具产生）→ 在该位置切分，
 *      marker 自身归 outcome（不可见，渲染层会跳过）。这是最可靠的切分点：模型自己决定。
 *      只取首次出现，确保切分点单调前进。
 *   1) 找到第一个「强结果」单元（file_edit / command / streaming_code 等）→ 它之前归 preflight，
 *      从它开始全部归 outcome（强结果在外面 assistant 气泡里始终可见，没有抖动风险）。
 *   2) **用户澄清**：一旦序列中出现 `purpose: user_clarification` 的工具活动（如 ask_plan_question /
 *      request_user_input），从该项起（连同紧挨其上的连续 markdown 题面）必须归 outcome，
 *      让用户在 assistant 正文区就看到澄清，而不被收起在壳内。
 *   3) 没有强结果时：
 *      - 回合已结束（!liveTurn）→ 把末尾连续 markdown 切到 outcome 当收尾总结；
 *      - 回合仍在进行（liveTurn）→ markdown 全部留在 preflight 跟随流式增长，待回合结束再切。
 *   4) 切分完后若 preflight 没有任何过程单元（纯文字回答）：
 *      - !liveTurn → 整体归 outcome，提示外层「不需要开壳」；
 *      - liveTurn → 暂留 preflight，等回合结束再决定（避免后续 process unit 出现时反向迁移）。
 *
 * 关键不变量：
 *   - 返回的 preflight + outcome 拼接顺序与输入 units 完全一致；
 *   - 流式期间任意 unit 的归属在两次调用之间不会反转（**例外**：用户澄清出现时，澄清及之后
 *     的 markdown 会外置到 outcome，避免被壳遮挡；这是刻意破坏「尾 markdown 永留壳内」以换可见性）。
 *     - 有 outcome_marker 时：marker 之前的内容永远在 preflight，marker 之后永远在 outcome。
 *     - 无 outcome_marker 时：退化到「强结果切分 + 尾 markdown / 澄清」组合的兜底逻辑。
 */
import type { AssistantSegment } from './agentChatSegments';

type ThinkingSegment = Extract<AssistantSegment, { type: 'thinking' }>;
export type RenderUnit =
	| Exclude<AssistantSegment, { type: 'thinking' }>
	| { type: 'thinking_group'; chunks: ThinkingSegment[] };

/** 「强结果」单元 —— 出现就作为切分点，把后面整段交给 outcome 渲染。 */
export function isStrongOutcomeUnit(u: RenderUnit): boolean {
	switch (u.type) {
		case 'file_edit':
		case 'diff':
		case 'command':
		case 'streaming_code':
		case 'file_changes':
		case 'plan_todo':
		case 'sub_agent_markdown':
			return true;
		default:
			return false;
	}
}

/** 用户需在 UI 中作答的澄清类展示（否则会留在可收起的壳里，易被忽略）。 */
export function isUserFacingClarificationUnit(u: RenderUnit): boolean {
	if (u.type === 'activity') {
		return u.purpose === 'user_clarification';
	}
	if (u.type === 'activity_group') {
		return u.items.some((item) => item.purpose === 'user_clarification');
	}
	return false;
}

/**
 * outcome 的起点：首个澄清单元，并把紧邻其上方、与该澄清直接相关的连续 markdown 一并并入 outcome，
 * 避免「收尾说明文在 assistant 气泡、澄清却仍留在收起壳」的割裂。
 */
function userClarificationOutcomeStart(units: RenderUnit[]): number | null {
	let idx: number | null = null;
	for (let i = 0; i < units.length; i++) {
		if (isUserFacingClarificationUnit(units[i]!)) {
			idx = i;
			break;
		}
	}
	if (idx == null) {
		return null;
	}
	let start = idx;
	while (start > 0 && units[start - 1]!.type === 'markdown') {
		start--;
	}
	return start;
}

/** 真正的过程性 unit（思考 / 搜索 / 读取 / Explored 分组）—— 决定是否值得开壳的关键 */
export function isProcessUnit(u: RenderUnit): boolean {
	return (
		u.type === 'thinking_group' || u.type === 'activity' || u.type === 'activity_group'
	);
}

export function splitPreflightAndOutcome(
	units: RenderUnit[],
	opts?: { liveTurn?: boolean }
): {
	preflight: RenderUnit[];
	outcome: RenderUnit[];
} {
	// 优先：LLM 显式调用 begin_outcome 产生的不可见 marker。首次出现即切分点。
	for (let i = 0; i < units.length; i++) {
		if (units[i]!.type === 'outcome_marker') {
			return {
				preflight: units.slice(0, i),
				outcome: units.slice(i),
			};
		}
	}

	let cutoff = units.length;
	for (let i = 0; i < units.length; i++) {
		if (isStrongOutcomeUnit(units[i]!)) {
			cutoff = i;
			break;
		}
	}
	if (cutoff === units.length && !opts?.liveTurn) {
		let k = units.length;
		while (k > 0 && units[k - 1]!.type === 'markdown') k--;
		if (k < units.length && k > 0) {
			cutoff = k;
		}
	}

	const clarifyStart = userClarificationOutcomeStart(units);
	if (clarifyStart != null) {
		cutoff = Math.min(cutoff, clarifyStart);
	}

	const preflight = units.slice(0, cutoff);
	const outcome = units.slice(cutoff);
	if (!opts?.liveTurn && !preflight.some(isProcessUnit)) {
		return { preflight: [], outcome: [...preflight, ...outcome] };
	}
	return { preflight, outcome };
}

/** preflight 段是否有渲染价值（避免空壳） */
export function preflightHasContent(units: RenderUnit[]): boolean {
	for (const u of units) {
		if (u.type === 'thinking_group' || u.type === 'activity' || u.type === 'activity_group') {
			return true;
		}
		if (u.type === 'markdown' && u.text.trim().length > 0) {
			return true;
		}
	}
	return false;
}
