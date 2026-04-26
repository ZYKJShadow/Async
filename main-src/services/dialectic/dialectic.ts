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
import type { RuntimeMemoryModel } from '../../memdir/findRelevantMemories.js';
import { saveConclusion, getRecentConclusions, recordRelationshipMilestone, getLatestRelationshipSnapshot } from '../../sessionDb.js';
import type { ChatMessage } from '../../threadStore.js';
import { resolveProviderIdentityWithOverride } from '../../../src/providerIdentitySettings.js';

const DIALECTIC_SYSTEM_PROMPT = `You are a dialectic reasoning engine. Your job is to analyze a completed conversation and derive insights about the user.

Analyze the conversation from these dimensions:
1. user_preference: What does the user prefer? (style, tools, communication)
2. working_pattern: How does the user work? (pace, thoroughness, decision-making)
3. project_context: What is the user working on? (tech stack, goals, constraints)
4. relationship_signal: How is the relationship evolving? (trust, collaboration quality)

Return strict JSON:
{
  "conclusions": [
    { "category": "user_preference", "insight": "...", "confidence": 0.9 }
  ],
  "relationship": {
    "trust_delta": 0.1,      // -1 to 1, how much trust changed this session
    "efficiency_delta": 0.1, // -1 to 1, collaboration efficiency change
    "satisfaction_delta": 0.1, // -1 to 1, user satisfaction change
    "milestone": "optional milestone description"
  }
}

Rules:
- Only return insights with confidence >= 0.6
- Prefer updating existing insights over creating redundant ones
- Be specific, not vague (e.g. "prefers TypeScript over JavaScript" not "has preferences")
- relationship deltas should be small increments (-0.3 to 0.3), not jumps`;

function clipText(text: string, maxChars: number): string {
	return text.length > maxChars ? `${text.slice(0, maxChars)}\n...(truncated)` : text;
}

function buildConversationBlock(messages: ChatMessage[]): string {
	const nonSystem = messages.filter((m) => m.role !== 'system');
	const slice = nonSystem.slice(-15);
	return clipText(
		slice.map((m, i) => `### ${i + 1}. ${m.role}\n${m.content}`).join('\n\n'),
		12000
	);
}

function parseDialecticResponse(text: string): {
	conclusions: Array<{ category: string; insight: string; confidence: number }>;
	relationship: { trustDelta: number; efficiencyDelta: number; satisfactionDelta: number; milestone: string };
} | null {
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
				return null;
			}
		}
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const obj = parsed as Record<string, unknown>;
	const conclusions: Array<{ category: string; insight: string; confidence: number }> = [];
	if (Array.isArray(obj.conclusions)) {
		for (const c of obj.conclusions) {
			if (!c || typeof c !== 'object') continue;
			const insight = String((c as Record<string, unknown>).insight ?? '').trim();
			const category = String((c as Record<string, unknown>).category ?? '').trim();
			const confidence = Number((c as Record<string, unknown>).confidence ?? 0);
			if (insight && category && confidence >= 0.6) {
				conclusions.push({ category, insight, confidence });
			}
		}
	}
	let relationship = { trustDelta: 0, efficiencyDelta: 0, satisfactionDelta: 0, milestone: '' };
	if (obj.relationship && typeof obj.relationship === 'object') {
		const r = obj.relationship as Record<string, unknown>;
		relationship = {
			trustDelta: Math.max(-1, Math.min(1, Number(r.trust_delta ?? 0))),
			efficiencyDelta: Math.max(-1, Math.min(1, Number(r.efficiency_delta ?? 0))),
			satisfactionDelta: Math.max(-1, Math.min(1, Number(r.satisfaction_delta ?? 0))),
			milestone: String(r.milestone ?? '').trim(),
		};
	}
	return { conclusions, relationship };
}

async function dialecticWithRuntimeModel(
	runtime: RuntimeMemoryModel,
	userPrompt: string
): Promise<ReturnType<typeof parseDialecticResponse>> {
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
				max_tokens: 1024,
				messages: [
					{
						role: 'system',
						content: prependProviderIdentitySystemPrompt(identitySettings, DIALECTIC_SYSTEM_PROMPT),
					},
					{ role: 'user', content: userPrompt },
				],
			});
			return parseDialecticResponse(String(resp.choices[0]?.message?.content ?? ''));
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
				system: prependProviderIdentitySystemPrompt(identitySettings, DIALECTIC_SYSTEM_PROMPT),
				max_tokens: 1024,
				temperature: 0,
				...(anthropicMetadata ? { metadata: anthropicMetadata } : {}),
				messages: [{ role: 'user', content: userPrompt }],
			});
			const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
			return parseDialecticResponse(text);
		}
		const genAI = new GoogleGenerativeAI(runtime.requestApiKey);
		const model = genAI.getGenerativeModel({
			model: runtime.requestModelId,
			systemInstruction: prependProviderIdentitySystemPrompt(
				{ providerIdentity: runtime.providerIdentity },
				DIALECTIC_SYSTEM_PROMPT
			),
			generationConfig: { temperature: 0, maxOutputTokens: 1024 },
		});
		const resp = await model.generateContent(userPrompt);
		return parseDialecticResponse(resp.response.text());
	} catch {
		return null;
	}
}

