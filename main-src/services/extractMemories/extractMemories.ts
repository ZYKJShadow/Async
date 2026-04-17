import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { ModelRequestParadigm, ShellSettings } from '../../settingsStore.js';
import { resolveModelRequest } from '../../llm/modelResolve.js';
import {
	applyAnthropicProviderIdentity,
	applyOpenAIProviderIdentity,
	buildAnthropicProviderIdentityMetadata,
	prependProviderIdentitySystemPrompt,
} from '../../llm/providerIdentity.js';
import {
	getAgentToolCallsSinceMemoryBaseline,
	getMemoryExtractedMessageCount,
	getThread,
	saveMemoryExtractedMessageCount,
	saveMemoryExtractionToolBaseline,
	type ChatMessage,
} from '../../threadStore.js';
import { parseAgentAssistantPayload } from '../../../src/agentStructuredMessage.js';
import { ensureMemoryDirExists } from '../../memdir/memdir.js';
import { scanMemoryFiles, type MemoryHeader } from '../../memdir/memoryScan.js';
import { getAutoMemEntrypoint, getAutoMemPath } from '../../memdir/paths.js';
import { parseMemoryType, type MemoryType } from '../../memdir/memoryTypes.js';
import type { RuntimeMemoryModel } from '../../memdir/findRelevantMemories.js';

type ExtractedMemoryDraft = {
	filename: string;
	name: string;
	description: string;
	type: MemoryType;
	content: string;
};

type ExtractionResponse = {
	memories: ExtractedMemoryDraft[];
	forget: string[];
};

const MAX_SOURCE_MESSAGES = 12;
const MAX_SOURCE_CHARS = 16_000;
const inFlight = new Map<string, Promise<void>>();
const rerunRequested = new Set<string>();

/** 默认数量级设置（此处用消息/工具计数近似） */
const DEFAULT_MIN_NON_SYSTEM_BEFORE_FIRST = 4;
const DEFAULT_MIN_NON_SYSTEM_BETWEEN = 3;
const DEFAULT_MIN_TOOL_CALLS_BETWEEN = 3;

function lastAssistantMessageUsedTools(messages: ChatMessage[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role !== 'assistant') continue;
		const payload = parseAgentAssistantPayload(m.content);
		if (payload?.parts.some((p) => p.type === 'tool')) return true;
		if (m.content.includes('<tool_call')) return true;
		return false;
	}
	return false;
}

/**
 * 是否应排队后台记忆抽取（对齐 CC `shouldExtractMemory`：消息间隔 ∧ (工具次数 ∨ 末轮无工具)）。
 */
export function shouldRunMemoryExtractionForThread(threadId: string, settings: ShellSettings): boolean {
	const cfg = settings.agent?.memoryExtraction;
	if (cfg?.enabled === false) return false;
	const thread = getThread(threadId);
	if (!thread) return false;
	const nonSystem = thread.messages.filter((m) => m.role !== 'system');
	const startIdx = getMemoryExtractedMessageCount(threadId);
	const newMsgs = nonSystem.length - startIdx;
	if (newMsgs < 1) return false;

	const minFirst = cfg?.minNonSystemMessagesBeforeFirst ?? DEFAULT_MIN_NON_SYSTEM_BEFORE_FIRST;
	if (startIdx === 0 && nonSystem.length < minFirst) return false;

	const minMsg = cfg?.minNonSystemMessagesBetween ?? DEFAULT_MIN_NON_SYSTEM_BETWEEN;
	const minTools = cfg?.minToolCallsBetween ?? DEFAULT_MIN_TOOL_CALLS_BETWEEN;
	const toolsSince = getAgentToolCallsSinceMemoryBaseline(threadId);
	const noToolsLastTurn = !lastAssistantMessageUsedTools(thread.messages);

	return newMsgs >= minMsg && (toolsSince >= minTools || noToolsLastTurn);
}

