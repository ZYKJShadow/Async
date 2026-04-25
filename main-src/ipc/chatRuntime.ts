import { BrowserWindow } from 'electron';
import {
	getSettings,
	resolveUsageStatsDataDir,
} from '../settingsStore.js';
import {
	appendMessage,
	getThread,
	updateLastAssistant,
	accumulateTokenUsage,
	touchFileInThread,
	saveSummary,
	saveTeamSession,
	getDeferredToolState,
	saveDeferredToolState,
	getToolResultReplacementState,
	saveToolResultReplacementState,
	getContextCompactState,
	saveContextCompactState,
	incrementThreadAgentToolCallCount,
	setThreadGeneratedTitle,
	type ChatMessage,
} from '../threadStore.js';
import { compressForSend } from '../agent/conversationCompress.js';
import { flattenAssistantTextPartsForSearch } from '../../src/agentStructuredMessage.js';
import { parseComposerMode, type ComposerMode } from '../llm/composerMode.js';
import { resolveModelRequest, resolveThinkingLevelForSelection } from '../llm/modelResolve.js';
import { preconnectLlmBaseUrlIfEligible } from '../llm/apiPreconnect.js';
import { scheduleRefreshOpenAiModelCapabilitiesIfStale } from '../llm/modelContext.js';
import { streamChatUnified } from '../llm/llmRouter.js';
import { formatLlmSdkError } from '../llm/formatLlmSdkError.js';
import { modeExpandsWorkspaceFileContext } from '../llm/workspaceContextExpand.js';
import { resolveMessagesForSend } from '../llm/sendResolved.js';
import { listAgentDiffChunks } from '../agent/applyAgentDiffs.js';
import { countLineChangesBetweenTexts } from '../diffLineCount.js';
import { recordAgentLineDelta, recordTokenUsageEvent } from '../workspaceUsageStats.js';
import { runAgentLoop, type AgentLoopOptions } from '../agent/agentLoop.js';
import { runTeamSession } from '../agent/teamOrchestrator.js';
import {
	createMistakeLimitReachedHandler,
	type MistakeLimitDecision,
} from '../agent/mistakeLimitGate.js';
import { createToolApprovalBeforeExecute } from '../agent/toolApprovalGate.js';
import { setPlanQuestionRuntime } from '../agent/planQuestionRuntime.js';
import { createRequestUserInputToolHandler } from '../agent/requestUserInputTool.js';
import { setPlanDraftRuntime } from '../agent/planDraftTool.js';
import { setDelegateContext, clearDelegateContext } from '../agent/toolExecutor.js';
import { getWorkspaceRootForWebContents } from '../workspace.js';
import { getWorkspaceLspManagerForWebContents } from '../lspSessionsByWebContents.js';
import { queueExtractMemories } from '../services/extractMemories/extractMemories.js';
import { generateThreadTitle } from '../threadTitle.js';
import type { WebContents } from 'electron';

/**
 * 主进程聊天运行时单例：把原 register.ts 里跨 IPC handler 共享的可变状态
 * （abort controllers、agent 写文件 snapshot、工具审批 / mistake 恢复 waiter、
 * thread 标题生成版本号）以及主管线 `runChatStream` 集中在一处。
 *
 * 拆分原则：
 *  - 这些状态都是"按 threadId 索引、跨多个 IPC handler 共享"的；放到模块顶层
 *    是最简单的单例形式，与原 register.ts 的语义完全一致。
 *  - `runChatStream` 是 `chat:sendMessage` / `chat:resend` / 三个 creator 模式
 *    （skill / rule / subagent）共用的同一段管线，故一并搬出。
 *
 * 不在这里：
 *  - preflight 流程的 abort 控制器（`preflightAbortByThread`）— 仅在 chat:* 几个
 *    handler 之间共享，等那几个 handler 一起迁移时再搬。
 */

export const abortByThread = new Map<string, AbortController>();
export const preflightAbortByThread = new Map<string, AbortController>();
export const agentRevertSnapshotsByThread = new Map<string, Map<string, string | null>>();
const threadTitleGenerationVersion = new Map<string, number>();

/** 工具执行前用户确认：approvalId → resolve(allowed) */
export const toolApprovalWaiters = new Map<string, (approved: boolean) => void>();
/** 连续失败后恢复：recoveryId → resolve(decision) */
export const mistakeLimitWaiters = new Map<string, (d: MistakeLimitDecision) => void>();

export function activeUsageStatsDir(): string | null {
	return resolveUsageStatsDataDir(getSettings());
}