async function dialecticWithModel(
	settings: ShellSettings,
	modelSelection: string,
	userPrompt: string
): Promise<ReturnType<typeof parseDialecticResponse>> {
	const resolved = resolveModelRequest(settings, modelSelection);
	if (!resolved.ok) return null;
	return dialecticWithRuntimeModel(
		{
			requestModelId: resolved.requestModelId,
			paradigm: resolved.paradigm,
			requestApiKey: resolved.apiKey,
			requestBaseURL: resolved.baseURL,
			requestProxyUrl: resolved.proxyUrl,
			temperatureMode: resolved.temperatureMode,
			temperature: resolved.temperature,
			providerIdentity: resolveProviderIdentityWithOverride(settings.providerIdentity, resolved.providerIdentity),
		},
		userPrompt
	);
}

export async function runDialecticAnalysis(params: {
	sessionId: string;
	workspaceRoot: string | null;
	messages: ChatMessage[];
	settings: ShellSettings;
	modelSelection: string;
	turnNumber: number;
}): Promise<void> {
	const { sessionId, workspaceRoot, messages, settings, modelSelection, turnNumber } = params;

	// 只处理有足够消息的对话
	const nonSystem = messages.filter((m) => m.role !== 'system');
	if (nonSystem.length < 4) return;

	const conversationBlock = buildConversationBlock(messages);
	const existingConclusions = getRecentConclusions(workspaceRoot, 10)
		.map((c) => `- [${c.category}] ${c.insight} (confidence: ${c.confidence})`)
		.join('\n') || '(none)';

	const userPrompt = `Existing insights about this user:\n${existingConclusions}\n\nRecent conversation:\n${conversationBlock}`;
	const result = await dialecticWithModel(settings, modelSelection, userPrompt);
	if (!result) return;

	// 保存结论
	for (const c of result.conclusions) {
		saveConclusion({
			sessionId,
			workspaceRoot,
			category: c.category,
			insight: c.insight,
			confidence: c.confidence,
		});
	}

	// 计算新的关系分数（基于上一快照）
	const prev = getLatestRelationshipSnapshot(sessionId);
	const prevTrust = prev?.trustScore ?? 0.5;
	const prevEfficiency = prev?.collaborationEfficiency ?? 0.5;
	const prevSatisfaction = prev?.userSatisfaction ?? 0.5;

	recordRelationshipMilestone({
		sessionId,
		workspaceRoot,
		turnNumber,
		trustScore: Math.max(0, Math.min(1, prevTrust + result.relationship.trustDelta)),
		collaborationEfficiency: Math.max(0, Math.min(1, prevEfficiency + result.relationship.efficiencyDelta)),
		userSatisfaction: Math.max(0, Math.min(1, prevSatisfaction + result.relationship.satisfactionDelta)),
		milestone: result.relationship.milestone,
	});
}

export function buildDialecticContextBlock(params: {
	workspaceRoot: string | null;
	turnNumber: number;
}): string {
	const conclusions = getRecentConclusions(params.workspaceRoot, 10);
	if (conclusions.length === 0) return '';

	const body = conclusions
		.map((c) => `- [${c.category}] ${c.insight}`)
		.join('\n');

	return `## User Insights (Dialectic)\nThe following insights about the user were derived from ongoing dialectic analysis across sessions:\n\n${body}`;
}

export function buildRelationshipContextBlock(sessionId: string): string {
	const snapshot = getLatestRelationshipSnapshot(sessionId);
	if (!snapshot) return '';

	const parts: string[] = [];
	if (snapshot.trustScore > 0.7) parts.push('Trust level: high');
	else if (snapshot.trustScore < 0.3) parts.push('Trust level: low');

	if (snapshot.collaborationEfficiency > 0.7) parts.push('Collaboration efficiency: high');
	else if (snapshot.collaborationEfficiency < 0.3) parts.push('Collaboration efficiency: low');

	if (snapshot.milestone) parts.push(`Milestone: ${snapshot.milestone}`);

	if (parts.length === 0) return '';
	return `## Relationship State\n${parts.join('. ')}.`;
}