const EXTRACTION_SYSTEM_PROMPT = `You are a background memory extraction subagent.

Your job is to look only at the provided recent conversation messages and decide what durable memories should be saved for future conversations.

Return strict JSON with this shape:
{
  "memories": [
    {
      "filename": "project/example.md",
      "name": "Short title",
      "description": "One-line summary",
      "type": "project",
      "content": "Markdown body without frontmatter"
    }
  ],
  "forget": ["old/file.md"]
}

Rules:
- Save only durable, reusable information.
- Prefer updating/overwriting existing memory topics over creating duplicates.
- Use only these types: user, feedback, project, reference.
- Do not save secrets, tokens, passwords, or ephemeral turn-specific details.
- "forget" should contain filenames only when the user explicitly asks to forget or remove a memory.
- Return at most 5 memories.
- If nothing should be saved, return {"memories":[],"forget":[]}.`;

function clipText(text: string, maxChars: number): string {
	return text.length > maxChars ? `${text.slice(0, maxChars)}\n...(truncated)` : text;
}

function buildRecentConversationBlock(messages: ChatMessage[], startIndex: number): string {
	const nonSystem = messages.filter((m) => m.role !== 'system');
	const slice = nonSystem.slice(startIndex).slice(-MAX_SOURCE_MESSAGES);
	return clipText(
		slice
			.map((m, i) => `### ${i + 1}. ${m.role}\n${m.content}`)
			.join('\n\n'),
		MAX_SOURCE_CHARS
	);
}

function parseJsonResponse(text: string): ExtractionResponse {
	const trimmed = text.trim();
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		const match = trimmed.match(/\{[\s\S]*\}/);
		if (match) {
			try {
				parsed = JSON.parse(match[0]);
			} catch {
				parsed = null;
			}
		}
	}
	const base: ExtractionResponse = { memories: [], forget: [] };
	if (!parsed || typeof parsed !== 'object') {
		return base;
	}
	const obj = parsed as { memories?: unknown; forget?: unknown };
	if (Array.isArray(obj.memories)) {
		base.memories = obj.memories
			.map((raw) => {
				if (!raw || typeof raw !== 'object') {
					return null;
				}
				const item = raw as Record<string, unknown>;
				const type = parseMemoryType(typeof item.type === 'string' ? item.type : undefined);
				const filename = sanitizeMemoryFilename(typeof item.filename === 'string' ? item.filename : '');
				const name = typeof item.name === 'string' ? item.name.trim() : '';
				const description = typeof item.description === 'string' ? item.description.trim() : '';
				const content = typeof item.content === 'string' ? item.content.trim() : '';
				if (!filename || !type || !name || !description || !content) {
					return null;
				}
				return { filename, name, description, type, content };
			})
			.filter((x): x is ExtractedMemoryDraft => x !== null)
			.slice(0, 5);
	}
	if (Array.isArray(obj.forget)) {
		base.forget = obj.forget
			.filter((x): x is string => typeof x === 'string')
			.map((x) => sanitizeMemoryFilename(x))
			.filter(Boolean);
	}
	return base;
}

function sanitizeMemoryFilename(raw: string): string {
	const normalized = raw.replace(/\\/g, '/').trim().replace(/^\/+/, '');
	if (!normalized) {
		return '';
	}
	const cleaned = normalized
		.split('/')
		.filter((seg) => seg && seg !== '.' && seg !== '..')
		.map((seg) => seg.replace(/[^a-zA-Z0-9._-]+/g, '-'))
		.join('/');
	if (!cleaned) {
		return '';
	}
	return cleaned.toLowerCase().endsWith('.md') ? cleaned : `${cleaned}.md`;
}

export function renderMemoryFile(draft: ExtractedMemoryDraft): string {
	return [
		'---',
		`name: ${draft.name}`,
		`description: ${draft.description}`,
		`type: ${draft.type}`,
		'---',
		'',
		draft.content.trim(),
		'',
	].join('\n');
}

function memoryIndexLine(header: MemoryHeader): string {
	const title = header.title?.trim() || path.basename(header.filename, '.md');
	const hook = header.description?.trim() || 'memory note';
	return `- [${title}](${header.filename.replace(/\\/g, '/')}) — ${hook}`;
}

export function buildMemoryEntrypoint(headers: MemoryHeader[]): string {
	return headers
		.slice()
		.sort((a, b) => {
			const ta = a.type ?? 'zzz';
			const tb = b.type ?? 'zzz';
			return ta.localeCompare(tb) || a.filename.localeCompare(b.filename);
		})
		.map(memoryIndexLine)
		.join('\n');
}

