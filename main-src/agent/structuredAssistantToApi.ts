/**
 * 将磁盘上的结构化助手 JSON 展开为 OpenAI / Anthropic API 的原生 tool 消息序列，
 * 使用块模型（assistant 含 tool_use，user 含 tool_result）。
 *
 * 若展开后以 `tool`（OpenAI）或仅含 tool_result 的 `user`（Anthropic）结尾，则整段回退为单条 assistant 字符串（legacy XML），
 * 避免违反「tool 后必须 assistant」等与线程存储「单条助手气泡含多轮工具」之间的张力。
 *
 * @see D:/WebstormProjects/claude-code/claude-code-2.1.88/src/utils/messages.ts ensureToolResultPairing
 */

import type OpenAI from 'openai';
import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type {
	AgentAssistantPart,
	AgentAssistantPayload,
	AgentAssistantToolPart,
} from '../../src/agentStructuredMessage.js';
import type { AnthropicToolResultBlock } from '../llm/anthropicBeta.js';
import { structuredToLegacyAgentXml } from '../../src/agentStructuredMessage.js';

export type OAIMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function expandOpenAINativeParts(parts: AgentAssistantPart[]): OAIMsg[] {
	const out: OAIMsg[] = [];
	let i = 0;
	while (i < parts.length) {
		let text = '';
		while (i < parts.length && parts[i]!.type === 'text') {
			text += (parts[i] as { type: 'text'; text: string }).text;
			i++;
		}
		const tools: AgentAssistantToolPart[] = [];
		while (i < parts.length && parts[i]!.type === 'tool') {
			tools.push(parts[i] as AgentAssistantToolPart);
			i++;
		}
		if (tools.length > 0) {
			out.push({
				role: 'assistant',
				content: text.trim() ? text : null,
				tool_calls: tools.map((t) => ({
					id: t.toolUseId,
					type: 'function' as const,
					function: { name: t.name, arguments: JSON.stringify(t.args) },
				})),
			});
			for (const t of tools) {
				out.push({ role: 'tool', tool_call_id: t.toolUseId, content: t.result });
			}
		} else if (text) {
			out.push({ role: 'assistant', content: text });
		}
	}
	return out;
}

/** 单条结构化助手 → 若干条 OpenAI 角色消息；无法安全收尾时回退 XML。 */
export function expandStructuredAssistantPayloadToOpenAI(p: AgentAssistantPayload): OAIMsg[] {
	const native = expandOpenAINativeParts(p.parts);
	if (native.length === 0) return [];
	const last = native[native.length - 1]!;
	if (last.role === 'tool') {
		return [{ role: 'assistant', content: structuredToLegacyAgentXml(p) }];
	}
	return native;
}

function expandAnthropicNativeParts(parts: AgentAssistantPart[]): MessageParam[] {
	const out: MessageParam[] = [];
	let i = 0;
	while (i < parts.length) {
		let text = '';
		while (i < parts.length && parts[i]!.type === 'text') {
			text += (parts[i] as { type: 'text'; text: string }).text;
			i++;
		}
		const tools: AgentAssistantToolPart[] = [];
		while (i < parts.length && parts[i]!.type === 'tool') {
			tools.push(parts[i] as AgentAssistantToolPart);
			i++;
		}
		if (tools.length > 0) {
			const blocks: ContentBlockParam[] = [];
			if (text.trim()) blocks.push({ type: 'text', text });
			for (const t of tools) {
				blocks.push({ type: 'tool_use', id: t.toolUseId, name: t.name, input: t.args });
			}
			out.push({ role: 'assistant', content: blocks });
			const toolResults: AnthropicToolResultBlock[] = tools.map((t) => ({
				type: 'tool_result',
				tool_use_id: t.toolUseId,
				content: t.resultStructured ?? t.result,
				is_error: !t.success,
			}));
			out.push({ role: 'user', content: toolResults as unknown as ContentBlockParam[] });
		} else if (text) {
			out.push({ role: 'assistant', content: text });
		}
	}
	return out;
}

/** 单条结构化助手 → 若干条 Anthropic MessageParam；收尾为 tool_result user 时回退 XML。 */
export function expandStructuredAssistantPayloadToAnthropic(p: AgentAssistantPayload): MessageParam[] {
	return expandAnthropicNativeParts(p.parts);
}
