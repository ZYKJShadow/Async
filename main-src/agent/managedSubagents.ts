import { randomUUID } from 'node:crypto';
import type { ChatMessage } from '../threadStore.js';
import {
	appendAgentTranscript,
	getAgentSession,
	getAgentTranscriptPath,
	saveAgentSession,
	type ThreadTokenUsage,
} from '../threadStore.js';
import type {
	AgentContextMode,
	AgentLifecycleStatus,
	AgentRunProfile,
	AgentSessionMessage,
	AgentSessionSnapshot,
	AgentSessionSnapshotAgent,
	AgentUserInputRequest,
} from '../../src/agentSessionTypes.js';
import type { ShellSettings } from '../settingsStore.js';
import type { NestedAgentStreamEmit } from '../ipc/nestedAgentStream.js';
import type { AgentLoopHandlers, AgentLoopOptions } from './agentLoop.js';
import { runAgentLoop } from './agentLoop.js';
import { assembleAgentToolPool } from './agentToolPool.js';
import { buildSubagentSystemAppend, findConfiguredSubagent, resolveSubagentProfile } from './subagentProfile.js';
import { ensureAgentMemoryDirExists, loadAgentMemoryPrompt } from './agentMemory.js';
import { buildRelevantMemoryContextBlock } from '../memdir/findRelevantMemories.js';
import { extractMemoriesToDir } from '../services/extractMemories/extractMemories.js';
import type { ToolExecutionHooks } from './toolExecutor.js';
import type { ToolCall, ToolResult } from './agentTools.js';
import { createRequestUserInputToolHandler } from './requestUserInputTool.js';

export type ManagedAgentUiEvent =
	| {
			threadId: string;
			type: 'agent_session_sync';
			session: AgentSessionSnapshot;
	  }
	| {
			threadId: string;
			type: 'sub_agent_background_done';
			parentToolCallId: string;
			agentId: string;
			result: string;
			success: boolean;
	  };

type ManagedAgentEmitter = (evt: ManagedAgentUiEvent) => void;

type ManagedAgentRuntime = {
	threadId: string;
	agentId: string;
	parentAgentId: string | null;
	parentToolCallId: string;
	title: string;
	subagentType?: string;
	runProfile: AgentRunProfile;
	background: boolean;
	contextMode: AgentContextMode;
	contextTurns: number | null;
	settings: ShellSettings;
	options: Omit<AgentLoopOptions, 'signal'>;
	toolHooks?: ToolExecutionHooks;
	baseMessages: ChatMessage[];
	messages: ChatMessage[];
	queuedInputs: ChatMessage[];
	nestedEmit?: (evt: NestedAgentStreamEmit) => void;
	emit?: ManagedAgentEmitter;
	runAbortController: AbortController | null;
	runPromise: Promise<void> | null;
	pendingUserInput: AgentUserInputRequest | null;
	lastUsage?: ThreadTokenUsage;
	lastError: string | null;
	closedAt: number | null;
	startedAt: number;
	updatedAt: number;
};

export type ManagedAgentSpawnContext = {
	threadId: string;
	parentToolCallId: string;
	parentAgentId?: string | null;
	task: string;
	context: string;
	subagentType?: string;
	background: boolean;
	settings: ShellSettings;
	options: Omit<AgentLoopOptions, 'signal'>;
	toolHooks?: ToolExecutionHooks;
	nestedEmit?: (evt: NestedAgentStreamEmit) => void;
	emit?: ManagedAgentEmitter;
	parentMessages?: ChatMessage[];
	forkContext?: boolean;
};

type ManagedAgentWaitStatus = {
	agentId: string;
	status: AgentLifecycleStatus | 'not_found';
	lastResultSummary: string;
};

const runtimes = new Map<string, ManagedAgentRuntime>();
const threadAgentIds = new Map<string, Set<string>>();
const waitersByAgentId = new Map<string, Set<(status: ManagedAgentWaitStatus) => void>>();