async function writeExtractionResult(params: {
	workspaceRootForEntrypoint?: string | null;
	entrypointPathOverride?: string;
	memoryDir: string;
	result: ExtractionResponse;
}): Promise<void> {
	const { workspaceRootForEntrypoint, entrypointPathOverride, memoryDir, result } = params;
	for (const rel of result.forget) {
		if (!rel) {
			continue;
		}
		const full = path.join(memoryDir, rel);
		try {
			await fs.rm(full, { force: true });
		} catch {
			/* ignore */
		}
	}
	for (const mem of result.memories) {
		const full = path.join(memoryDir, mem.filename);
		await fs.mkdir(path.dirname(full), { recursive: true });
		await fs.writeFile(full, renderMemoryFile(mem), 'utf8');
	}
	const entrypoint = entrypointPathOverride ?? getAutoMemEntrypoint(workspaceRootForEntrypoint);
	const rescanned = await scanMemoryFiles(memoryDir);
	const indexBody = buildMemoryEntrypoint(rescanned);
	if (entrypoint) {
		await fs.writeFile(entrypoint, indexBody, 'utf8');
	}
}

async function extractWithRuntimeModel(
	runtime: RuntimeMemoryModel,
	userPrompt: string
): Promise<ExtractionResponse | null> {
	try {
		if (runtime.paradigm === 'openai-compatible') {
			const proxyRaw = runtime.requestProxyUrl?.trim() ?? '';
			const httpAgent = proxyRaw ? new HttpsProxyAgent(proxyRaw) : undefined;
			const identitySettings: ShellSettings = { providerIdentity: runtime.providerIdentity };
			const client = new OpenAI(
				applyOpenAIProviderIdentity(identitySettings, {
					apiKey: runtime.requestApiKey,
					baseURL: runtime.requestBaseURL,
					httpAgent,
					dangerouslyAllowBrowser: false,
				})
			);
			const resp = await client.chat.completions.create({
				model: runtime.requestModelId,
				temperature: 0,
				max_tokens: 700,
				messages: [
					{
						role: 'system',
						content: prependProviderIdentitySystemPrompt(
							identitySettings,
							EXTRACTION_SYSTEM_PROMPT
						),
					},
					{ role: 'user', content: userPrompt },
				],
			});
			return parseJsonResponse(typeof resp.choices[0]?.message?.content === 'string' ? resp.choices[0]!.message!.content! : '');
		}
		if (runtime.paradigm === 'anthropic') {
			const identitySettings: ShellSettings = { providerIdentity: runtime.providerIdentity };
			const anthropicMetadata = buildAnthropicProviderIdentityMetadata(identitySettings);
			const client = new Anthropic(
				applyAnthropicProviderIdentity(identitySettings, {
					apiKey: runtime.requestApiKey,
					baseURL: runtime.requestBaseURL || undefined,
				})
			);
			const resp = await client.messages.create({
				model: runtime.requestModelId,
				system: prependProviderIdentitySystemPrompt(identitySettings, EXTRACTION_SYSTEM_PROMPT),
				max_tokens: 700,
				temperature: 0,
				...(anthropicMetadata ? { metadata: anthropicMetadata } : {}),
				messages: [{ role: 'user', content: userPrompt }],
			});
			const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
			return parseJsonResponse(text);
		}
		const genAI = new GoogleGenerativeAI(runtime.requestApiKey);
		const model = genAI.getGenerativeModel({
			model: runtime.requestModelId,
			systemInstruction: prependProviderIdentitySystemPrompt(
				{ providerIdentity: runtime.providerIdentity },
				EXTRACTION_SYSTEM_PROMPT
			),
			generationConfig: { temperature: 0, maxOutputTokens: 700 },
		});
		const resp = await model.generateContent(userPrompt);
		return parseJsonResponse(resp.response.text());
	} catch {
		return null;
	}
}

