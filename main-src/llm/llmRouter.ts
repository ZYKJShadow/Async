import type { ChatMessage } from '../threadStore.js';
import type { ShellSettings } from '../settingsStore.js';
import { streamAnthropic } from './anthropicAdapter.js';
import { streamGemini } from './geminiAdapter.js';
import { streamOpenAICompatible } from './openaiAdapter.js';
import type { StreamHandlers, UnifiedChatOptions } from './types.js';
import { cloneMessagesWithExpandedLastUser, modeExpandsWorkspaceFileContext } from './workspaceContextExpand.js';

/**
 * Agent 模式的多轮工具循环已由 agent/agentLoop.ts 实现。
 * 此文件仅处理非 Agent 模式（Ask / Plan / Debug）的简单流式补全；Ask 与 Plan/Debug 一样会展开 @ 文件引用。
 * Gemini paradigm 的 Agent 模式暂回退到此处（无工具循环）。
 */

export async function streamChatUnified(
	settings: ShellSettings,
	messages: ChatMessage[],
	options: UnifiedChatOptions,
	handlers: StreamHandlers
): Promise<void> {
	const forModel =
		modeExpandsWorkspaceFileContext(options.mode) ? cloneMessagesWithExpandedLastUser(messages) : messages;
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
