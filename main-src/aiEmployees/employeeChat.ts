import type { EmployeeChatInput } from '../../shared/aiEmployeesPersona.js';
import type { ChatMessage } from '../threadStore.js';
import type { ShellSettings } from '../settingsStore.js';
import { resolveModelRequest, resolveThinkingLevelForSelection } from '../llm/modelResolve.js';
import { streamChatUnified } from '../llm/llmRouter.js';
import { runAgentLoop, type AgentLoopHandlers, type AgentLoopOptions } from '../agent/agentLoop.js';
import { assembleAgentToolPool } from '../agent/agentToolPool.js';
import type { AgentToolDef } from '../agent/agentTools.js';
import type { StreamHandlers } from '../llm/types.js';
import {
	CEO_COLLAB_TOOL_DEFS,
	COLLAB_TOOL_DEFS,
	REVIEWER_COLLAB_TOOL_DEFS,
	isCollabTool,
	parseCollabAction,
	type CollabAction,
} from './collaborationTools.js';
import { flattenAssistantTextPartsForSearch, isStructuredAssistantMessage } from '../../src/agentStructuredMessage.js';

/** Abort when either the user-controlled signal or the timeout fires. */
function mergeWithTimeout(timeoutMs: number, user?: AbortSignal): AbortSignal {
	const timeoutSig = AbortSignal.timeout(timeoutMs);
	if (!user) {
		return timeoutSig;
	}
	if (user.aborted || timeoutSig.aborted) {
		return user.aborted ? user : timeoutSig;
	}
	const merged = new AbortController();
	const forward = () => {
		try {
			merged.abort();
		} catch {
			/* noop */
		}
	};
	user.addEventListener('abort', forward, { once: true });
	timeoutSig.addEventListener('abort', forward, { once: true });
	return merged.signal;
}

