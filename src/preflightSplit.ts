/**
 * 用户气泡正下方「过程区 (preflight) / assistant 气泡 (outcome)」的切分纯函数。
 *
 * 设计原则：流式期间 markdown 永不在 preflight ↔ outcome 之间迁移，避免任何文字位置抖动。
 *
 * 切分规则（按优先级）：
 *   1) 找到第一个「强结果」单元（file_edit / command / streaming_code 等）→ 它之前归 preflight，
 *      从它开始全部归 outcome（强结果在外面 assistant 气泡里始终可见，没有抖动风险）。
 *   2) 没有强结果时：
 *      - 回合已结束（!liveTurn）→ 把末尾连续 markdown 切到 outcome 当收尾总结；
 *      - 回合仍在进行（liveTurn）→ markdown 全部留在 preflight 跟随流式增长，待回合结束再切。
 *   3) 切分完后若 preflight 没有任何过程单元（纯文字回答）：
 *      - !liveTurn → 整体归 outcome，提示外层「不需要开壳」；
 *      - liveTurn → 暂留 preflight，等回合结束再决定（避免后续 process unit 出现时反向迁移）。
 *
 * 关键不变量：
 *   - 返回的 preflight + outcome 拼接顺序与输入 units 完全一致；
 *   - 流式期间（liveTurn=true）任意 unit 的归属在两次调用之间不会反转。
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