function ensureThreadAgentIds(threadId: string): Set<string> {
	const current = threadAgentIds.get(threadId);
	if (current) {
		return current;
	}
	const next = new Set<string>();
	threadAgentIds.set(threadId, next);
	return next;
}

function toSessionMessage(message: ChatMessage): AgentSessionMessage {
	return { role: message.role, content: message.content };
}

function summaryText(raw: string): string {
	const text = String(raw ?? '').replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();
	if (!text) {
		return '';
	}
	const first = text.split('\n')[0]?.trim() ?? '';
	return first.length > 160 ? `${first.slice(0, 160)}…` : first;
}

function agentTitleForTask(task: string, subagentType?: string): string {
	const first = String(task ?? '').replace(/\r/g, '').split('\n')[0]?.trim() ?? '';
	if (first) {
		return first.length > 72 ? `${first.slice(0, 72)}…` : first;
	}
	return subagentType?.trim() || 'Agent';
}

function snapshotFromRuntime(runtime: ManagedAgentRuntime): AgentSessionSnapshotAgent {
	return {
		id: runtime.agentId,
		parentAgentId: runtime.parentAgentId,
		parentToolCallId: runtime.parentToolCallId,
		title: runtime.title,
		subagentType: runtime.subagentType,
		runProfile: runtime.runProfile,
		background: runtime.background,
		status: runtime.closedAt
			? 'closed'
			: runtime.pendingUserInput
				? 'waiting_input'
				: runtime.runPromise
					? 'running'
					: inferStoppedStatus(runtime),
		lastOutputSummary: summaryText(
			runtime.messages
				.filter((message) => message.role === 'assistant')
				.map((message) => message.content)
				.slice(-1)[0] ?? ''
		),
		lastInputSummary: summaryText(
			runtime.messages
				.filter((message) => message.role === 'user')
				.map((message) => message.content)
				.slice(-1)[0] ?? ''
		),
		lastResultSummary: summaryText(runtime.lastError ?? runtime.messages[runtime.messages.length - 1]?.content ?? ''),
		transcriptPath: getAgentTranscriptPath(runtime.threadId, runtime.agentId),
		startedAt: runtime.startedAt,
		updatedAt: runtime.updatedAt,
		closedAt: runtime.closedAt,
		contextMode: runtime.contextMode,
		contextTurns: runtime.contextTurns,
		childAgentIds: collectChildAgentIds(runtime.threadId, runtime.agentId),
		lastError: runtime.lastError,
		messages: runtime.messages.map(toSessionMessage),
	};
}

function inferStoppedStatus(runtime: ManagedAgentRuntime): AgentLifecycleStatus {
	if (runtime.closedAt) {
		return 'closed';
	}
	if (runtime.pendingUserInput) {
		return 'waiting_input';
	}
	if (runtime.lastError) {
		return 'failed';
	}
	const last = runtime.messages[runtime.messages.length - 1];
	return last?.role === 'assistant' ? 'completed' : 'completed';
}

function findPendingUserInput(threadId: string): AgentUserInputRequest | null {
	for (const agentId of ensureThreadAgentIds(threadId)) {
		const runtime = runtimes.get(agentId);
		if (runtime?.pendingUserInput) {
			return {
				...runtime.pendingUserInput,
				questions: runtime.pendingUserInput.questions.map((question) => ({
					...question,
					options: question.options.map((option) => ({ ...option })),
				})),
			};
		}
	}
	return null;
}

function getPersistedSession(threadId: string): AgentSessionSnapshot {
	return (
		getAgentSession(threadId) ?? {
			agents: {},
			pendingUserInput: null,
		}
	);
}

function collectChildAgentIds(threadId: string, parentAgentId: string): string[] {
	const ids = ensureThreadAgentIds(threadId);
	const out: string[] = [];
	for (const agentId of ids) {
		const runtime = runtimes.get(agentId);
		const snapshot = runtime ? snapshotFromRuntime(runtime) : getPersistedSession(threadId).agents[agentId];
		if (snapshot?.parentAgentId === parentAgentId) {
			out.push(agentId);
		}
	}
	return out;
}

