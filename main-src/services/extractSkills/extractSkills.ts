import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { ShellSettings } from '../../settingsStore.js';
import { resolveModelRequest } from '../../llm/modelResolve.js';
import {
	applyAnthropicProviderIdentity,
	applyOpenAIProviderIdentity,
	buildAnthropicProviderIdentityMetadata,
	prependProviderIdentitySystemPrompt,
} from '../../llm/providerIdentity.js';
import {
	openAICompatibleEffectiveTemperature,
	resolveRequestedTemperature,
} from '../../llm/thinkingLevel.js';
import {
	getAgentToolCallsSinceSkillBaseline,
	getThread,
	saveSkillExtractionToolBaseline,
	type ChatMessage,
} from '../../threadStore.js';
import type { RuntimeMemoryModel } from '../../memdir/findRelevantMemories.js';
function getSkillDir(workspaceRoot: string): string {
	return path.join(workspaceRoot, '.async', 'skills');
}

function getSkillFilePath(workspaceRoot: string, slug: string): string {
	return path.join(workspaceRoot, '.async', 'skills', slug, 'SKILL.md');
}

/** 快速读取 SKILL.md frontmatter，检查是否 auto_created */
async function isAutoCreatedSkill(skillPath: string): Promise<boolean> {
	try {
		const raw = await fs.readFile(skillPath, 'utf8');
		const head = raw.split('---')[1] ?? '';
		return /auto_created:\s*true/.test(head);
	} catch {
		return false;
	}
}

export type ExtractedSkillDraft = {
	slug: string;
	name: string;
	description: string;
	triggers: string[];
	steps: string[];
	tools: string[];
	pitfalls: string[];
	verification: string[];
};

type SkillExtractionResponse = {
	should_create: boolean;
	skill?: ExtractedSkillDraft;
};

const MAX_SOURCE_MESSAGES = 12;
const MAX_SOURCE_CHARS = 16_000;
const inFlight = new Map<string, Promise<void>>();
const rerunRequested = new Set<string>();

/** 触发 Skill 抽取所需的最少工具调用数（对齐 Hermes Agent） */
const DEFAULT_MIN_TOOL_CALLS_FOR_SKILL = 5;
const DEFAULT_MAX_AUTO_SKILLS = 50;

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

/**
 * 是否应排队后台 Skill 抽取。
 * 触发条件：自上次 Skill 抽取以来，工具调用数 ≥ 阈值。
 */
export function shouldRunSkillExtractionForThread(threadId: string, settings: ShellSettings): boolean {
	const cfg = settings.agent?.skillExtraction;
	if (cfg?.enabled === false) return false;
	const thread = getThread(threadId);
	if (!thread) return false;

	const minTools = cfg?.minToolCallsForSkill ?? DEFAULT_MIN_TOOL_CALLS_FOR_SKILL;
	const toolsSince = getAgentToolCallsSinceSkillBaseline(threadId);
	return toolsSince >= minTools;
}

const SKILL_EXTRACTION_SYSTEM_PROMPT = `You are a background skill extraction subagent.

Your job is to analyze a completed task and decide if it should be distilled into a reusable skill.
A skill is worth creating ONLY when:
- The task involved multiple tool calls and non-trivial reasoning
- The workflow is likely to recur in the future
- There are clear, reusable steps that can be followed

Return strict JSON with this shape:
{
  "should_create": true,
  "skill": {
    "slug": "deploy-staging",
    "name": "Short title (max 40 chars)",
    "description": "One-line summary of what this skill does",
    "triggers": ["keyword1", "keyword2"],
    "steps": ["Step 1...", "Step 2..."],
    "tools": ["Bash", "Read", "Write"],
    "pitfalls": ["Common mistake to avoid..."],
    "verification": ["How to verify success..."]
  }
}

If not worth creating, return {"should_create": false}.
Rules:
- Slug: lowercase, kebab-case, max 40 chars, no spaces
- Prefer updating existing skills over creating near-duplicates
- Do not save ephemeral, one-off, or overly specific tasks
- Do not save tasks that are just simple Q&A with no tool usage
- Return at most 1 skill`;

export function parseJsonResponse(text: string): SkillExtractionResponse {
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
	const base: SkillExtractionResponse = { should_create: false };
	if (!parsed || typeof parsed !== 'object') {
		return base;
	}
	const obj = parsed as { should_create?: unknown; skill?: unknown };
	if (obj.should_create === true) {
		base.should_create = true;
	}
	if (base.should_create && obj.skill && typeof obj.skill === 'object') {
		const s = obj.skill as Record<string, unknown>;
		const slug = sanitizeSkillSlug(typeof s.slug === 'string' ? s.slug : '');
		const name = typeof s.name === 'string' ? s.name.trim() : '';
		const description = typeof s.description === 'string' ? s.description.trim() : '';
		if (slug && name && description) {
			base.skill = {
				slug,
				name,
				description,
				triggers: parseStringArray(s.triggers),
				steps: parseStringArray(s.steps),
				tools: parseStringArray(s.tools),
				pitfalls: parseStringArray(s.pitfalls),
				verification: parseStringArray(s.verification),
			};
		}
	}
	return base;
}