async function extractWithModel(
	settings: ShellSettings,
	modelSelection: string,
	userPrompt: string
): Promise<ExtractionResponse | null> {
	const resolved = resolveModelRequest(settings, modelSelection);
	if (!resolved.ok) {
		return null;
	}
	return extractWithRuntimeModel(
		{
			requestModelId: resolved.requestModelId,
			paradigm: resolved.paradigm,
			requestApiKey: resolved.apiKey,
			requestBaseURL: resolved.baseURL,
			requestProxyUrl: resolved.proxyUrl,
			providerIdentity: settings.providerIdentity,
		},
		userPrompt
	);
}

async function runExtractionOnce(threadId: string, workspaceRoot: string, settings: ShellSettings, modelSelection: string): Promise<void> {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	const memoryDir = await ensureMemoryDirExists(workspaceRoot);
	if (!memoryDir) {
		return;
	}
	const existing = await scanMemoryFiles(memoryDir);
	const startIndex = Math.min(getMemoryExtractedMessageCount(threadId), thread.messages.filter((m) => m.role !== 'system').length);
	const recentBlock = buildRecentConversationBlock(thread.messages, startIndex);
	if (!recentBlock.trim()) {
		return;
	}
	const existingManifest = existing.length > 0 ? existing.map((m) => `- ${m.filename}${m.description ? `: ${m.description}` : ''}`).join('\n') : '(none)';
	const userPrompt = `Existing memories:\n${existingManifest}\n\nRecent conversation messages:\n${recentBlock}`;
	const extracted = await extractWithModel(settings, modelSelection, userPrompt);
	if (extracted == null) {
		return;
	}
	if (extracted.memories.length === 0 && extracted.forget.length === 0) {
		saveMemoryExtractedMessageCount(threadId, thread.messages.filter((m) => m.role !== 'system').length);
		saveMemoryExtractionToolBaseline(threadId);
		return;
	}
	await writeExtractionResult({
		workspaceRootForEntrypoint: workspaceRoot,
		memoryDir,
		result: extracted,
	});
	saveMemoryExtractedMessageCount(threadId, thread.messages.filter((m) => m.role !== 'system').length);
	saveMemoryExtractionToolBaseline(threadId);
}

export function queueExtractMemories(params: {
	threadId: string;
	workspaceRoot: string | null;
	settings: ShellSettings;
	modelSelection: string;
}): void {
	const { threadId, workspaceRoot, settings, modelSelection } = params;
	if (!workspaceRoot) {
		return;
	}
	if (!shouldRunMemoryExtractionForThread(threadId, settings)) {
		return;
	}
	if (inFlight.has(threadId)) {
		rerunRequested.add(threadId);
		return;
	}
	const run = (async () => {
		try {
			await runExtractionOnce(threadId, workspaceRoot, settings, modelSelection);
		} finally {
			inFlight.delete(threadId);
			if (rerunRequested.has(threadId)) {
				rerunRequested.delete(threadId);
				queueExtractMemories(params);
			}
		}
	})();
	inFlight.set(threadId, run);
}

export async function extractMemoriesToDir(params: {
	memoryDir: string;
	messages: ChatMessage[];
	runtimeModel: RuntimeMemoryModel;
	workspaceRootForEntrypoint?: string | null;
}): Promise<void> {
	const recentBlock = buildRecentConversationBlock(params.messages, 0);
	if (!recentBlock.trim()) {
		return;
	}
	await fs.mkdir(params.memoryDir, { recursive: true });
	const existing = await scanMemoryFiles(params.memoryDir);
	const existingManifest = existing.length > 0 ? existing.map((m) => `- ${m.filename}${m.description ? `: ${m.description}` : ''}`).join('\n') : '(none)';
	const userPrompt = `Existing memories:\n${existingManifest}\n\nRecent conversation messages:\n${recentBlock}`;
	const extracted = await extractWithRuntimeModel(params.runtimeModel, userPrompt);
	if (!extracted || (extracted.memories.length === 0 && extracted.forget.length === 0)) {
		return;
	}
	await writeExtractionResult({
		workspaceRootForEntrypoint: params.workspaceRootForEntrypoint,
		entrypointPathOverride: path.join(params.memoryDir, 'MEMORY.md'),
		memoryDir: params.memoryDir,
		result: extracted,
	});
}