function persistThreadSession(threadId: string, emit?: ManagedAgentEmitter): AgentSessionSnapshot {
	const next: AgentSessionSnapshot = {
		agents: { ...getPersistedSession(threadId).agents },
		pendingUserInput: findPendingUserInput(threadId),
	};
	for (const agentId of ensureThreadAgentIds(threadId)) {
		const runtime = runtimes.get(agentId);
		if (!runtime) {
			continue;
		}
		next.agents[agentId] = snapshotFromRuntime(runtime);
	}
	saveAgentSession(threadId, next);
	emit?.({ threadId, type: 'agent_session_sync', session: next });
	return next;
}

function notifyWaiters(agentId: string): void {
	const listeners = waitersByAgentId.get(agentId);
	if (!listeners || listeners.size === 0) {
		return;
	}
	const runtime = runtimes.get(agentId);
	const status: ManagedAgentWaitStatus = runtime
		? {
				agentId,
				status: snapshotFromRuntime(runtime).status,
				lastResultSummary: snapshotFromRuntime(runtime).lastResultSummary,
			}
		: {
				agentId,
				status: 'not_found',
				lastResultSummary: '',
			};
	for (const listener of [...listeners]) {
		listener(status);
	}
}

function buildInitialMessages(task: string, context: string, parentMessages: ChatMessage[] | undefined, forkContext: boolean): ChatMessage[] {
	const next: ChatMessage[] = [];
	if (forkContext && Array.isArray(parentMessages) && parentMessages.length > 0) {
		next.push(...parentMessages.filter((message) => message.role === 'user' || message.role === 'assistant'));
	}
	next.push({
		role: 'user',
		content: context ? `${task}\n\nContext:\n${context}` : task,
	});
	return next;
}

export function spawnManagedAgent(ctx: ManagedAgentSpawnContext): ManagedAgentRuntime {
	const agentId = randomUUID();
	const runProfile = resolveSubagentProfile(ctx.subagentType);
	const messages = buildInitialMessages(ctx.task, ctx.context, ctx.parentMessages, Boolean(ctx.forkContext));
	const runtime: ManagedAgentRuntime = {
		threadId: ctx.threadId,
		agentId,
		parentAgentId: ctx.parentAgentId ?? null,
		parentToolCallId: ctx.parentToolCallId,
		title: agentTitleForTask(ctx.task, ctx.subagentType),
		subagentType: ctx.subagentType,
		runProfile,
		background: ctx.background,
		contextMode: ctx.forkContext ? 'full' : 'none',
		contextTurns: null,
		settings: ctx.settings,
		options: ctx.options,
		toolHooks: ctx.toolHooks,
		baseMessages: messages.map((message) => ({ ...message })),
		messages: messages.map((message) => ({ ...message })),
		queuedInputs: [],
		nestedEmit: ctx.nestedEmit,
		emit: ctx.emit,
		runAbortController: null,
		runPromise: null,
		pendingUserInput: null,
		lastUsage: undefined,
		lastError: null,
		closedAt: null,
		startedAt: Date.now(),
		updatedAt: Date.now(),
	};
	runtimes.set(agentId, runtime);
	ensureThreadAgentIds(ctx.threadId).add(agentId);
	persistThreadSession(ctx.threadId, ctx.emit);
	return runtime;
}

