import type { EmployeeChatInput } from '../../shared/aiEmployeesPersona.js';
import type { ChatMessage } from '../threadStore.js';
import type { ShellSettings } from '../settingsStore.js';
import { resolveModelRequest, resolveThinkingLevelForSelection } from '../llm/modelResolve.js';
import { streamChatUnified } from '../llm/llmRouter.js';
import type { StreamHandlers } from '../llm/types.js';

function trim(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

export function buildEmployeeSystemPrompt(input: EmployeeChatInput): string {
	const parts: string[] = [];
	const title = trim(input.customRoleTitle) || trim(input.roleKey) || 'team member';

	if (trim(input.customSystemPrompt)) {
		parts.push(trim(input.customSystemPrompt)!);
	} else {
		parts.push(`You are ${trim(input.displayName) || 'AI employee'}, ${title}.`);
	}

	if (trim(input.jobMission)) {
		parts.push(`Core mission:\n${trim(input.jobMission)}`);
	}
	if (trim(input.domainContext)) {
		parts.push(`Domain context:\n${trim(input.domainContext)}`);
	}
	if (trim(input.communicationNotes)) {
		parts.push(`Communication style:\n${trim(input.communicationNotes)}`);
	}
	if (trim(input.collaborationRules)) {
		parts.push(`Collaboration rules:\n${trim(input.collaborationRules)}`);
	}
	if (trim(input.handoffRules)) {
		parts.push(`Handoff rules:\n${trim(input.handoffRules)}`);
	}

	// Team context: let the employee know about colleagues
	if (input.teamMembers && input.teamMembers.length > 0) {
		const roster = input.teamMembers
			.map((m) => {
				const mission = m.jobMission ? ` — ${m.jobMission}` : '';
				return `• ${m.displayName} (${m.roleTitle})${mission}`;
			})
			.join('\n');
		parts.push(
			`Your team members:\n${roster}\n\n` +
			'When a task involves expertise outside your role, you should suggest involving the appropriate teammate. ' +
			'If you receive a task that is clearly in another teammate\'s domain, recommend assigning it to them. ' +
			'When you complete a task, summarize your results clearly so they can be handed off.'
		);
	}

	parts.push(
		'You are communicating with your team lead in a work inbox.',
		'Be concise, professional, and action-oriented.',
		'If assigned a task, acknowledge it and outline your approach.',
		'If you need clarification, ask specific questions.',
		'If something is outside your scope, say so and suggest who might help.',
		'Reply in the same language as the user when they write in Chinese or another language, unless they ask otherwise.'
	);

	return parts.join('\n\n');
}

/**
 * Stream a reply for an AI employee inbox turn using the bound local model.
 */
export async function runEmployeeChat(
	settings: ShellSettings,
	input: EmployeeChatInput,
	handlers: StreamHandlers
): Promise<void> {
	const resolved = resolveModelRequest(settings, input.modelId);
	if (!resolved.ok) {
		handlers.onError(resolved.message);
		throw new Error(resolved.message);
	}

	const systemPrompt = buildEmployeeSystemPrompt(input);
	const history: ChatMessage[] = (input.history ?? []).map((turn) => ({
		role: turn.role,
		content: turn.content,
	}));
	const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...history];

	const signal = AbortSignal.timeout(120_000);

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
			maxOutputTokens: Math.min(resolved.maxOutputTokens, 4096),
			contextWindowTokens: resolved.contextWindowTokens,
			thinkingLevel: resolveThinkingLevelForSelection(settings, input.modelId),
			workspaceRoot: null,
		},
		handlers
	);
}
