import type {
	AgentAssistantPart,
	AgentAssistantPayload,
	AgentAssistantToolPart,
} from '../../src/agentStructuredMessage.js';
import type { AnthropicToolResultContent } from '../llm/anthropicBeta.js';
import { stringifyAgentAssistantPayload } from '../../src/agentStructuredMessage.js';

/**
 * Agent 单轮回复在内存中累积结构化 parts，onDone 时序列化为 JSON 落盘（与原先拼 XML 字符串等价的信息量）。
 */
export class StructuredAssistantBuilder {
	private parts: AgentAssistantPart[] = [];

	appendText(chunk: string): void {
		if (!chunk) return;
		const last = this.parts[this.parts.length - 1];
		if (last?.type === 'text') {
			last.text += chunk;
		} else {
			this.parts.push({ type: 'text', text: chunk });
		}
	}

	pushTool(
		toolUseId: string,
		name: string,
		args: Record<string, unknown>,
		result: string,
		success: boolean,
		resultStructured?: AnthropicToolResultContent,
		nest?: { subParent?: string; subDepth?: number }
	): void {
		const tool: AgentAssistantToolPart = {
			type: 'tool',
			toolUseId,
			name,
			args,
			result,
			...(resultStructured ? { resultStructured } : {}),
			success,
		};
		if (nest?.subParent != null) {
			tool.subParent = nest.subParent;
			tool.subDepth = nest.subDepth ?? 1;
		}
		this.parts.push(tool);
	}

	serialize(): string {
		const payload: AgentAssistantPayload = { _asyncAssistant: 1, v: 1, parts: this.parts };
		return stringifyAgentAssistantPayload(payload);
	}
}