async function runManagedAgent(runtime: ManagedAgentRuntime): Promise<void> {
	if (runtime.runPromise || runtime.closedAt) {
		return;
	}

	const abortController = new AbortController();
	runtime.runAbortController = abortController;
	runtime.lastError = null;
	const matchedSubagent = findConfiguredSubagent(runtime.settings, runtime.subagentType);
	const subAppend = buildSubagentSystemAppend(runtime.settings, runtime.subagentType);
	const baseToolDefs = assembleAgentToolPool(runtime.runProfile === 'explore' ? 'plan' : runtime.options.composerMode, {
		mcpToolDenyPrefixes: runtime.settings.mcpToolDenyPrefixes,
	}).filter((tool) => tool.name !== 'Agent' && tool.name !== 'Task');

	const runPromise = (async () => {
		let output = '';
		let errorMsg = '';
		let agentMemoryAppend = '';
		let agentMemoryDir: string | null = null;
		if (matchedSubagent?.memoryScope && runtime.subagentType) {
			try {
				const subWs = runtime.options.workspaceRoot ?? null;
				agentMemoryDir = await ensureAgentMemoryDirExists(runtime.subagentType, matchedSubagent.memoryScope, subWs);
				agentMemoryAppend =
					loadAgentMemoryPrompt(runtime.subagentType, matchedSubagent.memoryScope, subWs)?.trim() ?? '';
			} catch {
				agentMemoryAppend = '';
				agentMemoryDir = null;
			}
		}
		let relevantAgentMemories = '';
		if (agentMemoryDir) {
			try {
				const query = runtime.messages
					.filter((message) => message.role !== 'system')
					.map((message) => message.content)
					.slice(-3)
					.join('\n\n')
					.trim();
				relevantAgentMemories =
					(await buildRelevantMemoryContextBlock({
						query,
						settings: runtime.settings,
						modelSelection: runtime.options.modelSelection ?? '',
						memoryDirOverride: agentMemoryDir,
						label: 'Relevant agent memories',
						signal: abortController.signal,
					})) ?? '';
			} catch {
				relevantAgentMemories = '';
			}
		}
		const mergedAppend = [
			runtime.options.agentSystemAppend?.trim(),
			subAppend?.trim(),
			agentMemoryAppend,
			relevantAgentMemories.trim(),
		]
			.filter(Boolean)
			.join('\n\n');
		const customToolHandlers = {
			...runtime.options.customToolHandlers,
			request_user_input: createRequestUserInputToolHandler({
				threadId: runtime.threadId,
				signal: abortController.signal,
				emit: (evt) => {
					runtime.emit?.({ threadId: runtime.threadId, ...evt });
				},
				agentId: runtime.agentId,
				agentTitle: runtime.title,
				onPendingChange: (request) => {
					runtime.pendingUserInput = request;
					runtime.updatedAt = Date.now();
					persistThreadSession(runtime.threadId, runtime.emit);
				},
			}),
		};
		const handlers: AgentLoopHandlers = {
			onTextDelta: (text) => {
				output += text;
				runtime.updatedAt = Date.now();
				appendAgentTranscript(runtime.threadId, runtime.agentId, text);
				runtime.nestedEmit?.({
					type: 'delta',
					text,
					parentToolCallId: runtime.parentToolCallId,
					nestingDepth: 1,
				});
			},
			onToolInputDelta: (payload) => {
				runtime.nestedEmit?.({
					type: 'tool_input_delta',
					name: payload.name,
					partialJson: payload.partialJson,
					index: payload.index,
					parentToolCallId: runtime.parentToolCallId,
					nestingDepth: 1,
				});
			},
			onThinkingDelta: (text) => {
				runtime.updatedAt = Date.now();
				appendAgentTranscript(runtime.threadId, runtime.agentId, text);
				runtime.nestedEmit?.({
					type: 'thinking_delta',
					text,
					parentToolCallId: runtime.parentToolCallId,
					nestingDepth: 1,
				});
			},
			onToolCall: (name, args, toolUseId) => {
				runtime.updatedAt = Date.now();
				appendAgentTranscript(runtime.threadId, runtime.agentId, `\n[tool] ${name} ${JSON.stringify(args).slice(0, 200)}\n`);
				runtime.nestedEmit?.({
					type: 'tool_call',
					name,
					args: JSON.stringify(args),
					toolCallId: toolUseId,
					parentToolCallId: runtime.parentToolCallId,
					nestingDepth: 1,
				});
			},
			onToolResult: (name, result, success, toolUseId) => {
				runtime.updatedAt = Date.now();
				appendAgentTranscript(runtime.threadId, runtime.agentId, `\n[result] ${name} success=${success}\n`);
				runtime.nestedEmit?.({
					type: 'tool_result',
					name,
					result,
					success,
					toolCallId: toolUseId,
					parentToolCallId: runtime.parentToolCallId,
					nestingDepth: 1,
				});
			},
			onToolProgress: (payload) => {
				runtime.updatedAt = Date.now();
				runtime.nestedEmit?.({
					type: 'tool_progress',
					name: payload.name,
					phase: payload.phase,
					detail: payload.detail,
					parentToolCallId: runtime.parentToolCallId,
					nestingDepth: 1,
				});
			},
			onDone: (_fullContent, usage) => {
				runtime.lastUsage = usage
					? {
							totalInput: usage.inputTokens ?? 0,
							totalOutput: usage.outputTokens ?? 0,
						}
					: runtime.lastUsage;
			},
			onError: (message) => {
				errorMsg = message;
			},
		};

		try {
			await runAgentLoop(
				runtime.settings,
				runtime.messages,
				{
					...runtime.options,
					signal: abortController.signal,
					composerMode: runtime.runProfile === 'explore' ? 'plan' : runtime.options.composerMode,
					toolPoolOverride: baseToolDefs,
					customToolHandlers,
					delegateExecutionDepth: 1,
					toolHooks:
						runtime.runProfile === 'full' || !runtime.toolHooks
							? runtime.toolHooks
							: { ...runtime.toolHooks, afterWrite: undefined },
					...(mergedAppend ? { agentSystemAppend: mergedAppend } : {}),
				},
				handlers
			);
			if (output) {
				runtime.messages.push({ role: 'assistant', content: output || '(sub-agent completed with no output)' });
			}
			runtime.updatedAt = Date.now();
			if (!errorMsg && agentMemoryDir && !abortController.signal.aborted) {
				await extractMemoriesToDir({
					memoryDir: agentMemoryDir,
					workspaceRootForEntrypoint: null,
					messages: runtime.messages,
					runtimeModel: {
						requestModelId: runtime.options.requestModelId,
						paradigm: runtime.options.paradigm,
						requestApiKey: runtime.options.requestApiKey,
						requestBaseURL: runtime.options.requestBaseURL,
						requestProxyUrl: runtime.options.requestProxyUrl,
						thinkingLevel: runtime.options.thinkingLevel,
					},
				});
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				errorMsg = runtime.closedAt ? 'Closed by user.' : 'Interrupted.';
			} else {
				errorMsg = error instanceof Error ? error.message : String(error);
			}
		} finally {
			runtime.runAbortController = null;
			runtime.runPromise = null;
			if (errorMsg) {
				runtime.lastError = errorMsg;
			}
			if (!runtime.closedAt && runtime.queuedInputs.length === 0 && !errorMsg) {
				runtime.lastError = null;
			}
			persistThreadSession(runtime.threadId, runtime.emit);
			notifyWaiters(runtime.agentId);

			if (runtime.queuedInputs.length > 0 && !runtime.closedAt) {
				runtime.messages.push(...runtime.queuedInputs.splice(0, runtime.queuedInputs.length));
				persistThreadSession(runtime.threadId, runtime.emit);
				void runManagedAgent(runtime);
				return;
			}

			if (runtime.background) {
				runtime.emit?.({
					threadId: runtime.threadId,
					type: 'sub_agent_background_done',
					parentToolCallId: runtime.parentToolCallId,
					agentId: runtime.agentId,
					result: errorMsg ? `Sub-agent error: ${errorMsg}` : output || '(sub-agent completed with no output)',
					success: !errorMsg,
				});
			}
		}
	})();

	runtime.runPromise = runPromise;
	persistThreadSession(runtime.threadId, runtime.emit);
	notifyWaiters(runtime.agentId);
	await runPromise;
}