export function parseStringArray(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
}

export function sanitizeSkillSlug(raw: string): string {
	const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
	if (!normalized || normalized.length > 40) {
		return '';
	}
	return normalized;
}

export function renderSkillFile(draft: ExtractedSkillDraft, toolCalls: number): string {
	const triggers = draft.triggers.length > 0 ? draft.triggers.join(', ') : '（用户显式调用 ./' + draft.slug + '）';
	const steps = draft.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
	const tools = draft.tools.map((t) => `- ${t}`).join('\n') || '- （根据任务动态选择）';
	const pitfalls = draft.pitfalls.length > 0 ? draft.pitfalls.map((p) => `- ${p}`).join('\n') : '- 暂无已知陷阱';
	const verification = draft.verification.length > 0 ? draft.verification.map((v) => `- ${v}`).join('\n') : '- 根据任务结果确认';

	return [
		'---',
		`name: ${draft.name}`,
		`description: ${draft.description}`,
		`slug: ${draft.slug}`,
		'auto_created: true',
		`created_at: ${new Date().toISOString()}`,
		'uses_count: 0',
		'success_rate: 1.0',
		'last_used: null',
		`tool_calls: ${toolCalls}`,
		'---',
		'',
		'## 触发条件',
		triggers,
		'',
		'## 执行步骤',
		steps,
		'',
		'## 需要的工具',
		tools,
		'',
		'## 常见陷阱',
		pitfalls,
		'',
		'## 验证方法',
		verification,
		'',
	].join('\n');
}

async function listExistingAutoSkills(workspaceRoot: string): Promise<{ slug: string; path: string }[]> {
	const skillsDir = getSkillDir(workspaceRoot);
	try {
		const entries = await fs.readdir(skillsDir, { withFileTypes: true });
		const out: { slug: string; path: string }[] = [];
		for (const ent of entries) {
			if (!ent.isDirectory()) continue;
			const skillPath = path.join(skillsDir, ent.name, 'SKILL.md');
			if (await isAutoCreatedSkill(skillPath)) {
				out.push({ slug: ent.name, path: skillPath });
			}
		}
		return out;
	} catch {
		return [];
	}
}