export function recordTurnTokenUsageStats(
	modelSelection: string,
	mode: ComposerMode,
	usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
): void {
	recordTokenUsageEvent(activeUsageStatsDir(), {
		modelId: modelSelection,
		mode,
		input: usage?.inputTokens,
		output: usage?.outputTokens,
		cacheRead: usage?.cacheReadTokens,
		cacheWrite: usage?.cacheWriteTokens,
	});
}

export function persistAssistantStreamError(threadId: string, message: string): void {
	try {
		const lang = getSettings().language;
		const prefix = lang === 'en' ? 'Error: ' : '错误：';
		appendMessage(threadId, { role: 'assistant', content: `${prefix}${message}` });
	} catch (e) {
		console.warn('[chat:stream] persist assistant error failed:', e instanceof Error ? e.message : e);
	}
}

export function appendSystemBlock(base: string | undefined, block: string): string {
	const trimmed = block.trim();
	if (!trimmed) {
		return base ?? '';
	}
	return base && base.trim() ? `${base}\n\n---\n${trimmed}` : trimmed;
}

export function queueThreadTitleGeneration(params: {
	sender: WebContents;
	threadId: string;
	description: string;
	settings: ReturnType<typeof getSettings>;
	modelSelection: string;
	ruleContext?: string;
}): void {
	const description = String(params.description ?? '').trim();
	if (!description) {
		return;
	}
	const version = (threadTitleGenerationVersion.get(params.threadId) ?? 0) + 1;
	threadTitleGenerationVersion.set(params.threadId, version);
	void generateThreadTitle(
		params.settings,
		params.modelSelection,
		description,
		params.ruleContext ?? ''
	)
		.then((title) => {
			if (!title) {
				return;
			}
			if (threadTitleGenerationVersion.get(params.threadId) !== version) {
				return;
			}
			if (!setThreadGeneratedTitle(params.threadId, title)) {
				return;
			}
			try {
				params.sender.send('async-shell:chat', {
					type: 'thread_title_updated',
					threadId: params.threadId,
					title,
				});
			} catch {
				/* ignore */
			}
		})
		.catch(() => {
			/* ignore */
		})
		.finally(() => {
			if (threadTitleGenerationVersion.get(params.threadId) === version) {
				threadTitleGenerationVersion.delete(params.threadId);
			}
		});
}

export function resolveManagedAgentLoopOptions(
	settings: ReturnType<typeof getSettings>,
	workspaceRoot: string | null,
	workspaceLspManager: ReturnType<typeof getWorkspaceLspManagerForWebContents>,
	hostWebContentsId: number | null
): Omit<AgentLoopOptions, 'signal'> | null {
	const modelSelection = String(settings.defaultModel ?? '').trim();
	if (!modelSelection) {
		return null;
	}
	const resolved = resolveModelRequest(settings, modelSelection);
	if (!resolved.ok) {
		return null;
	}
	const thinkingLevel = resolveThinkingLevelForSelection(settings, modelSelection);
	return {
		modelSelection,
		requestModelId: resolved.requestModelId,
		paradigm: resolved.paradigm,
		requestApiKey: resolved.apiKey,
		requestBaseURL: resolved.baseURL,
		requestProxyUrl: resolved.proxyUrl,
		maxOutputTokens: resolved.maxOutputTokens,
		...(resolved.contextWindowTokens != null
			? { contextWindowTokens: resolved.contextWindowTokens }
			: {}),
		temperatureMode: resolved.temperatureMode,
		...(resolved.temperature != null ? { temperature: resolved.temperature } : {}),
		composerMode: 'agent',
		thinkingLevel,
		workspaceRoot,
		workspaceLspManager,
		hostWebContentsId,
	};
}

/**
 * 主聊天管线：根据 mode 选择 team / agent (含 plan) / 普通 streaming chat 三条路径。
 * 与原 register.ts:runChatStream 行为完全一致；abort、snapshot、approval waiter
 * 等共享状态也保持原语义。
 */