export async function startManagedAgent(runtime: ManagedAgentRuntime): Promise<void> {
	await runManagedAgent(runtime);
}

function getRuntime(agentId: string): ManagedAgentRuntime | null {
	return runtimes.get(agentId) ?? null;
}

function hydrateRuntimeFromSnapshot(
	threadId: string,
	agentId: string,
	settings: ShellSettings,
	options: Omit<AgentLoopOptions, 'signal'>,
	emit?: ManagedAgentEmitter
): ManagedAgentRuntime | null {
	const snapshot = getPersistedSession(threadId).agents[agentId];
	if (!snapshot) {
		return null;
	}
	const persistedSession = getPersistedSession(threadId);
	const runtime: ManagedAgentRuntime = {
		threadId,
		agentId,
		parentAgentId: snapshot.parentAgentId,
		parentToolCallId: snapshot.parentToolCallId,
		title: snapshot.title,
		subagentType: snapshot.subagentType,
		runProfile: snapshot.runProfile,
		background: snapshot.background,
		contextMode: snapshot.contextMode,
		contextTurns: snapshot.contextTurns,
		settings,
		options,
		toolHooks: options.toolHooks,
		baseMessages: snapshot.messages.map((message) => ({ ...message })),
		messages: snapshot.messages.map((message) => ({ ...message })),
		queuedInputs: [],
		nestedEmit: undefined,
		emit,
		runAbortController: null,
		runPromise: null,
		lastUsage: undefined,
		pendingUserInput:
			persistedSession.pendingUserInput?.agentId === agentId
				? persistedSession.pendingUserInput
				: null,
		lastError: snapshot.lastError,
		closedAt: snapshot.closedAt,
		startedAt: snapshot.startedAt,
		updatedAt: snapshot.updatedAt,
	};
	runtimes.set(agentId, runtime);
	ensureThreadAgentIds(threadId).add(agentId);
	return runtime;
}

