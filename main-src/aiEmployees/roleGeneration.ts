import { randomUUID } from 'node:crypto';
import type {
	HiringPlanCandidate,
	HiringPlanGeneratorInput,
	RolePromptDraft,
	RolePromptGeneratorInput,
} from '../../shared/aiEmployeesPersona.js';
import { NATIONALITY_CODES } from '../../shared/aiEmployeesPersona.js';
import type { ChatMessage } from '../threadStore.js';
import type { ShellSettings } from '../settingsStore.js';
import { resolveModelRequest, resolveThinkingLevelForSelection } from '../llm/modelResolve.js';
import { streamChatUnified } from '../llm/llmRouter.js';

function trimText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function extractJsonObject(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) {
		throw new Error('empty model response');
	}
	const direct = tryParseJson(trimmed);
	if (direct.ok) {
		return direct.value;
	}
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced) {
		const parsed = tryParseJson(fenced[1] ?? '');
		if (parsed.ok) {
			return parsed.value;
		}
	}
	const firstBrace = trimmed.indexOf('{');
	const lastBrace = trimmed.lastIndexOf('}');
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		const sliced = trimmed.slice(firstBrace, lastBrace + 1);
		const parsed = tryParseJson(sliced);
		if (parsed.ok) {
			return parsed.value;
		}
	}
	throw new Error('model did not return valid JSON');
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false };
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNationalityCode(value: string): value is (typeof NATIONALITY_CODES)[number] {
	return (NATIONALITY_CODES as readonly string[]).includes(value);
}

function normalizeRolePromptDraft(value: unknown): RolePromptDraft {
	const obj = isPlainObject(value) ? value : {};
	const systemPrompt = trimText(obj.systemPrompt);
	if (!systemPrompt) {
		throw new Error('generated prompt draft missing systemPrompt');
	}
	return {
		systemPrompt,
		roleSummary: trimText(obj.roleSummary),
		speakingStyle: trimText(obj.speakingStyle),
		collaborationRules: trimText(obj.collaborationRules),
		handoffRules: trimText(obj.handoffRules),
	};
}

function normalizeHiringPlan(value: unknown): HiringPlanCandidate[] {
	const obj = isPlainObject(value) ? value : {};
	const rawCandidates = Array.isArray(obj.candidates) ? obj.candidates : Array.isArray(value) ? value : [];
	const out: HiringPlanCandidate[] = [];
	for (const item of rawCandidates) {
		if (!isPlainObject(item)) {
			continue;
		}
		const displayName = trimText(item.displayName);
		const roleKey = trimText(item.roleKey) || 'custom';
		const promptDraft = normalizeRolePromptDraft(item.promptDraft);
		if (!displayName) {
			continue;
		}
		const nationalityCode = trimText(item.nationalityCode);
		const modelSourceRaw = trimText(item.modelSource);
		const modelSource =
			modelSourceRaw === 'local_model' || modelSourceRaw === 'remote_runtime' || modelSourceRaw === 'hybrid'
				? modelSourceRaw
				: 'hybrid';
		out.push({
			id: trimText(item.id) || randomUUID(),
			roleKey,
			customRoleTitle: trimText(item.customRoleTitle) || undefined,
			displayName,
			nationalityCode: isNationalityCode(nationalityCode) ? nationalityCode : undefined,
			modelSource,
			managerEmployeeId: trimText(item.managerEmployeeId) || undefined,
			reason: trimText(item.reason),
			jobMission: trimText(item.jobMission) || undefined,
			domainContext: trimText(item.domainContext) || undefined,
			communicationNotes: trimText(item.communicationNotes) || undefined,
			promptDraft,
		});
		if (out.length >= 6) {
			break;
		}
	}
	if (out.length === 0) {
		throw new Error('generated hiring plan was empty');
	}
	return out;
}

async function runStructuredCompletion(settings: ShellSettings, modelId: string, messages: ChatMessage[]): Promise<string> {
	const resolved = resolveModelRequest(settings, modelId);
	if (!resolved.ok) {
		throw new Error(resolved.message);
	}
	const signal = AbortSignal.timeout(120_000);
	let fullText = '';
	let done = false;
	let doneError: string | null = null;
	await streamChatUnified(
		settings,
		messages,
		{
			mode: 'ask',
			signal,
			requestModelId: resolved.requestModelId,
			paradigm: resolved.paradigm,
			requestApiKey: resolved.apiKey,
			requestBaseURL: resolved.baseURL,
			requestProxyUrl: resolved.proxyUrl,
			maxOutputTokens: Math.min(resolved.maxOutputTokens, 4_096),
			contextWindowTokens: resolved.contextWindowTokens,
			thinkingLevel: resolveThinkingLevelForSelection(settings, modelId),
		},
		{
			onDelta(text) {
				fullText += text;
			},
			onDone(text) {
				fullText = text;
				done = true;
			},
			onError(message) {
				doneError = message;
			},
		}
	);
	if (doneError) {
		throw new Error(doneError);
	}
	if (!done) {
		throw new Error('model response incomplete');
	}
	return fullText;
}