export function runChatStream(
	win: BrowserWindow,
	threadId: string,
	messages: ChatMessage[],
	mode: ReturnType<typeof parseComposerMode>,
	modelSelection: string,
	agentSystemAppend?: string,
	streamNonce?: number
): void {
	const send = (obj: unknown) => {
		const o = (typeof obj === 'object' && obj !== null ? obj : {}) as Record<string, unknown>;
		win.webContents.send(
			'async-shell:chat',
			streamNonce !== undefined ? { ...o, streamNonce } : o
		);
	};
	const emitStreamError = (message: string) => {
		console.error('[chat:stream]', threadId, message);
		persistAssistantStreamError(threadId, message);
		send({ threadId, type: 'error', message });
	};
	const prev = abortByThread.get(threadId);
	prev?.abort();
	agentRevertSnapshotsByThread.set(threadId, new Map());
	const ac = new AbortController();
	abortByThread.set(threadId, ac);

	void (async () => {
		try {
			const settings = getSettings();
			const workspaceRoot = getWorkspaceRootForWebContents(win.webContents);
			const workspaceLspManager = getWorkspaceLspManagerForWebContents(win.webContents);
			const thinkingLevel = resolveThinkingLevelForSelection(settings, modelSelection);
			const resolved = resolveModelRequest(settings, modelSelection);
			if (!resolved.ok) {
				emitStreamError(resolved.message);
				return;
			}

			// 首条对话前预热到当前模型 API 基址的 TCP/TLS（无代理时）
			preconnectLlmBaseUrlIfEligible({
				paradigm: resolved.paradigm,
				baseURL: resolved.baseURL,
				appProxyUrl: resolved.proxyUrl?.trim() || settings.openAI?.proxyUrl?.trim() || undefined,
			});

			// 发送端压缩：超长线程仅压缩发给 LLM 的副本，磁盘保留完整历史
			const thread = getThread(threadId);
			if (resolved.paradigm === 'openai-compatible') {
				scheduleRefreshOpenAiModelCapabilitiesIfStale({
					baseURL: resolved.baseURL,
					apiKey: resolved.apiKey,
					proxyUrl: resolved.proxyUrl,
				});
			}
			const compressOptions = {
				mode: mode as ComposerMode,
				signal: ac.signal,
				requestModelId: resolved.requestModelId,
				paradigm: resolved.paradigm,
				requestApiKey: resolved.apiKey,
				requestBaseURL: resolved.baseURL,
				requestProxyUrl: resolved.proxyUrl,
				maxOutputTokens: resolved.maxOutputTokens,
				...(resolved.contextWindowTokens != null
					? { contextWindowTokens: resolved.contextWindowTokens }
					: {}),
				temperatureMode: resolved.temperatureMode,
				...(resolved.temperature != null ? { temperature: resolved.temperature } : {}),
				thinkingLevel,
			};
			if (mode === 'team') {
				setPlanQuestionRuntime({
					threadId,
					signal: ac.signal,
					emit: (evt) => send({ threadId, ...evt }),
				});
				try {
					await runTeamSession({
						settings,
						threadId,
						messages,
						modelSelection,
						resolvedModel: resolved,
						agentSystemAppend,
						signal: ac.signal,
						thinkingLevel,
						workspaceRoot,
						workspaceLspManager,
						hostWebContentsId: win.webContents.id,
						deferredToolState: getDeferredToolState(threadId),
						onDeferredToolStateChange: (state) =>
							saveDeferredToolState(threadId, state),
						toolResultReplacementState: getToolResultReplacementState(threadId),
						onToolResultReplacementStateChange: (state) =>
							saveToolResultReplacementState(threadId, state),
						emit: (evt) => send(evt),
						onDone: (full, usage, teamSnapshot) => {
							updateLastAssistant(threadId, full);
							accumulateTokenUsage(threadId, usage?.inputTokens, usage?.outputTokens);
							recordTurnTokenUsageStats(modelSelection, mode, usage);
							if (teamSnapshot) {
								saveTeamSession(threadId, teamSnapshot);
							}
							queueExtractMemories({
								threadId,
								workspaceRoot,
								settings,
								modelSelection,
							});
							send({ threadId, type: 'done', text: full, usage });
						},
						onError: (message) => emitStreamError(message),
					});
				} finally {
					setPlanQuestionRuntime(null);
				}
				return;
			}

			const compressResult = await compressForSend(
				messages,
				settings,
				compressOptions,
				thread?.summary,
				thread?.summaryCoversMessageCount
			);
			let sendMessages = compressResult.messages;
			if (compressResult.newSummary && compressResult.newSummaryCoversCount !== undefined) {
				saveSummary(threadId, compressResult.newSummary, compressResult.newSummaryCoversCount);
			}

			if ((mode === 'agent' || mode === 'plan') && resolved.paradigm !== 'gemini') {
				const beforeExecuteTool = createToolApprovalBeforeExecute(
					send,
					threadId,
					ac.signal,
					() => getSettings().agent,
					toolApprovalWaiters
				);
				const onMistakeLimitReached = createMistakeLimitReachedHandler(
					send,
					threadId,
					ac.signal,
					mistakeLimitWaiters
				);
				const ag = getSettings().agent;
				const deferredToolState = getDeferredToolState(threadId);
				const toolResultReplacementState = getToolResultReplacementState(threadId);
				const customToolHandlers = {
					request_user_input: createRequestUserInputToolHandler({
						threadId,
						signal: ac.signal,
						emit: (evt) => send({ threadId, ...evt }),
						agentId: 'root',
						agentTitle: mode === 'plan' ? 'Plan Assistant' : 'Root Agent',
					}),
				};
				const agentOptions = {
					modelSelection,
					requestModelId: resolved.requestModelId,
					paradigm: resolved.paradigm,
					requestApiKey: resolved.apiKey,
					requestBaseURL: resolved.baseURL,
					requestProxyUrl: resolved.proxyUrl,
					maxOutputTokens: resolved.maxOutputTokens,
					...(resolved.contextWindowTokens != null
						? { contextWindowTokens: resolved.contextWindowTokens }
						: {}),
					temperatureMode: resolved.temperatureMode,
					...(resolved.temperature != null ? { temperature: resolved.temperature } : {}),
					signal: ac.signal,
					composerMode: mode,
					thinkingLevel,
					beforeExecuteTool,
					maxConsecutiveMistakes: ag?.maxConsecutiveMistakes,
					mistakeLimitEnabled: ag?.mistakeLimitEnabled,
					onMistakeLimitReached,
					customToolHandlers,
					workspaceRoot,
					workspaceLspManager,
					hostWebContentsId: win.webContents.id,
					deferredToolState,
					onDeferredToolStateChange: (state: ReturnType<typeof getDeferredToolState>) =>
						saveDeferredToolState(threadId, state),
					toolResultReplacementState,
					onToolResultReplacementStateChange: (state: ReturnType<typeof getToolResultReplacementState>) =>
						saveToolResultReplacementState(threadId, state),
				};
				try {
					setDelegateContext(
						settings,
						agentOptions,
						ac.signal,
						(evt) => send({ threadId, ...evt }),
						threadId,
						(evt) => send(evt),
						(payload) =>
							send({
								threadId,
								type: 'sub_agent_background_done',
								parentToolCallId: payload.parentToolCallId,
								agentId: payload.agentId,
								result: payload.result,
								success: payload.success,
							}),
						messages
					);
					if (mode === 'plan') {
						setPlanQuestionRuntime({
							threadId,
							signal: ac.signal,
							emit: (evt) => send({ threadId, ...evt }),
						});
						setPlanDraftRuntime(threadId, {
							onDraft: () => {
								// Renderer persists the visible draft from tool arguments and keeps the review UI in sync.
							},
						});
					}
					const expandMode = mode as ComposerMode;
					const doAtExpand = modeExpandsWorkspaceFileContext(expandMode);
					const messagesForAgent = doAtExpand
						? await resolveMessagesForSend(sendMessages, workspaceRoot)
						: sendMessages;
					await runAgentLoop(
						settings,
						messagesForAgent,
						{
							modelSelection,
							requestModelId: resolved.requestModelId,
							paradigm: resolved.paradigm,
							requestApiKey: resolved.apiKey,
							requestBaseURL: resolved.baseURL,
							requestProxyUrl: resolved.proxyUrl,
							maxOutputTokens: resolved.maxOutputTokens,
							...(resolved.contextWindowTokens != null
								? { contextWindowTokens: resolved.contextWindowTokens }
								: {}),
							temperatureMode: resolved.temperatureMode,
							...(resolved.temperature != null ? { temperature: resolved.temperature } : {}),
							signal: ac.signal,
							composerMode: mode,
							thinkingLevel,
							beforeExecuteTool,
							maxConsecutiveMistakes: ag?.maxConsecutiveMistakes,
							mistakeLimitEnabled: ag?.mistakeLimitEnabled,
							onMistakeLimitReached,
							customToolHandlers,
							workspaceRoot,
							workspaceLspManager,
							threadId,
							hostWebContentsId: win.webContents.id,
							deferredToolState,
							onDeferredToolStateChange: (state) =>
								saveDeferredToolState(threadId, state),
							toolResultReplacementState,
							onToolResultReplacementStateChange: (state) =>
								saveToolResultReplacementState(threadId, state),
							contextCompactState: getContextCompactState(threadId),
							onContextCompactStateChange: (state) =>
								saveContextCompactState(threadId, state),
							toolHooks: {
								beforeWrite: ({ path, previousContent }) => {
									const snapshots = agentRevertSnapshotsByThread.get(threadId);
									if (!snapshots || snapshots.has(path)) {
										touchFileInThread(threadId, path, 'modified', false);
										return;
									}
									snapshots.set(path, previousContent);
									touchFileInThread(
										threadId,
										path,
										previousContent === null ? 'created' : 'modified',
										previousContent === null
									);
								},
								...(mode === 'agent' && activeUsageStatsDir()
									? {
											afterWrite: ({ previousContent, nextContent }) => {
												const { additions, deletions } = countLineChangesBetweenTexts(previousContent, nextContent);
												recordAgentLineDelta(activeUsageStatsDir(), { add: additions, del: deletions });
											},
										}
									: {}),
							},
							...(agentSystemAppend?.trim() ? { agentSystemAppend: agentSystemAppend.trim() } : {}),
						},
						{
							onTextDelta: (piece) => send({ threadId, type: 'delta', text: piece }),
							onToolInputDelta: (p) =>
								send({ threadId, type: 'tool_input_delta', name: p.name, partialJson: p.partialJson, index: p.index }),
							onToolProgress: (p) =>
								send({ threadId, type: 'tool_progress', name: p.name, phase: p.phase, detail: p.detail }),
							onThinkingDelta: (text) => send({ threadId, type: 'thinking_delta', text }),
							onToolCall: (name, args, toolCallId) =>
								send({ threadId, type: 'tool_call', name, args: JSON.stringify(args), toolCallId }),
							onToolResult: (name, result, success, toolCallId) => {
								incrementThreadAgentToolCallCount(threadId);
								send({ threadId, type: 'tool_result', name, result, success, toolCallId });
							},
							onDone: (full, usage) => {
								updateLastAssistant(threadId, full);
								accumulateTokenUsage(threadId, usage?.inputTokens, usage?.outputTokens);
								recordTurnTokenUsageStats(modelSelection, mode, usage);
								queueExtractMemories({
									threadId,
									workspaceRoot,
									settings,
									modelSelection,
								});
								send({ threadId, type: 'done', text: full, usage });
							},
							onError: (message) => emitStreamError(message),
						}
					);
				} finally {
					clearDelegateContext();
					if (mode === 'plan') {
						setPlanQuestionRuntime(null);
						setPlanDraftRuntime(threadId, null);
					}
				}
				return;
			}

			await streamChatUnified(
				settings,
				sendMessages,
				{
					mode,
					signal: ac.signal,
					requestModelId: resolved.requestModelId,
					paradigm: resolved.paradigm,
					requestApiKey: resolved.apiKey,
					requestBaseURL: resolved.baseURL,
					requestProxyUrl: resolved.proxyUrl,
					maxOutputTokens: resolved.maxOutputTokens,
					temperatureMode: resolved.temperatureMode,
					...(resolved.temperature != null ? { temperature: resolved.temperature } : {}),
					thinkingLevel,
					workspaceRoot,
					...(agentSystemAppend?.trim() ? { agentSystemAppend: agentSystemAppend.trim() } : {}),
				},
				{
					onDelta: (piece) => send({ threadId, type: 'delta', text: piece }),
					onThinkingDelta: (text) => send({ threadId, type: 'thinking_delta', text }),
					onDone: (full, usage) => {
						updateLastAssistant(threadId, full);
						accumulateTokenUsage(threadId, usage?.inputTokens, usage?.outputTokens);
						recordTurnTokenUsageStats(modelSelection, mode, usage);
						queueExtractMemories({
							threadId,
							workspaceRoot,
							settings,
							modelSelection,
						});
						if (mode === 'agent') {
							const listed = listAgentDiffChunks(flattenAssistantTextPartsForSearch(full));
							if (listed.length > 0) {
								send({
									threadId,
									type: 'done',
									text: full,
									usage,
									pendingAgentPatches: listed.map((p, i) => ({
										id: `p-${i}`,
										relPath: p.relPath,
										chunk: p.chunk,
									})),
								});
								return;
							}
						}
						send({ threadId, type: 'done', text: full, usage });
					},
					onError: (message) => emitStreamError(message),
				}
			);
		} catch (e) {
			try {
				emitStreamError(formatLlmSdkError(e));
			} catch { /* window may be destroyed */ }
		} finally {
			abortByThread.delete(threadId);
		}
	})();
}