export async function sendInputToManagedAgent(params: {
	threadId: string;
	agentId: string;
	message: string;
	interrupt?: boolean;
	settings: ShellSettings;
	options: Omit<AgentLoopOptions, 'signal'>;
	emit?: ManagedAgentEmitter;
}): Promise<{ ok: true } | { ok: false; error: string }> {
	const text = params.message.trim();
	if (!text) {
		return { ok: false, error: 'Message is required.' };
	}
	let runtime = getRuntime(params.agentId);
	if (!runtime) {
		runtime = hydrateRuntimeFromSnapshot(params.threadId, params.agentId, params.settings, params.options, params.emit);
	}
	if (!runtime) {
		return { ok: false, error: 'Agent not found.' };
	}
	runtime.emit = params.emit ?? runtime.emit;
	if (runtime.closedAt) {
		return { ok: false, error: 'Agent is closed.' };
	}
	runtime.pendingUserInput = null;
	const nextMessage: ChatMessage = { role: 'user', content: text };
	if (runtime.runPromise) {
		if (params.interrupt) {
			runtime.queuedInputs.push(nextMessage);
			runtime.runAbortController?.abort();
		} else {
			runtime.queuedInputs.push(nextMessage);
		}
		persistThreadSession(runtime.threadId, runtime.emit);
		return { ok: true };
	}
	runtime.messages.push(nextMessage);
	runtime.updatedAt = Date.now();
	persistThreadSession(runtime.threadId, runtime.emit);
	void runManagedAgent(runtime);
	return { ok: true };
}

export async function resumeManagedAgent(params: {
	threadId: string;
	agentId: string;
	settings: ShellSettings;
	options: Omit<AgentLoopOptions, 'signal'>;
	emit?: ManagedAgentEmitter;
}): Promise<{ ok: true } | { ok: false; error: string }> {
	let runtime = getRuntime(params.agentId);
	if (!runtime) {
		runtime = hydrateRuntimeFromSnapshot(params.threadId, params.agentId, params.settings, params.options, params.emit);
	}
	if (!runtime) {
		return { ok: false, error: 'Agent not found.' };
	}
	runtime.emit = params.emit ?? runtime.emit;
	runtime.closedAt = null;
	runtime.pendingUserInput = null;
	runtime.updatedAt = Date.now();
	if (runtime.runPromise) {
		return { ok: true };
	}
	void runManagedAgent(runtime);
	return { ok: true };
}