export async function generateRolePromptDraft(
	settings: ShellSettings,
	input: RolePromptGeneratorInput
): Promise<RolePromptDraft> {
	const roleTitle = trimText(input.customRoleTitle) || trimText(input.roleKey) || trimText(input.templatePromptKey) || 'custom role';
	const system = [
		'You generate role system prompts for an AI company org chart.',
		'Return strict JSON only.',
		'No markdown fences. No explanations.',
		'The JSON shape must be: {"systemPrompt": string, "roleSummary": string, "speakingStyle": string, "collaborationRules": string, "handoffRules": string}.',
		'The systemPrompt must include: role identity, core goals, decision boundaries, inputs/outputs, collaboration-escalation path, speaking style, and hard prohibitions.',
		'collaborationRules must specify when the role should coordinate with others, when to escalate, how to report blockers, and how to stay within scope.',
		'handoffRules must specify the exact handoff contract and must include done, risks, next_owner, and next_action.',
		'Use the chosen nationality only to shape communication style and collaboration habits, never competence or permissions.',
		'Follow the spirit of specialized agency agents: crisp responsibility, clean handoffs, explicit deliverables, low overlap.',
	].join('\n');
	const user = {
		companyName: trimText(input.companyName),
		templatePromptKey: trimText(input.templatePromptKey),
		roleKey: trimText(input.roleKey),
		displayName: trimText(input.displayName),
		customRoleTitle: trimText(input.customRoleTitle),
		nationalityCode: input.nationalityCode ?? null,
		jobMission: trimText(input.jobMission),
		domainContext: trimText(input.domainContext),
		communicationNotes: trimText(input.communicationNotes),
		collaborationRules: trimText(input.collaborationRules),
		handoffRules: trimText(input.handoffRules),
		managerSummary: trimText(input.managerSummary),
		goal: `Create the best-fitting production-ready system prompt for ${trimText(input.displayName) || roleTitle}.`,
	};
	const text = await runStructuredCompletion(settings, input.modelId, [
		{ role: 'system', content: system },
		{ role: 'user', content: JSON.stringify(user, null, 2) },
	]);
	return normalizeRolePromptDraft(extractJsonObject(text));
}

export async function generateHiringPlan(
	settings: ShellSettings,
	input: HiringPlanGeneratorInput
): Promise<HiringPlanCandidate[]> {
	const system = [
		'You are helping a CEO propose the first AI employee team for a company.',
		'Return strict JSON only.',
		'No markdown fences. No explanations.',
		'Output shape: {"candidates": HiringPlanCandidate[]}.',
		'Each candidate must include roleKey, customRoleTitle, displayName, nationalityCode, modelSource, managerEmployeeId, reason, jobMission, domainContext, communicationNotes, promptDraft.',
		'Use 1 to 6 candidates.',
		'Prefer essential complementary roles only. Avoid redundancy.',
		'displayName should default to the role title, not a fictional person name.',
		'managerEmployeeId should default to the CEO id when possible.',
		'promptDraft must follow the same strict shape as role prompt generation.',
	].join('\n');
	const ceo = input.currentEmployees.find((employee) => employee.isCeo);
	const user = {
		companyName: trimText(input.companyName),
		ceoDisplayName: trimText(input.ceoDisplayName),
		ceoId: ceo?.id ?? null,
		ceoPersonaSeed: input.ceoPersonaSeed ?? null,
		ceoSystemPrompt: trimText(input.ceoSystemPrompt),
		userRequirements: trimText(input.userRequirements ?? ''),
		currentEmployees: input.currentEmployees,
	};
	const systemExtra = trimText(input.userRequirements ?? '')
		? [
				'The user has stated specific goals for this team. Prioritize them when proposing roles, collaborationRules, and handoffRules.',
				'Align candidate jobMission, domainContext, and promptDraft with those goals.',
		  ].join(' ')
		: '';
	const systemFull = systemExtra ? `${system}\n\n${systemExtra}` : system;
	const text = await runStructuredCompletion(settings, input.modelId, [
		{ role: 'system', content: systemFull },
		{ role: 'user', content: JSON.stringify(user, null, 2) },
	]);
	return normalizeHiringPlan(extractJsonObject(text));
}

export { extractJsonObject, normalizeHiringPlan, normalizeRolePromptDraft };
