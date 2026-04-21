/**
 * Agent 助手消息的结构化持久化格式，磁盘存 JSON；发 API 时再展开为原有 XML 协议。
 */

import type { AnthropicToolResultContent } from '../main-src/llm/anthropicBeta.js';

export type AgentAssistantTextPart = { type: 'text'; text: string };

export type AgentAssistantToolPart = {
	type: 'tool';
	toolUseId: string;
	name: string;
	args: Record<string, unknown>;
	result: string;
	resultStructured?: AnthropicToolResultContent;
	success: boolean;
	subParent?: string;
	subDepth?: number;
};

export type AgentAssistantPart = AgentAssistantTextPart | AgentAssistantToolPart;

export type AgentAssistantPayload = {
	_asyncAssistant: 1;
	v: 1;
	parts: AgentAssistantPart[];
};

function escapeToolResultForMarker(raw: string): string {
	return raw.split('</tool_result>').join('</tool\u200c_result>');
}

function isValidStructuredToolResultContent(value: unknown): value is AnthropicToolResultContent {
	if (typeof value === 'string') {
		return true;
	}
	if (!Array.isArray(value)) {
		return false;
	}
	for (const item of value) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			return false;
		}
		const block = item as Record<string, unknown>;
		if (block.type === 'text') {
			if (typeof block.text !== 'string') return false;
			continue;
		}
		if (block.type === 'tool_reference') {
			if (typeof block.tool_name !== 'string') return false;
			continue;
		}
		if (block.type === 'image') {
			if (!block.source || typeof block.source !== 'object') return false;
			continue;
		}
		return false;
	}
	return true;
}

/** 与 agentLoop / App 写入 tool_result 标记时一致 */
export function toolResultMarkerLegacy(name: string, result: string, success: boolean): string {
	const truncated = result.length > 3000 ? result.slice(0, 3000) + '\n... (truncated)' : result;
	const safe = escapeToolResultForMarker(truncated);
	return `<tool_result tool="${name}" success="${success}">${safe}</tool_result>\n`;
}

export function toolCallMarkerLegacy(
	name: string,
	args: Record<string, unknown>,
	nest?: { subParent?: string; subDepth?: number }
): string {
	const safeArgs = JSON.stringify(args);
	const n =
		nest?.subParent != null
			? ` sub_parent="${String(nest.subParent).replace(/"/g, '&quot;')}" sub_depth="${nest.subDepth ?? 1}"`
			: '';
	return `\n<tool_call tool="${name}"${n}>${safeArgs}</tool_call>\n`;
}

export function isStructuredAssistantMessage(raw: string): boolean {
	const s = raw.trimStart();
	return s.startsWith('{') && s.includes('"_asyncAssistant":1');
}

export function parseAgentAssistantPayload(raw: string): AgentAssistantPayload | null {
	try {
		const d = JSON.parse(raw) as unknown;
		if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
		const o = d as Record<string, unknown>;
		if (o._asyncAssistant !== 1 || o.v !== 1 || !Array.isArray(o.parts)) return null;
		for (const p of o.parts as unknown[]) {
			if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
			const pt = p as Record<string, unknown>;
			if (pt.type === 'text') {
				if (typeof pt.text !== 'string') return null;
			} else if (pt.type === 'tool') {
				if (typeof pt.toolUseId !== 'string' || typeof pt.name !== 'string') return null;
				if (!pt.args || typeof pt.args !== 'object' || Array.isArray(pt.args)) return null;
				if (typeof pt.result !== 'string' || typeof pt.success !== 'boolean') return null;
				if (pt.resultStructured !== undefined && !isValidStructuredToolResultContent(pt.resultStructured)) {
					return null;
				}
				if (pt.subParent !== undefined && typeof pt.subParent !== 'string') return null;
				if (pt.subDepth !== undefined && typeof pt.subDepth !== 'number') return null;
			} else {
				return null;
			}
		}
		return d as AgentAssistantPayload;
	} catch {
		return null;
	}
}

export function stringifyAgentAssistantPayload(payload: AgentAssistantPayload): string {
	return JSON.stringify(payload);
}

