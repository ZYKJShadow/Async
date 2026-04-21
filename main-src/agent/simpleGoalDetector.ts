/**
 * 简单目标检测 —— 从 open-multi-agent 移植。
 *
 * 当用户请求明显是单轮、单动作、不需要多专家协作时，
 * 直接让 Team Lead 快速回答，跳过完整的 Planning LLM Call。
 */

/**
 * 指示需要多 Agent 协调的复杂度信号正则列表。
 */
const COMPLEXITY_PATTERNS: RegExp[] = [
	// 显式顺序
	/\bfirst\b.{3,60}\bthen\b/i,
	/\bstep\s*\d/i,
	/\bphase\s*\d/i,
	/\bstage\s*\d/i,
	/^\s*\d+[\.\)]/m,
	// CJK 顺序
	/先.{1,30}再/,
	/第[一二三四五六七八九十\d]步/,

	// 协调语言（必须是祈使指令）
	/\bcollaborat(?:e|ing)\b\s+(?:with|on|to)\b/i,
	/\bcoordinat(?:e|ing)\b\s+(?:with|on|across|between|the\s+(?:team|agents?|workers?|effort|work))\b/i,
	/\breview\s+each\s+other/i,
	/\bwork\s+together\b/i,
	// CJK 协调
	/一起.{0,10}(?:协作|合作|完成|做)/,
	/协作.{0,10}(?:完成|做)/,

	// 并行执行
	/\bin\s+parallel\b/i,
	/\bconcurrently\b/i,
	/\bat\s+the\s+same\s+time\b/i,
	// CJK 并行
	/同时.{0,10}(?:做|进行|执行|完成)/,
	/并行.{0,10}(?:做|进行|执行|完成)/,

	// 多个交付物连词
	/\b(?:build|create|implement|design|write|develop)\b.{5,80}\b(?:and|then)\b.{5,80}\b(?:build|create|implement|design|write|develop|test|review|deploy)\b/i,
	// 更宽松的多个动作（允许短间隔如 "design and implement"）
	/\b(?:build|create|implement|design|write|develop)\b.{0,30}\b(?:and|then)\b.{0,30}\b(?:build|create|implement|design|write|develop|test|review|deploy)\b/i,
];

const SIMPLE_GOAL_MAX_LENGTH = 200;

/**
 * 判断目标是否简单到可以跳过 Coordinator 分解。
 *
 * 简单目标需同时满足：
 * 1. 长度 ≤ 200 字符
 * 2. 不匹配任何复杂度模式
 */
export function isSimpleGoal(goal: string): boolean {
	if (goal.length > SIMPLE_GOAL_MAX_LENGTH) return false;
	return !COMPLEXITY_PATTERNS.some((re) => re.test(goal));
}
