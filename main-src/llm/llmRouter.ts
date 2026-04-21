import type { ChatMessage } from '../threadStore.js';
import type { ShellSettings } from '../settingsStore.js';
import { streamAnthropic } from './anthropicAdapter.js';
import { streamGemini } from './geminiAdapter.js';
import { streamOpenAICompatible } from './openaiAdapter.js';
import type { StreamHandlers, UnifiedChatOptions } from './types.js';
import { modeExpandsWorkspaceFileContext } from './workspaceContextExpand.js';
import { resolveMessagesForSend, type SendableMessage } from './sendResolved.js';

/**
 * Agent 模式的多轮工具循环已由 agent/agentLoop.ts 实现。
 * 此文件仅处理非 Agent 模式（Ask / Plan / Debug）的简单流式补全。
 * 当消息带 `parts` 时走结构化解析；文本文件引用保留为路径提示，由模型自行决定是否使用工具读取。
 */

export async function streamChatUnified(
	settings: ShellSettings,
	messages: ChatMessage[],
	options: UnifiedChatOptions,
	handlers: StreamHandlers
): Promise<void> {
	const forModel: SendableMessage[] = modeExpandsWorkspaceFileContext(options.mode)
		? await resolveMessagesForSend(messages, options.workspaceRoot ?? null)
		: messages.map((m) => ({ ...m }));
	switch (options.paradigm) {
		case 'anthropic':
			await streamAnthropic(settings, forModel, options, handlers);
			return;
		case 'gemini':
			await streamGemini(settings, forModel, options, handlers);
			return;
		case 'openai-compatible':
		default:
			await streamOpenAICompatible(settings, forModel, options, handlers);
	}
}