/** 供发 LLM 的历史与旧逻辑使用：与原先 assistant.content 内嵌 XML 等价 */
export function structuredToLegacyAgentXml(payload: AgentAssistantPayload): string {
	let out = '';
	for (const p of payload.parts) {
		if (p.type === 'text') {
			out += p.text;
		} else {
			out += toolCallMarkerLegacy(p.name, p.args, {
				subParent: p.subParent,
				subDepth: p.subDepth,
			});
			out += toolResultMarkerLegacy(p.name, p.result, p.success);
		}
	}
	return out;
}

/** 侧栏摘要 / diff 扫描：拼接所有文本块（忽略工具块内原文，diff 只在 markdown 文本里） */
export function flattenAssistantTextPartsForSearch(raw: string): string {
	const p = parseAgentAssistantPayload(raw);
	if (!p) return raw;
	return p.parts
		.filter((x): x is AgentAssistantTextPart => x.type === 'text')
		.map((x) => x.text)
		.join('');
}

/**
 * 将结构化 assistant payload 规范化为适合直接展示的纯文本。
 * 若消息本身就是结构化 JSON 但没有文本块，则返回 fallback，避免把传输层 JSON 暴露给 UI。
 */
export function extractAssistantTextForDisplay(raw: string, fallback = ''): string {
	const flattened = flattenAssistantTextPartsForSearch(raw)
		.replace(/\n[ \t]+\n/g, '\n\n')
		.trim();
	if (flattened) {
		return flattened;
	}
	if (isStructuredAssistantMessage(raw)) {
		return fallback;
	}
	const trimmed = String(raw ?? '')
		.replace(/\n[ \t]+\n/g, '\n\n')
		.trim();
	return trimmed || fallback;
}

/**
 * 压缩副本：截断各 tool 的 result（与 conversationCompress 对 XML 的预算一致）
 */
export function budgetStructuredAssistantToolResults(
	raw: string,
	maxChars: number
): string {
	const p = parseAgentAssistantPayload(raw);
	if (!p) return raw;
	let changed = false;
	const nextParts = p.parts.map((part) => {
		if (part.type !== 'tool') return part;
		if (part.result.length <= maxChars) return part;
		changed = true;
		return {
			...part,
			result:
				part.result.slice(0, maxChars) + '\n... (truncated for context budget)',
		};
	});
	if (!changed) return raw;
	return stringifyAgentAssistantPayload({ ...p, parts: nextParts });
}

/**
 * 将内嵌 XML 协议压成摘要友好的一行式工具描述，避免把原始 XML 直接喂给摘要模型。
 */
function formatLegacyAssistantXmlForSummary(content: string, maxChars: number, toolSnip: number): string {
	let s = content.replace(
		/<tool_result\s+tool="([^"]+)"\s+success="([^"]+)">([\s\S]*?)<\/tool\u200c?_result>/gi,
		(_m, name, succ, body) => {
			const flat = String(body).replace(/\s+/g, ' ').trim();
			const sn = flat.length > toolSnip ? `${flat.slice(0, toolSnip)}…` : flat;
			return `\n[tool ${name} succ=${succ}] ${sn}`;
		}
	);
	s = s.replace(/<tool_call\s+tool="([^"]+)"[^>]*>[\s\S]*?<\/tool_call>/gi, '\n[call $1]');
	return s.trim().slice(0, maxChars);
}

/**
 * 供 conversationCompress / 摘要生成使用：结构化助手展开为可读行，XML 协议助手做工具行折叠。
 * 这里保留“说了什么、调用了哪些工具”，而不是原始传输格式。
 */
