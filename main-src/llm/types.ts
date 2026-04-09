import type { ComposerMode } from './composerMode.js';
import type { ModelRequestParadigm, ThinkingLevel } from '../settingsStore.js';

/** 单回合 token 用量（各字段均为可选，网关不返回时省略）。 */
export type TurnTokenUsage = {
	inputTokens?: number;
	outputTokens?: number;
	/** Anthropic prompt caching：命中缓存读取的 token 数 */
	cacheReadTokens?: number;
	/** Anthropic prompt caching：写入缓存的 token 数 */
	cacheWriteTokens?: number;
};

export type StreamHandlers = {
	onDelta: (text: string) => void;
	onDone: (fullText: string, usage?: TurnTokenUsage) => void;
	onError: (message: string) => void;
	/** Anthropic extended thinking：不进入持久化 assistant 正文 */
	onThinkingDelta?: (text: string) => void;
};

export type UnifiedChatOptions = {
	mode: ComposerMode;
	signal: AbortSignal;
	requestModelId: string;
	paradigm: ModelRequestParadigm;
	/** 本条请求实际使用的密钥（已由 modelResolve 合并全局/独立端点） */
	requestApiKey: string;
	/** OpenAI 兼容 / Anthropic 可选；Gemini 忽略 */
	requestBaseURL?: string;
	/** OpenAI 兼容：提供商级 HTTP(S) 代理（无则回退读 settings.openAI.proxyUrl 以兼容旧配置） */
	requestProxyUrl?: string;
	/** 单次补全输出 token 上限（已钳制） */
	maxOutputTokens: number;
	/** 模型上下文窗口（tokens），来自设置或解析；用于 `modelContext` 压缩阈值 */
	contextWindowTokens?: number;
	/** 本回合注入系统提示（Rules / Skills / Subagents / 导入规则） */
	agentSystemAppend?: string;
	/** 扩展思考 / reasoning 强度，默认 off */
	thinkingLevel?: ThinkingLevel;
	/** 当前发起请求的窗口工作区根（用于 @ 路径展开） */
	workspaceRoot?: string | null;
};
