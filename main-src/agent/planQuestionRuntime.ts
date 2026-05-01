/**
 * 「问用户选择题」工具在主进程阻塞等待渲染进程 IPC 时使用的运行时上下文。
 * 由聊天运行时在可调用工具的会话前后注入/清理。
 */

export type PlanQuestionRuntime = {
	threadId: string;
	signal: AbortSignal;
	/** 已带 threadId 的 send，或在此处统一 merge */
	emit: (evt: Record<string, unknown>) => void;
};

let current: PlanQuestionRuntime | null = null;

export function setPlanQuestionRuntime(rt: PlanQuestionRuntime | null): void {
	current = rt;
}

export function getPlanQuestionRuntime(): PlanQuestionRuntime | null {
	return current;
}