export function formatChatMessageForCompactionSummary(
	role: string,
	content: string,
	opts?: { maxChars?: number; toolSnip?: number }
): string {
	const maxChars = opts?.maxChars ?? 4000;
	const toolSnip = opts?.toolSnip ?? 900;
	const head = `[${role.toUpperCase()}]`;
	if (role === 'assistant' && isStructuredAssistantMessage(content)) {
		const p = parseAgentAssistantPayload(content);
		if (!p) return `${head}: ${content}`.slice(0, maxChars);
		const lines: string[] = [];
		let budget = maxChars;
		for (const part of p.parts) {
			if (budget <= 0) break;
			if (part.type === 'text') {
				const t = part.text.trim();
				if (!t) continue;
				const slice = t.length > budget ? `${t.slice(0, budget)}…` : t;
				lines.push(slice);
				budget -= slice.length + 1;
			} else {
				const st = part.success ? 'ok' : 'fail';
				const flat = part.result.replace(/\s+/g, ' ').trim();
				const body = flat.length > toolSnip ? `${flat.slice(0, toolSnip)}…` : flat;
				const line = `[tool ${part.name} ${st}] ${body}`;
				lines.push(line);
				budget -= line.length + 1;
			}
		}
		return `${head}:\n${lines.join('\n')}`.slice(0, maxChars);
	}
	if (
		role === 'assistant' &&
		(content.includes('<tool_call') || content.includes('<tool_result'))
	) {
		const inner = formatLegacyAssistantXmlForSummary(
			content,
			Math.max(200, maxChars - head.length - 4),
			toolSnip
		);
		return `${head}:\n${inner}`.slice(0, maxChars);
	}
	return `${head}: ${content}`.slice(0, maxChars);
}

/**
 * 去除重复的 tool 块（同一 toolUseId 仅保留首次出现），避免跨消息重复 tool_use id。
 */
export function dedupeStructuredAssistantToolUseIds(raw: string): string {
	const p = parseAgentAssistantPayload(raw);
	if (!p) return raw;
	const seen = new Set<string>();
	const parts = p.parts.filter((part) => {
		if (part.type === 'text') return true;
		if (seen.has(part.toolUseId)) return false;
		seen.add(part.toolUseId);
		return true;
	});
	if (parts.length === p.parts.length) return raw;
	return stringifyAgentAssistantPayload({ ...p, parts });
}

/** 在结构化助手末尾追加文本（与 appendToLastAssistant 一致） */
export function appendSuffixToStructuredAssistant(raw: string, suffix: string): string {
	if (!suffix) return raw;
	const p = parseAgentAssistantPayload(raw);
	if (!p) return raw + suffix;
	const parts = [...p.parts];
	const last = parts[parts.length - 1];
	if (last?.type === 'text') {
		parts[parts.length - 1] = { type: 'text', text: last.text + suffix };
	} else {
		parts.push({ type: 'text', text: suffix });
	}
	return stringifyAgentAssistantPayload({ ...p, parts });
}

/**
 * 去掉 run_async_task 结果开头的元数据行（workspace=, mode=, model=）。
 * botRuntime 在 run_async_task handler 里会拼上这几行前缀。
 */
function stripBotTaskResultMetadata(result: string): string {
	const lines = result.split('\n');
	let i = 0;
	while (i < lines.length && /^(workspace|mode|model)=/.test(lines[i])) {
		i++;
	}
	// 跳过紧跟的空行
	if (i < lines.length && lines[i].trim() === '') {
		i++;
	}
	return i > 0 ? lines.slice(i).join('\n') : result;
}