function trim(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** Normalize a role key to a known profile. Unknown keys fall back to 'generic'. */
function normalizeRoleKey(roleKey: string | undefined): 'frontend' | 'backend' | 'qa' | 'reviewer' | 'generic' {
	const key = trim(roleKey).toLowerCase();
	if (key === 'frontend' || key === 'backend' || key === 'qa' || key === 'reviewer') {
		return key;
	}
	return 'generic';
}

/**
 * Build the role-specific tool subset for a non-CEO employee. Reviewers get a read-only
 * tool surface and must request revisions instead of editing; other roles share the full
 * agent tool pool. LSP is added for frontend/backend to support refactor-aware work.
 */
export function assembleRoleToolPool(
	roleKey: string | undefined,
	options?: { mcpToolDenyPrefixes?: string[] }
): AgentToolDef[] {
	const role = normalizeRoleKey(roleKey);
	if (role === 'reviewer') {
		const base = assembleAgentToolPool('agent', options);
		// Reviewer: read-only tools (Read/Glob/Grep/LSP and read-only MCP). No Write/Edit/Bash.
		const writeLike = new Set(['Write', 'Edit', 'Bash']);
		return base.filter((tool) => !writeLike.has(tool.name));
	}
	return assembleAgentToolPool('agent', options);
}

/** Inject role-specific guard-rails into the system prompt so each specialist stays in lane. */
export function buildRoleSpecificPromptSection(roleKey: string | undefined, isCeo: boolean): string | null {
	if (isCeo) {
		return null;
	}
	const role = normalizeRoleKey(roleKey);
	switch (role) {
		case 'frontend':
			return (
				'== Frontend specialist ==\n' +
				'• Focus on UI components, styling, interaction logic, and accessibility.\n' +
				'• Do NOT modify backend APIs, database schemas, or server configuration — delegate those to the backend specialist.\n' +
				'• When an API contract is unclear, use send_colleague_message to ask the backend teammate before coding against it.\n' +
				'• Surface design tradeoffs, edge cases, and browser/device concerns in submit_result.'
			);
		case 'backend':
			return (
				'== Backend specialist ==\n' +
				'• Focus on API design, data models, business logic, performance, and security.\n' +
				'• Do NOT modify frontend components or styles — delegate UI changes to the frontend specialist.\n' +
				'• When adding or changing an endpoint, document the contract in submit_result so the frontend can integrate cleanly.\n' +
				'• Call out migrations, breaking changes, and rollout risk explicitly.'
			);
		case 'qa':
			return (
				'== QA specialist ==\n' +
				'• Focus on test cases, edge conditions, regression checks, and automated coverage.\n' +
				'• Prefer adding or updating tests over editing production code; if production code must change to be testable, flag it.\n' +
				'• When you find a bug, use report_blocker with a precise reproduction and expected vs. actual behavior.\n' +
				'• In submit_result, summarize coverage added, cases run, and known gaps.'
			);
		case 'reviewer':
			return (
				'== Code reviewer ==\n' +
				'• You only review code. You MUST NOT modify files — you have no write tools.\n' +
				'• Check: coding conventions, error handling, security risks, performance, maintainability, and readability.\n' +
				'• When you find an issue, call `request_revision` with the file path, issue description, and a concrete suggestion; route to the original author.\n' +
				'• Use submit_result only when the review is complete (either all issues raised or the code passes review).\n' +
				'• Do not speculate beyond what you can see — read the relevant files first.'
			);
		default:
			return null;
	}
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

	// CEO/Coordinator-specific instructions — CEO does NOT execute code, only coordinates
	if (input.isCeo) {
		parts.push(
			'== CEO / Coordinator role ==\n' +
			'You are the team coordinator (CEO). You do NOT write code or modify files yourself.\n' +
			'Your job is to analyze, plan, delegate, and report.\n\n' +
			'Your tools:\n' +
			'• draft_plan — Publish a visible checklist for the boss BEFORE delegating (required for multi-step work).\n' +
			'• delegate_task — Assign a sub-task to a teammate. Pass plan_item_id when it maps to a draft_plan row.\n' +
			'• send_colleague_message — Ask a teammate a question or share context.\n' +
			'• submit_result — Report overall status back to the boss.\n' +
			'• report_blocker — Escalate when the team is stuck.\n\n' +
			'When you receive a request from the boss:\n' +
			'1. Briefly acknowledge the request.\n' +
			'2. Analyze what needs to be done.\n' +
			'3. For anything beyond a one-line answer, call `draft_plan` once with ordered steps (title + optional owner_employee_name).\n' +
			'4. Then call `delegate_task` for each step that needs a teammate; use the same titles when possible and include plan_item_id.\n' +
			'5. Explain your plan in plain language: who will do what and why.\n' +
			'6. You may delegate to multiple teammates in one response.\n\n' +
			'IMPORTANT:\n' +
			'- Do NOT read, write, or edit files yourself. Delegate all technical work.\n' +
			'- Your chat responses should be short verbal summaries only.\n' +
			'- When delegating, match the task to the teammate whose role fits best.\n' +
			'- If no teammate fits, explain to the boss and suggest hiring.\n' +
			'- For quick one-sentence answers with no delegation, you may skip draft_plan and reply or use submit_result.'
		);
	} else if (input.teamMembers && input.teamMembers.length > 0) {
		const isReviewer = normalizeRoleKey(input.roleKey) === 'reviewer';
		if (isReviewer) {
			parts.push(
				'== Collaboration tools ==\n' +
				'Your tools (reviewer surface — no write access):\n' +
				'• request_revision — Ask the original author to fix an issue (target_employee_name, file_path, issue_description, optional suggestion).\n' +
				'• send_colleague_message — Message a teammate for clarification.\n' +
				'• submit_result — Report the review outcome with overall verdict and list of open issues.\n' +
				'• report_blocker — Escalate when you cannot complete the review.\n\n' +
				'Workflow:\n' +
				'1. Read the relevant files first (Read/Glob/Grep/LSP).\n' +
				'2. For each issue, call `request_revision` with file_path + issue_description.\n' +
				'3. When all issues are raised (or code is clean), call `submit_result` summarizing the review.'
			);
		} else {
			parts.push(
				'== Collaboration tools ==\n' +
				'Besides your normal work tools, you have collaboration tools:\n' +
				'• delegate_task — Pass a sub-task to a teammate if it requires their expertise.\n' +
				'• send_colleague_message — Message a teammate to ask questions or share context.\n' +
				'• submit_result — Report task completion. ALWAYS call this when you finish a task.\n' +
				'• report_blocker — Report when you are stuck and need help.\n\n' +
				'Workflow:\n' +
				'1. When you receive a task, do the work using your normal tools (Read, Write, Edit, etc.).\n' +
				'2. When done, call `submit_result` with a summary of what you did.\n' +
				'3. If you hit a blocker, call `report_blocker`.\n' +
				'4. If part of the task needs another teammate, call `delegate_task`.'
			);
		}
	}

	const roleSection = buildRoleSpecificPromptSection(input.roleKey, Boolean(input.isCeo));
	if (roleSection) {
		parts.push(roleSection);
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
	onToolCall?: (name: string, args: Record<string, unknown>, toolUseId: string) => void;
	/** Called when a tool returns (only in agent mode). */
	onToolResult?: (name: string, success: boolean, toolUseId: string, resultPreview?: string) => void;
	/** Called when the agent invokes a collaboration tool (delegate_task, submit_result, etc.). */
	onCollabAction?: (action: CollabAction) => void;
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

	const hasTeammates = input.teamMembers && input.teamMembers.length > 0;
	const hasBoundary =
		input.boundaryLocalPaths &&
		input.boundaryLocalPaths.length > 0;
	const canUseTools = resolved.paradigm !== 'gemini';

	if (input.isCeo && hasTeammates && !canUseTools) {
		const msg = `The model "${resolved.requestModelId}" (paradigm: ${resolved.paradigm}) does not support tool calling. ` +
			`The CEO role requires tool calling to delegate tasks. Please bind a model that supports function calling (e.g. OpenAI, Anthropic).`;
		handlers.onError(msg);
		throw new Error(msg);
	}

	const useAgentMode = canUseTools && (input.isCeo ? hasTeammates : hasBoundary);

	if (useAgentMode) {
		const workspaceRoot = hasBoundary ? input.boundaryLocalPaths![0] : null;

		let toolPool: AgentToolDef[];
		if (input.isCeo) {
			// CEO: collaboration tools only — force delegation, no file operations
			toolPool = [...CEO_COLLAB_TOOL_DEFS];
		} else {
			// Role-specific pool: reviewer gets read-only + revision requests; others get full tools.
			const baseTools = assembleRoleToolPool(input.roleKey, {
				mcpToolDenyPrefixes: settings.mcpToolDenyPrefixes,
			});
			const isReviewer = normalizeRoleKey(input.roleKey) === 'reviewer';
			if (hasTeammates) {
				toolPool = isReviewer
					? [...baseTools, ...REVIEWER_COLLAB_TOOL_DEFS]
					: [...baseTools, ...COLLAB_TOOL_DEFS];
			} else {
				toolPool = baseTools;
			}
		}

		const agentHandlers: AgentLoopHandlers = {
			onTextDelta: (text) => handlers.onDelta(text),
			onToolCall: (name, args, toolUseId) => {
				handlers.onToolCall?.(name, args, toolUseId);
				// Emit structured collab action when a collaboration tool is called
				if (isCollabTool(name) && handlers.onCollabAction) {
					const action = parseCollabAction(name, args);
					if (action) {
						handlers.onCollabAction(action);
					}
				}
			},
			onToolResult: (name, result, success, toolUseId) => {
				const preview = typeof result === 'string' ? result : '';
				handlers.onToolResult?.(name, success, toolUseId, preview);
			},
			onDone: (text) => {
				// The agent loop returns the full structured payload (JSON with tool parts).
				// For employee chat we only want the verbal text — tool details live in
				// the activity/timeline views, not in the chat bubble.
				const chatText = isStructuredAssistantMessage(text)
					? flattenAssistantTextPartsForSearch(text)
					: text;
				handlers.onDone(chatText);
			},
			onError: (msg) => handlers.onError(msg),
		};

		// CEO gets shorter timeout (coordination is fast) vs workers who need time for file ops
		const timeout = input.isCeo ? 120_000 : 300_000;
		const maxTokens = input.isCeo ? 4096 : 16384;

		const agentOptions: AgentLoopOptions = {
			requestModelId: resolved.requestModelId,
			paradigm: resolved.paradigm,
			requestApiKey: resolved.apiKey,
			requestBaseURL: resolved.baseURL,
			requestProxyUrl: resolved.proxyUrl,
			maxOutputTokens: Math.min(resolved.maxOutputTokens, maxTokens),
			signal: mergeWithTimeout(timeout, input.abortSignal),
			composerMode: 'agent',
			toolPoolOverride: toolPool,
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
				signal: mergeWithTimeout(120_000, input.abortSignal),
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