async function enforceMaxAutoSkills(workspaceRoot: string, max: number): Promise<void> {
	const skills = await listExistingAutoSkills(workspaceRoot);
	if (skills.length <= max) return;
	// 按文件修改时间排序，删除最旧的（超出限制的）
	const withMtime = await Promise.all(
		skills.map(async (s) => {
			try {
				const stat = await fs.stat(s.path);
				return { ...s, mtime: stat.mtimeMs };
			} catch {
				return { ...s, mtime: 0 };
			}
		})
	);
	withMtime.sort((a, b) => a.mtime - b.mtime);
	const toDelete = withMtime.slice(0, withMtime.length - max);
	for (const item of toDelete) {
		try {
			await fs.rm(path.dirname(item.path), { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
}

async function writeSkillToDisk(draft: ExtractedSkillDraft, workspaceRoot: string, toolCalls: number): Promise<void> {
	const skillPath = getSkillFilePath(workspaceRoot, draft.slug);
	await fs.mkdir(path.dirname(skillPath), { recursive: true });
	await fs.writeFile(skillPath, renderSkillFile(draft, toolCalls), 'utf8');
}

async function extractSkillWithRuntimeModel(
	runtime: RuntimeMemoryModel,
	userPrompt: string
): Promise<SkillExtractionResponse | null> {
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
				temperature:
					runtime.temperatureMode === 'custom' && runtime.temperature != null
						? resolveRequestedTemperature(0, runtime.temperatureMode, runtime.temperature)
						: openAICompatibleEffectiveTemperature(runtime.requestModelId, 0),
				max_tokens: 700,
				messages: [
					{
						role: 'system',
						content: prependProviderIdentitySystemPrompt(
							identitySettings,
							SKILL_EXTRACTION_SYSTEM_PROMPT
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
				system: prependProviderIdentitySystemPrompt(identitySettings, SKILL_EXTRACTION_SYSTEM_PROMPT),
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
				SKILL_EXTRACTION_SYSTEM_PROMPT
			),
			generationConfig: { temperature: 0, maxOutputTokens: 700 },
		});
		const resp = await model.generateContent(userPrompt);
		return parseJsonResponse(resp.response.text());
	} catch {
		return null;
	}
}

async function extractSkillWithModel(
	settings: ShellSettings,
	modelSelection: string,
	userPrompt: string
): Promise<SkillExtractionResponse | null> {
	const resolved = resolveModelRequest(settings, modelSelection);
	if (!resolved.ok) {
		return null;
	}
	return extractSkillWithRuntimeModel(
		{
			requestModelId: resolved.requestModelId,
			paradigm: resolved.paradigm,
			requestApiKey: resolved.apiKey,
			requestBaseURL: resolved.baseURL,
			requestProxyUrl: resolved.proxyUrl,
			temperatureMode: resolved.temperatureMode,
			temperature: resolved.temperature,
			providerIdentity: settings.providerIdentity,
		},
		userPrompt
	);
}

async function runSkillExtractionOnce(
	threadId: string,
	workspaceRoot: string,
	settings: ShellSettings,
	modelSelection: string
): Promise<void> {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	const toolCalls = thread.agentToolCallsCompleted ?? 0;
	const recentBlock = buildRecentConversationBlock(thread.messages, 0);
	if (!recentBlock.trim()) {
		return;
	}

	const existing = await listExistingAutoSkills(workspaceRoot);
	const existingManifest =
		existing.length > 0
			? existing.map((s) => `- ${s.slug}`).join('\n')
			: '(none)';

	const userPrompt = `Existing auto skills:\n${existingManifest}\n\nTotal tool calls in this thread: ${toolCalls}\n\nRecent conversation messages:\n${recentBlock}`;
	const extracted = await extractSkillWithModel(settings, modelSelection, userPrompt);
	if (!extracted || !extracted.should_create || !extracted.skill) {
		saveSkillExtractionToolBaseline(threadId);
		return;
	}

	// 检查是否已存在同名 skill
	const existingSkill = existing.find((s) => s.slug === extracted.skill!.slug);
	if (existingSkill) {
		// 已存在，更新它（保留 uses_count 和 success_rate）
		try {
			const oldRaw = await fs.readFile(existingSkill.path, 'utf8');
			const updated = mergeSkillUpdate(oldRaw, extracted.skill!, toolCalls);
			await fs.writeFile(existingSkill.path, updated, 'utf8');
		} catch {
			// 如果读取失败，直接覆盖
			await writeSkillToDisk(extracted.skill!, workspaceRoot, toolCalls);
		}
	} else {
		await writeSkillToDisk(extracted.skill!, workspaceRoot, toolCalls);
	}

	// 限制 auto skill 数量
	const maxSkills = settings.agent?.skillExtraction?.maxAutoSkills ?? DEFAULT_MAX_AUTO_SKILLS;
	await enforceMaxAutoSkills(workspaceRoot, maxSkills);

	saveSkillExtractionToolBaseline(threadId);
}

/**
 * 合并 skill 更新：保留旧文件的 uses_count / success_rate / last_used，更新其他内容。
 */
function mergeSkillUpdate(oldRaw: string, draft: ExtractedSkillDraft, toolCalls: number): string {
	// 提取旧文件的 stats
	const usesMatch = oldRaw.match(/uses_count:\s*(\d+)/);
	const rateMatch = oldRaw.match(/success_rate:\s*([\d.]+)/);
	const usedMatch = oldRaw.match(/last_used:\s*(.+)/);
	const usesCount = usesMatch ? parseInt(usesMatch[1]!, 10) : 0;
	const successRate = rateMatch ? parseFloat(rateMatch[1]!) : 1.0;
	const lastUsed = usedMatch ? usedMatch[1]!.trim() : 'null';

	const newContent = renderSkillFile(draft, toolCalls);
	// 替换 stats 为旧值
	return newContent
		.replace(/uses_count: 0/, `uses_count: ${usesCount}`)
		.replace(/success_rate: 1\.0/, `success_rate: ${successRate}`)
		.replace(/last_used: null/, `last_used: ${lastUsed}`);
}

export function queueExtractSkills(params: {
	threadId: string;
	workspaceRoot: string | null;
	settings: ShellSettings;
	modelSelection: string;
}): void {
	const { threadId, workspaceRoot, settings, modelSelection } = params;
	if (!workspaceRoot) {
		return;
	}
	if (!shouldRunSkillExtractionForThread(threadId, settings)) {
		return;
	}
	const key = `skill:${threadId}`;
	if (inFlight.has(key)) {
		rerunRequested.add(key);
		return;
	}
	const run = (async () => {
		try {
			await runSkillExtractionOnce(threadId, workspaceRoot, settings, modelSelection);
		} finally {
			inFlight.delete(key);
			if (rerunRequested.has(key)) {
				rerunRequested.delete(key);
				queueExtractSkills(params);
			}
		}
	})();
	inFlight.set(key, run);
}