export function closeManagedAgent(params: {
	threadId: string;
	agentId: string;
	emit?: ManagedAgentEmitter;
}): { ok: true } | { ok: false; error: string } {
	const runtime = getRuntime(params.agentId);
	if (!runtime) {
		return { ok: false, error: 'Agent not found.' };
	}
	runtime.emit = params.emit ?? runtime.emit;
	runtime.closedAt = Date.now();
	runtime.updatedAt = runtime.closedAt;
	runtime.pendingUserInput = null;
	runtime.queuedInputs.length = 0;
	runtime.runAbortController?.abort();
	persistThreadSession(runtime.threadId, runtime.emit);
	notifyWaiters(runtime.agentId);
	for (const childId of collectChildAgentIds(params.threadId, params.agentId)) {
		closeManagedAgent({ threadId: params.threadId, agentId: childId, emit: params.emit });
	}
	return { ok: true };
}

export async function waitForManagedAgents(
	threadId: string,
	agentIds: string[],
	timeoutMs: number
): Promise<Record<string, ManagedAgentWaitStatus>> {
	const out: Record<string, ManagedAgentWaitStatus> = {};
	const pending = agentIds.filter(Boolean);
	if (pending.length === 0) {
		return out;
	}
	const settled = new Set<string>();
	for (const agentId of pending) {
		const runtime = getRuntime(agentId);
		const status = runtime ? snapshotFromRuntime(runtime).status : getPersistedSession(threadId).agents[agentId]?.status;
		if (!runtime || !runtime.runPromise || status === 'completed' || status === 'failed' || status === 'closed') {
			const snapshot = runtime ? snapshotFromRuntime(runtime) : getPersistedSession(threadId).agents[agentId];
			out[agentId] = snapshot
				? {
						agentId,
						status: snapshot.status,
						lastResultSummary: snapshot.lastResultSummary,
					}
				: { agentId, status: 'not_found', lastResultSummary: '' };
			settled.add(agentId);
		}
	}
	if (settled.size === pending.length) {
		return out;
	}
	await new Promise<void>((resolve) => {
		const cleanup = () => {
			for (const agentId of pending) {
				const listeners = waitersByAgentId.get(agentId);
				if (!listeners) {
					continue;
				}
				for (const listener of [...listeners]) {
					if ((listener as unknown as { __wait_marker?: string }).__wait_marker === marker) {
						listeners.delete(listener);
					}
				}
				if (listeners.size === 0) {
					waitersByAgentId.delete(agentId);
				}
			}
		};
		const finish = () => {
			cleanup();
			resolve();
		};
		const timer = setTimeout(finish, Math.max(1000, timeoutMs));
		const marker = randomUUID();
		for (const agentId of pending) {
			if (settled.has(agentId)) {
				continue;
			}
			const listener = ((status: ManagedAgentWaitStatus) => {
				out[agentId] = status;
				settled.add(agentId);
				if (settled.size === pending.length) {
					clearTimeout(timer);
					finish();
				}
			}) as ((status: ManagedAgentWaitStatus) => void) & { __wait_marker?: string };
			listener.__wait_marker = marker;
			const listeners = waitersByAgentId.get(agentId) ?? new Set();
			listeners.add(listener);
			waitersByAgentId.set(agentId, listeners);
		}
	});
	return out;
}

export function getManagedAgentSession(threadId: string): AgentSessionSnapshot | null {
	const ids = ensureThreadAgentIds(threadId);
	if (ids.size === 0) {
		return getAgentSession(threadId);
	}
	return persistThreadSession(threadId);
}

export function attachManagedAgentEmitter(threadId: string, emit: ManagedAgentEmitter): void {
	for (const agentId of ensureThreadAgentIds(threadId)) {
		const runtime = runtimes.get(agentId);
		if (runtime) {
			runtime.emit = emit;
		}
	}
	const snapshot = getManagedAgentSession(threadId);
	if (snapshot) {
		emit({ threadId, type: 'agent_session_sync', session: snapshot });
	}
}

export function getManagedAgentTranscriptPath(threadId: string, agentId: string): string | null {
	return getAgentTranscriptPath(threadId, agentId);
}
