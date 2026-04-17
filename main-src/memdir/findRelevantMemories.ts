import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { ShellSettings } from '../settingsStore.js';
import { resolveModelRequest } from '../llm/modelResolve.js';
import {
	applyAnthropicProviderIdentity,
	applyOpenAIProviderIdentity,
	buildAnthropicProviderIdentityMetadata,
	prependProviderIdentitySystemPrompt,
} from '../llm/providerIdentity.js';
import { formatMemoryManifest, scanMemoryFiles, type MemoryHeader } from './memoryScan.js';
import { getAutoMemPath } from './paths.js';
import type { ModelRequestParadigm, ThinkingLevel } from '../settingsStore.js';
import type { ProviderIdentitySettings } from '../../src/providerIdentitySettings.js';

export type RelevantMemory = {
	path: string;
	mtimeMs: number;
};

export type RuntimeMemoryModel = {
	requestModelId: string;
	paradigm: ModelRequestParadigm;
	requestApiKey: string;
	requestBaseURL?: string;
	requestProxyUrl?: string;
	thinkingLevel?: ThinkingLevel;
	providerIdentity?: ProviderIdentitySettings;
};

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new DOMException('Aborted', 'AbortError');
	}
}

const MAX_SELECTED = 5;
const MAX_MEMORY_LINES = 120;
const MAX_MEMORY_BYTES = 12_000;

const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memory files that will be useful to an agent handling the user's current request.

You will receive:
- the current query
- a list of available memory files with filenames, types, timestamps, and descriptions

Return JSON with this exact shape:
{"selected_memories":["file1.md","folder/file2.md"]}

