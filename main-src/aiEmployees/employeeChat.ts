import type { EmployeeChatInput } from '../../shared/aiEmployeesPersona.js';
import type { ChatMessage } from '../threadStore.js';
import type { ShellSettings } from '../settingsStore.js';
import { resolveModelRequest, resolveThinkingLevelForSelection } from '../llm/modelResolve.js';
import { streamChatUnified } from '../llm/llmRouter.js';
import { runAgentLoop, type AgentLoopHandlers, type AgentLoopOptions } from '../agent/agentLoop.js';
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
			`Your team members (colleagues, not superiors):\n${roster}\n\n` +
			'When a task involves expertise outside your role, proactively suggest which teammate should handle it, or recommend that the boss assign it to them. ' +
			'You may collaborate with teammates as peers — ask them questions, share context, and hand off sub-tasks. ' +
			'When you complete a task, summarize your results clearly so they can be reported to the boss or handed off to a colleague.'
		);
	}

	// Workspace context: inject live projects, issues, and skills so the employee is aware of workspace state
	if (input.workspaceContext) {
		const ctx = input.workspaceContext;
		const lines: string[] = [];

		if (ctx.companyName) {
			lines.push(`Company: ${ctx.companyName}`);
		}

		if (ctx.projects.length > 0) {
			lines.push('Projects:');
			for (const p of ctx.projects) {
				const progress = p.issueCount > 0 ? ` [${p.doneCount}/${p.issueCount} done]` : ' [no issues]';
				const lead = p.leadName ? `, lead: ${p.leadName}` : '';
				const boundary = p.boundaryKind !== 'none'
					? `, ${p.boundaryKind}: ${p.boundaryPath ?? '?'}` : '';
				const icon = p.icon ?? '📁';
				lines.push(`  ${icon} ${p.title}${progress}${lead}${boundary}`);
				if (p.description) {
					lines.push(`    ${p.description.slice(0, 140).replace(/\n/g, ' ')}`);
				}
			}
		} else {
			lines.push('Projects: none yet');
		}

		if (ctx.recentIssues.length > 0) {
			lines.push('Recent issues:');
			for (const i of ctx.recentIssues) {
				const id = i.identifier ?? '';
				const proj = i.projectTitle ? ` [${i.projectTitle}]` : '';
				const assignee = i.assigneeName ? ` → ${i.assigneeName}` : '';
				const priority = i.priority && i.priority !== 'none' ? ` (${i.priority})` : '';
				lines.push(`  ${id ? id + ' ' : ''}${i.title} · ${i.status}${priority}${proj}${assignee}`);
			}
		} else {
			lines.push('Issues: none yet');
		}

		if (ctx.skills.length > 0) {
			const skillList = ctx.skills.map((s) => s.name).join(', ');
			lines.push(`Skills available: ${skillList}`);
		}

		parts.push(`== Current workspace state ==\n${lines.join('\n')}\n== End of workspace state ==`);
	}

	parts.push(
		'You are communicating with your boss (the company owner / decision-maker) in a work inbox. Treat them with the respect due to a superior — report progress, ask for decisions when needed, and never assign tasks back to them.',
		'Be concise, professional, and action-oriented.',
		'If assigned a task, acknowledge it and outline your approach.',
		'If you need clarification, ask specific questions.',
		'If something is outside your scope, say so and suggest which teammate might help.',
		'Reply in the same language as the user when they write in Chinese or another language, unless they ask otherwise.'
	);

	return parts.join('\n\n');
}

export type EmployeeChatHandlers = StreamHandlers & {
	/** Called when the agent invokes a tool (only in agent mode). */
	onToolCall?: (name: string, args: Record<string, unknown>) => void;
	/** Called when a tool returns (only in agent mode). */
	onToolResult?: (name: string, success: boolean) => void;
};

/**
 * Stream a reply for an AI employee inbox turn.
 *
 * When `boundaryLocalPaths` is provided, runs the full agent loop with file tools
 * scoped to the first boundary path. Otherwise falls back to plain chat completion.
 */
export async function runEmployeeChat(
	settings: ShellSettings,
	input: EmployeeChatInput,
	handlers: EmployeeChatHandlers
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

	const useAgentMode =
		input.boundaryLocalPaths &&
		input.boundaryLocalPaths.length > 0 &&
		resolved.paradigm !== 'gemini'; // Gemini doesn't support tool use

	if (useAgentMode) {
		const workspaceRoot = input.boundaryLocalPaths![0];

		const agentHandlers: AgentLoopHandlers = {
			onTextDelta: (text) => handlers.onDelta(text),
			onToolCall: (name, args, _id) => {
				handlers.onToolCall?.(name, args);
			},
			onToolResult: (name, _result, success, _id) => {
				handlers.onToolResult?.(name, success);
			},
			onDone: (text) => handlers.onDone(text),
			onError: (msg) => handlers.onError(msg),
		};

		const agentOptions: AgentLoopOptions = {
			requestModelId: resolved.requestModelId,
			paradigm: resolved.paradigm,
			requestApiKey: resolved.apiKey,
			requestBaseURL: resolved.baseURL,
			requestProxyUrl: resolved.proxyUrl,
			maxOutputTokens: Math.min(resolved.maxOutputTokens, 16384),
			signal: AbortSignal.timeout(300_000), // 5 minutes for agent tasks
			composerMode: 'agent',
			workspaceRoot,
			thinkingLevel: resolveThinkingLevelForSelection(settings, input.modelId),
		};

		await runAgentLoop(settings, messages, agentOptions, agentHandlers);
	} else {
		// Plain chat fallback (no tools)
		await streamChatUnified(
			settings,
			messages,
			{
				mode: 'ask',
				signal: AbortSignal.timeout(120_000),
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
}