function summarizeBotToolOnlyReply(parts: AgentAssistantPart[]): string {
	const toolParts = parts.filter((part): part is AgentAssistantToolPart => part.type === 'tool');
	if (toolParts.length === 0) {
		return '';
	}
	return toolParts
		.map((part) => {
			const ok = part.success === true;
			switch (part.name) {
				case 'get_async_session':
					return ok ? '已读取当前 Async 会话信息。' : '读取当前 Async 会话信息失败。';
				case 'switch_workspace':
					return ok ? part.result.trim() || '已切换工作区。' : `切换工作区失败：${part.result.trim()}`;
				case 'switch_model':
					return ok ? part.result.trim() || '已切换模型。' : `切换模型失败：${part.result.trim()}`;
				case 'new_async_thread':
					return ok ? part.result.trim() || '已创建新的内部线程。' : `创建内部线程失败：${part.result.trim()}`;
				case 'send_local_attachment':
					return ok ? part.result.trim() || '已发送附件给用户。' : `发送附件失败：${part.result.trim()}`;
				case 'pause_for_qr_login':
					return ok ? '已发送二维码登录截图，正在等待用户扫码。' : `二维码登录等待失败：${part.result.trim()}`;
				case 'Browser': {
					const action = String(part.args.action ?? '').trim();
					return ok
						? action
							? `已执行浏览器操作：${action}。`
							: '已执行浏览器操作。'
						: action
							? `浏览器操作失败：${action}。`
							: '浏览器操作失败。';
				}
				case 'BrowserCapture': {
					const action = String(part.args.action ?? '').trim();
					return ok
						? action
							? `已执行浏览器抓包操作：${action}。`
							: '已执行浏览器抓包操作。'
						: action
							? `浏览器抓包操作失败：${action}。`
							: '浏览器抓包操作失败。';
				}
				default:
					return ok ? `已执行工具：${part.name}。` : `工具执行失败：${part.name}。`;
			}
		})
		.join('\n')
		.trim();
}

/**
 * 从机器人 orchestrator 返回的结构化 JSON 中提取对外展示的纯文本/markdown。
 *
 * 处理两层嵌套：
 *  - 外层：orchestrator 自身的 structured payload（含桥接文本 + run_async_task tool 调用）
 *  - 内层：run_async_task 的 result 里可能还嵌了一层 structured payload
 *
 * 优先取内层（真正的任务结果），没有时回退到外层文本。
 */
export function extractBotReplyText(raw: string): string {
	if (!isStructuredAssistantMessage(raw)) {
		return raw;
	}
	const payload = parseAgentAssistantPayload(raw);
	if (!payload) {
		return raw;
	}

	const outerTexts: string[] = [];
	const innerTaskTexts: string[] = [];

	for (const part of payload.parts) {
		if (part.type === 'text') {
			const t = part.text.trim();
			if (t) outerTexts.push(part.text);
		} else if (part.type === 'tool' && part.name === 'run_async_task') {
			const stripped = stripBotTaskResultMetadata(part.result);
			if (isStructuredAssistantMessage(stripped)) {
				const inner = flattenAssistantTextPartsForSearch(stripped).trim();
				if (inner) innerTaskTexts.push(inner);
			} else {
				const t = stripped.trim();
				if (t) innerTaskTexts.push(t);
			}
		}
	}

	const combined = innerTaskTexts.join('\n\n').trim();
	if (combined) return combined;

	const outerText = outerTexts.join('').trim();
	if (outerText) return outerText;

	const toolOnlySummary = summarizeBotToolOnlyReply(payload.parts);
	if (toolOnlySummary) {
		return toolOnlySummary;
	}

	return '';
}

function collectBotScreenshotPathsFromPayload(payload: AgentAssistantPayload, out: string[]): void {
	for (const part of payload.parts) {
		if (part.type !== 'tool') {
			continue;
		}
		if (part.name === 'Browser' && part.success === true) {
			const action = String(part.args.action ?? '').trim();
			if (action === 'screenshot_page') {
				try {
					const parsed = JSON.parse(part.result) as { path?: string };
					const fullPath = String(parsed.path ?? '').trim();
					if (fullPath) {
						out.push(fullPath);
					}
				} catch {
					/* ignore */
				}
			}
		}
		if (part.name === 'run_async_task') {
			const stripped = stripBotTaskResultMetadata(part.result);
			if (isStructuredAssistantMessage(stripped)) {
				const inner = parseAgentAssistantPayload(stripped);
				if (inner) {
					collectBotScreenshotPathsFromPayload(inner, out);
				}
			}
		}
	}
}

export function extractBotReplyImagePaths(raw: string): string[] {
	if (!isStructuredAssistantMessage(raw)) {
		return [];
	}
	const payload = parseAgentAssistantPayload(raw);
	if (!payload) {
		return [];
	}
	const out: string[] = [];
	collectBotScreenshotPathsFromPayload(payload, out);
	return [...new Set(out)];
}