Rules:
- Select at most 5 files.
- Only choose files that are clearly useful right now.
- Prefer precision over recall.
- If nothing looks clearly useful, return an empty array.
- Do not invent filenames that are not in the manifest.`;

function tokenize(text: string): string[] {
	return (text.toLowerCase().match(/[a-z0-9_./-]{3,}/g) ?? []).filter((s) => s.length >= 3);
}

export function selectRelevantMemoriesHeuristically(
	query: string,
	memories: MemoryHeader[],
	alreadySurfaced: ReadonlySet<string> = new Set()
): string[] {
	const queryTerms = new Set(tokenize(query));
	const scored = memories
		.filter((m) => !alreadySurfaced.has(m.filePath))
		.map((m) => {
			const hay = `${m.filename} ${m.description ?? ''}`.toLowerCase();
			let score = 0;
			for (const term of queryTerms) {
				if (hay.includes(term)) {
					score += term.length >= 8 ? 4 : 2;
				}
			}
			if (m.description && score > 0) {
				score += 1;
			}
			score += Math.max(0, 1 - (Date.now() - m.mtimeMs) / (1000 * 60 * 60 * 24 * 30)) * 0.5;
			return { filename: m.filename, score };
		})
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score || a.filename.localeCompare(b.filename))
		.slice(0, MAX_SELECTED);
	return scored.map((x) => x.filename);
}

function extractTextContent(raw: unknown): string {
	if (typeof raw === 'string') {
		return raw;
	}
	if (Array.isArray(raw)) {
		return raw
			.map((part) => {
				if (typeof part === 'string') {
					return part;
				}
				if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
					return (part as { text: string }).text;
				}
				return '';
			})
			.join('\n');
	}
	return '';
}

function parseSelectedFilenames(raw: string, validFilenames: Set<string>): string[] {
	const trimmed = raw.trim();
	if (!trimmed) {
		return [];
	}
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
	if (!parsed || typeof parsed !== 'object' || !('selected_memories' in parsed)) {
		return [];
	}
	const selected = (parsed as { selected_memories?: unknown }).selected_memories;
	if (!Array.isArray(selected)) {
		return [];
	}
	return selected.filter((x): x is string => typeof x === 'string' && validFilenames.has(x)).slice(0, MAX_SELECTED);
}

async function selectRelevantMemoriesWithRuntimeModel(
	runtime: RuntimeMemoryModel,
	query: string,
	memories: MemoryHeader[],
	signal?: AbortSignal
): Promise<string[]> {
	const manifest = formatMemoryManifest(memories);
	const userPrompt = `Query: ${query}\n\nAvailable memories:\n${manifest}`;
	const validFilenames = new Set(memories.map((m) => m.filename));

	try {
		throwIfAborted(signal);
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
				max_tokens: 256,
				messages: [
					{
						role: 'system',
						content: prependProviderIdentitySystemPrompt(
							identitySettings,
							SELECT_MEMORIES_SYSTEM_PROMPT
						),
					},
					{ role: 'user', content: userPrompt },
				],
			}, { signal });
			return parseSelectedFilenames(extractTextContent(resp.choices[0]?.message?.content ?? ''), validFilenames);
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
				system: prependProviderIdentitySystemPrompt(identitySettings, SELECT_MEMORIES_SYSTEM_PROMPT),
				max_tokens: 256,
				temperature: 0,
				...(anthropicMetadata ? { metadata: anthropicMetadata } : {}),
				messages: [{ role: 'user', content: userPrompt }],
			}, { signal });
			const text = resp.content
				.map((block) => (block.type === 'text' ? block.text : ''))
				.join('\n');
			return parseSelectedFilenames(text, validFilenames);
		}

		const genAI = new GoogleGenerativeAI(runtime.requestApiKey);
		const model = genAI.getGenerativeModel({
			model: runtime.requestModelId,
			systemInstruction: prependProviderIdentitySystemPrompt(
				{ providerIdentity: runtime.providerIdentity },
				SELECT_MEMORIES_SYSTEM_PROMPT
			),
			generationConfig: { temperature: 0, maxOutputTokens: 256 },
		});
		const resp = await model.generateContent(userPrompt, { signal });
		return parseSelectedFilenames(resp.response.text(), validFilenames);
	} catch {
		return [];
	}
}

async function selectRelevantMemoriesWithModel(
	settings: ShellSettings,
	modelSelection: string,
	query: string,
	memories: MemoryHeader[]
): Promise<string[]> {
	const resolved = resolveModelRequest(settings, modelSelection);
	if (!resolved.ok) {
		return [];
	}
	return selectRelevantMemoriesWithRuntimeModel(
		{
			requestModelId: resolved.requestModelId,
			paradigm: resolved.paradigm,
			requestApiKey: resolved.apiKey,
			requestBaseURL: resolved.baseURL,
			requestProxyUrl: resolved.proxyUrl,
		},
		query,
		memories
	);
}

export async function findRelevantMemoriesInDir(
	query: string,
	memoryDir: string,
	runtime: RuntimeMemoryModel | null,
	alreadySurfaced: ReadonlySet<string> = new Set(),
	signal?: AbortSignal
): Promise<RelevantMemory[]> {
	throwIfAborted(signal);
	const memories = (await scanMemoryFiles(memoryDir)).filter((m) => !alreadySurfaced.has(m.filePath));
	if (memories.length === 0) {
		return [];
	}
	const selectedByModel = runtime ? await selectRelevantMemoriesWithRuntimeModel(runtime, query, memories, signal) : [];
	const selectedFilenames =
		selectedByModel.length > 0
			? selectedByModel
			: selectRelevantMemoriesHeuristically(query, memories, alreadySurfaced);
	const byFilename = new Map(memories.map((m) => [m.filename, m]));
	return selectedFilenames
		.map((filename) => byFilename.get(filename))
		.filter((m): m is MemoryHeader => m !== undefined)
		.map((m) => ({ path: m.filePath, mtimeMs: m.mtimeMs }));
}

export async function findRelevantMemories(
	query: string,
	settings: ShellSettings,
	modelSelection: string,
	workspaceRoot?: string | null,
	alreadySurfaced: ReadonlySet<string> = new Set()
): Promise<RelevantMemory[]> {
	const memoryDir = getAutoMemPath(workspaceRoot);
	if (!memoryDir) {
		return [];
	}
	const resolved = resolveModelRequest(settings, modelSelection);
	const runtime = resolved.ok
		? {
				requestModelId: resolved.requestModelId,
				paradigm: resolved.paradigm,
				requestApiKey: resolved.apiKey,
				requestBaseURL: resolved.baseURL,
				requestProxyUrl: resolved.proxyUrl,
				providerIdentity: settings.providerIdentity,
			}
		: null;
	return findRelevantMemoriesInDir(query, memoryDir, runtime, alreadySurfaced);
}

async function readMemoryForContext(filePath: string, mtimeMs: number): Promise<{
	path: string;
	content: string;
	mtimeMs: number;
	header: string;
} | null> {
	try {
		const raw = await fs.readFile(filePath, 'utf8');
		const lines = raw.replace(/\r\n/g, '\n').split('\n').slice(0, MAX_MEMORY_LINES);
		let content = lines.join('\n');
		if (Buffer.byteLength(content, 'utf8') > MAX_MEMORY_BYTES) {
			let cut = content.length;
			while (cut > 0 && Buffer.byteLength(content.slice(0, cut), 'utf8') > MAX_MEMORY_BYTES) {
				cut--;
			}
			content = content.slice(0, cut) + '\n... (truncated)';
		}
		return {
			path: filePath,
			content,
			mtimeMs,
			header: path.basename(filePath),
		};
	} catch {
		return null;
	}
}

export async function buildRelevantMemoryContextBlock(params: {
	query: string;
	settings: ShellSettings;
	modelSelection: string;
	workspaceRoot?: string | null;
	alreadySurfaced?: ReadonlySet<string>;
	memoryDirOverride?: string;
	label?: string;
	signal?: AbortSignal;
}): Promise<string> {
	throwIfAborted(params.signal);
	const resolved = resolveModelRequest(params.settings, params.modelSelection);
	const runtime = resolved.ok
		? {
				requestModelId: resolved.requestModelId,
				paradigm: resolved.paradigm,
				requestApiKey: resolved.apiKey,
				requestBaseURL: resolved.baseURL,
				requestProxyUrl: resolved.proxyUrl,
				providerIdentity: params.settings.providerIdentity,
			}
		: null;
	const memoryDir = params.memoryDirOverride ?? getAutoMemPath(params.workspaceRoot);
	if (!memoryDir) {
		return '';
	}
	const selected = await findRelevantMemoriesInDir(
		params.query,
		memoryDir,
		runtime,
		params.alreadySurfaced ?? new Set(),
		params.signal
	);
	if (selected.length === 0) {
		return '';
	}
	throwIfAborted(params.signal);
	const read = await Promise.all(selected.map((m) => readMemoryForContext(m.path, m.mtimeMs)));
	const memories = read.filter((m): m is NonNullable<typeof m> => m !== null);
	if (memories.length === 0) {
		return '';
	}
	const body = memories
		.map((m, i) => {
			const rel = memoryDir ? path.relative(memoryDir, m.path).split(path.sep).join('/') : path.basename(m.path);
			const updated = new Date(m.mtimeMs).toISOString();
			return `### Memory ${i + 1}: ${rel} (updated ${updated})\n\`\`\`md\n${m.content}\n\`\`\``;
		})
		.join('\n\n');
	return `## ${params.label ?? 'Relevant memories'}\nThe following memory files were selected from persistent memory because they may help with this request.\n\n${body}`;
}
