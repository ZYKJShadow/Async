import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
} from 'react';
import type { ComposerMode } from '../ComposerPlusMenu';
import type { TeamSettings } from '../agentSettingsTypes';
import { userMessageToSegments, type ComposerSegment } from '../composerSegments';
import { applyLiveAgentChatPayload, type LiveAgentBlocksState } from '../liveAgentBlocks';
import type { UserModelEntry } from '../modelCatalog';
import {
	type AgentPendingPatch,
	type ChatPlanExecutePayload,
	type ChatStreamPayload,
	type TurnTokenUsage,
} from '../ipcTypes';
import type { AgentSessionSnapshot, AgentUserInputRequest } from '../agentSessionTypes';
import { parseQuestions, parsePlanDocument, toPlanMd, generatePlanFilename, type ParsedPlan, type PlanQuestion } from '../planParser';
import { findTeamRolesMissingModels } from '../teamModelValidation';
import { flattenAssistantTextPartsForSearch } from '../agentStructuredMessage';
import { clearPersistedAgentFileChanges } from '../agentFileChangesPersist';
import { translateChatError, type TFunction } from '../i18n';
import type { ChatMessage } from '../threadTypes';
import {
	normalizePlanDraftSubmission,
	planDraftToParsedPlan,
	planDraftToThreadPlan,
} from '../planDraft';

export type StreamingToast = {
	key: number;
	ok: boolean;
	text: string;
	threadId?: string;
	agentId?: string;
} | null;

export type StreamingSendOptions = {
	threadId?: string;
	modeOverride?: ComposerMode;
	modelIdOverride?: string;
	planExecute?: ChatPlanExecutePayload;
	planBuildPathKey?: string;
};

type StreamingSendRuntime = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	currentId: string | null;
	setCurrentId: (id: string) => void;
	loadMessages: (threadId: string) => Promise<unknown>;
	refreshThreads: () => Promise<unknown> | void;
	restoreAgentSession: (threadId: string, snapshot: AgentSessionSnapshot | null | undefined) => void;
	defaultModel: string;
	composerMode: ComposerMode;
	teamSettings?: TeamSettings;
	modelEntries: UserModelEntry[];
	resendFromUserIndex: number | null;
	setResendFromUserIndex: Dispatch<SetStateAction<number | null>>;
	setInlineResendSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	setComposerSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
	setStreamingThinking: Dispatch<SetStateAction<string>>;
	clearStreamingToolPreviewNow: () => void;
	resetLiveAgentBlocks: () => void;
	beginStream: (threadId: string) => number;
	resetStreamingSession: (options?: { clearThread?: boolean }) => void;
	clearInFlightIpcRouting: (threadId?: string | null) => void;
	ipcInFlightChatThreadIdRef: MutableRefObject<string | null>;
	offThreadStreamDraftsRef: MutableRefObject<Record<string, { streaming: string; streamingThinking: string }>>;
	flashComposerAttachErr: (msg: string) => void;
	t: TFunction;
	clearAgentReviewForThread: (threadId: string) => void;
	clearRootUserInputRequest: (threadId?: string | null) => void;
	startTeamSession: (threadId: string, userRequest: string) => void;
	clearPlanQuestion: () => void;
	clearMistakeLimitRequest: () => void;
	planBuildPendingMarkerRef: MutableRefObject<{ threadId: string; pathKey: string } | null>;
	setAwaitingReply: Dispatch<SetStateAction<boolean>>;
	streamStartedAtRef: MutableRefObject<number | null>;
};

type StreamingSubscriptionRuntime = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	composerMode: ComposerMode;
	streamThreadRef: MutableRefObject<string | null>;
	ipcInFlightChatThreadIdRef: MutableRefObject<string | null>;
	ipcStreamNonceRef: MutableRefObject<number>;
	offThreadStreamDraftsRef: MutableRefObject<Record<string, { streaming: string; streamingThinking: string }>>;
	streamingToolPreviewClearTimerRef: MutableRefObject<number | null>;
	setStreamingToolPreview: Dispatch<
		SetStateAction<{ name: string; partialJson: string; index: number } | null>
	>;
	setLiveAssistantBlocks: Dispatch<SetStateAction<LiveAgentBlocksState>>;
	markFirstToken: () => void;
	setStreaming: Dispatch<SetStateAction<string>>;
	setStreamingThinking: Dispatch<SetStateAction<string>>;
	setToolApprovalRequest: Dispatch<
		SetStateAction<{ approvalId: string; toolName: string; command?: string; path?: string } | null>
	>;
	setRootUserInputRequest: (threadId: string, request: AgentUserInputRequest | null) => void;
	clearRootUserInputRequest: (threadId?: string | null) => void;
	setPlanQuestion: Dispatch<SetStateAction<PlanQuestion | null>>;
	setPlanQuestionRequestId: Dispatch<SetStateAction<string | null>>;
	setMistakeLimitRequest: Dispatch<
		SetStateAction<{ recoveryId: string; consecutiveFailures: number; threshold: number } | null>
	>;
	t: TFunction;
	showTransientToast: (
		ok: boolean,
		text: string,
		durationMs?: number,
		extra?: { threadId?: string; agentId?: string }
	) => void;
	restoreAgentSession: (threadId: string, snapshot: AgentSessionSnapshot | null | undefined) => void;
	recordThoughtSeconds: (threadId: string, fallbackSeconds: number) => number;
	setLastTurnUsage: Dispatch<SetStateAction<TurnTokenUsage | null>>;
	resetStreamingSession: (options?: { clearThread?: boolean }) => void;
	clearStreamingToolPreviewNow: () => void;
	resetLiveAgentBlocks: () => void;
	setFileChangesDismissed: Dispatch<SetStateAction<boolean>>;
	setDismissedFiles: Dispatch<SetStateAction<Set<string>>>;
	planBuildPendingMarkerRef: MutableRefObject<{ threadId: string; pathKey: string } | null>;
	currentIdRef: MutableRefObject<string | null>;
	setExecutedPlanKeys: Dispatch<SetStateAction<string[]>>;
	setAgentReviewPendingByThread: Dispatch<SetStateAction<Record<string, AgentPendingPatch[]>>>;
	setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
	setParsedPlan: Dispatch<SetStateAction<ParsedPlan | null>>;
	setPlanFilePath: Dispatch<SetStateAction<string | null>>;
	setPlanFileRelPath: Dispatch<SetStateAction<string | null>>;
	loadMessages: (threadId: string) => Promise<unknown>;
	refreshThreads: () => Promise<unknown> | void;
	applyTeamPayload: (payload: ChatStreamPayload) => void;
};

function escapeSubAgentXmlText(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeStreamAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function useStreamingChat() {
	const [streaming, setStreaming] = useState('');
	const [awaitingReply, setAwaitingReply] = useState(false);
	// 改为 ref 避免每秒 10 次重渲染
	const thinkingTickRef = useRef(0);
	const [thoughtSecondsByThread, setThoughtSecondsByThread] = useState<Record<string, number>>({});
	const [subAgentBgToast, setSubAgentBgToast] = useState<StreamingToast>(null);

	const subAgentBgToastTimerRef = useRef<number | null>(null);
	const streamThreadRef = useRef<string | null>(null);
	/** 与主进程流式 IPC 路由：切工作区时勿清空，否则后台仍在跑但前端丢事件 */
	const ipcInFlightChatThreadIdRef = useRef<string | null>(null);
	/** 每次 beginStream 递增，与主进程回包 streamNonce 对齐，丢弃上一轮迟到的 done/error */
	const ipcStreamNonceRef = useRef(0);
	const offThreadStreamDraftsRef = useRef<Record<string, { streaming: string; streamingThinking: string }>>({});
	const streamStartedAtRef = useRef<number | null>(null);
	const firstTokenAtRef = useRef<number | null>(null);

	const clearToastTimer = useCallback(() => {
		if (subAgentBgToastTimerRef.current !== null) {
			window.clearTimeout(subAgentBgToastTimerRef.current);
			subAgentBgToastTimerRef.current = null;
		}
	}, []);

	const showTransientToast = useCallback(
		(ok: boolean, text: string, durationMs = 4200, extra?: { threadId?: string; agentId?: string }) => {
			clearToastTimer();
			setSubAgentBgToast((prev) => ({
				key: (prev?.key ?? 0) + 1,
				ok,
				text,
				threadId: extra?.threadId,
				agentId: extra?.agentId,
			}));
			subAgentBgToastTimerRef.current = window.setTimeout(() => {
				setSubAgentBgToast(null);
				subAgentBgToastTimerRef.current = null;
			}, durationMs);
		},
		[clearToastTimer]
	);

	const beginStream = useCallback((threadId: string) => {
		streamThreadRef.current = threadId;
		ipcInFlightChatThreadIdRef.current = threadId;
		streamStartedAtRef.current = Date.now();
		firstTokenAtRef.current = null;
		setStreaming('');
		setAwaitingReply(true);
		ipcStreamNonceRef.current += 1;
		return ipcStreamNonceRef.current;
	}, []);

	const markFirstToken = useCallback(() => {
		if (firstTokenAtRef.current === null) {
			firstTokenAtRef.current = Date.now();
		}
	}, []);

	const computeThoughtSeconds = useCallback((fallbackSeconds: number) => {
		const start = streamStartedAtRef.current;
		const firstTokenAt = firstTokenAtRef.current;
		const end = Date.now();
		if (start !== null && firstTokenAt !== null) {
			return Math.max(0.1, (firstTokenAt - start) / 1000);
		}
		if (start !== null) {
			return Math.max(0.1, (end - start) / 1000);
		}
		return fallbackSeconds;
	}, []);

	const recordThoughtSeconds = useCallback(
		(threadId: string, fallbackSeconds: number) => {
			const thinkSec = computeThoughtSeconds(fallbackSeconds);
			setThoughtSecondsByThread((prev) => ({ ...prev, [threadId]: thinkSec }));
			return thinkSec;
		},
		[computeThoughtSeconds]
	);

	const resetStreamingSession = useCallback((options?: { clearThread?: boolean }) => {
		if (options?.clearThread !== false) {
			streamThreadRef.current = null;
			// 刻意不清 ipcInFlightChatThreadIdRef：工作区切换时后台流可能仍在进行
		}
		streamStartedAtRef.current = null;
		firstTokenAtRef.current = null;
		setAwaitingReply(false);
		setStreaming('');
	}, []);

	const clearInFlightIpcRouting = useCallback((threadId?: string | null) => {
		ipcInFlightChatThreadIdRef.current = null;
		if (threadId) {
			delete offThreadStreamDraftsRef.current[threadId];
		}
	}, []);

	// thinkingTick 改为 ref 后仍需触发 UI 更新（思考计时器显示），使用 forceUpdate
	const [, forceUpdate] = useState(0);
	useEffect(() => {
		if (!awaitingReply || streaming.length > 0) {
			return;
		}
		const id = window.setInterval(() => {
			thinkingTickRef.current += 1;
			forceUpdate(x => x + 1); // 仅更新显示思考时间的组件
		}, 1000); // 降低到 1 秒一次，足够显示秒数
		return () => window.clearInterval(id);
	}, [awaitingReply, streaming.length]);

	useEffect(() => () => clearToastTimer(), [clearToastTimer]);

	return {
		streaming,
		setStreaming,
		awaitingReply,
		setAwaitingReply,
		thinkingTickRef,
		thoughtSecondsByThread,
		setThoughtSecondsByThread,
		subAgentBgToast,
		showTransientToast,
		beginStream,
		markFirstToken,
		recordThoughtSeconds,
		resetStreamingSession,
		clearInFlightIpcRouting,
		streamThreadRef,
		ipcInFlightChatThreadIdRef,
		ipcStreamNonceRef,
		offThreadStreamDraftsRef,
		streamStartedAtRef,
		firstTokenAtRef,
	};
}

export function useStreamingChatControls(runtime: StreamingSendRuntime) {
	const runtimeRef = useRef(runtime);
	runtimeRef.current = runtime;

	const sendMessage = useCallback(async (text: string, opts?: StreamingSendOptions) => {
		const rt = runtimeRef.current;
		const targetThreadId = opts?.threadId ?? rt.currentId;
		if (!rt.shell || !targetThreadId) {
			return;
		}

		const effectiveModelId = (opts?.modelIdOverride ?? rt.defaultModel).trim();
		if (!effectiveModelId) {
			rt.flashComposerAttachErr(rt.t('app.noModelSelected'));
			return;
		}
		const effectiveMode = opts?.modeOverride ?? rt.composerMode;
		if (effectiveMode === 'team') {
			const missingRoles = findTeamRolesMissingModels(rt.teamSettings, rt.modelEntries);
			if (missingRoles.length > 0) {
				const roles = missingRoles
					.map((role) => role.name.trim() || rt.t(`settings.team.role.${role.roleType}`))
					.join('、');
				rt.flashComposerAttachErr(rt.t('team.sendMissingRoleModels', { roles }));
				return;
			}
		}

		rt.clearPlanQuestion();
		rt.clearRootUserInputRequest(targetThreadId);

		if (opts?.threadId && opts.threadId !== rt.currentId) {
			await rt.shell.invoke('threads:select', opts.threadId);
			rt.setCurrentId(opts.threadId);
			await rt.loadMessages(opts.threadId);
		}

		rt.clearAgentReviewForThread(targetThreadId);
		if (effectiveMode === 'team') {
			rt.startTeamSession(targetThreadId, text);
		}
		if (rt.resendFromUserIndex !== null) {
			const resendIdx = rt.resendFromUserIndex;
			rt.setInlineResendSegments([]);
			rt.setMessages((messages) => [...messages.slice(0, resendIdx), { role: 'user', content: text }]);
		} else {
			rt.setComposerSegments([]);
			rt.setMessages((messages) => [...messages, { role: 'user', content: text }]);
		}

		rt.setStreamingThinking('');
		rt.clearStreamingToolPreviewNow();
		rt.resetLiveAgentBlocks();
		const streamNonce = rt.beginStream(targetThreadId);

		if (opts?.planExecute && opts.planBuildPathKey) {
			const pathKey = opts.planBuildPathKey.trim().toLowerCase();
			if (pathKey) {
				rt.planBuildPendingMarkerRef.current = { threadId: targetThreadId, pathKey };
			}
		}

		if (rt.resendFromUserIndex !== null) {
			const resendIdx = rt.resendFromUserIndex;
			rt.setResendFromUserIndex(null);
			try {
				const result = (await rt.shell.invoke('chat:editResend', {
					threadId: targetThreadId,
					visibleIndex: resendIdx,
					text,
					mode: effectiveMode,
					modelId: effectiveModelId,
					streamNonce,
				})) as { ok?: boolean; error?: string };

				if (!result?.ok) {
					rt.clearInFlightIpcRouting(targetThreadId);
					rt.resetStreamingSession({ clearThread: false });
					rt.streamStartedAtRef.current = null;
					rt.setResendFromUserIndex(resendIdx);
					rt.setInlineResendSegments(userMessageToSegments(text));
					if (result?.error !== 'aborted') {
						rt.flashComposerAttachErr(rt.t('app.chatSendFailed'));
					}
					void rt.loadMessages(targetThreadId);
				} else {
					void rt.refreshThreads();
				}
			} catch (e) {
				rt.clearInFlightIpcRouting(targetThreadId);
				rt.resetStreamingSession({ clearThread: false });
				rt.streamStartedAtRef.current = null;
				rt.setResendFromUserIndex(resendIdx);
				rt.setInlineResendSegments(userMessageToSegments(text));
				const msg = e instanceof Error ? e.message : String(e);
				if (!/abort/i.test(msg)) {
					rt.flashComposerAttachErr(msg);
				}
				void rt.loadMessages(targetThreadId);
			}
			return;
		}

		try {
			const sendResult = (await rt.shell.invoke('chat:send', {
				threadId: targetThreadId,
				text,
				mode: effectiveMode,
				modelId: effectiveModelId,
				planExecute: opts?.planExecute,
				streamNonce,
			})) as { ok?: boolean; error?: string };

			if (!sendResult?.ok) {
				rt.clearInFlightIpcRouting(targetThreadId);
				rt.resetStreamingSession({ clearThread: false });
				rt.streamStartedAtRef.current = null;
				rt.clearStreamingToolPreviewNow();
				rt.resetLiveAgentBlocks();
				if (sendResult?.error === 'aborted') {
					void rt.loadMessages(targetThreadId);
					return;
				}
				if (sendResult?.error === 'no-model') {
					rt.flashComposerAttachErr(rt.t('app.noModelSelected'));
				} else {
					const reason =
						sendResult?.error === 'no-window'
							? rt.t('app.chatSendFailedNoWindow')
							: sendResult?.error
								? rt.t('app.chatSendFailedReason', { reason: sendResult.error })
								: rt.t('app.chatSendFailed');
					rt.flashComposerAttachErr(reason);
				}
				void rt.loadMessages(targetThreadId);
				return;
			}
			void rt.refreshThreads();
			const session = (await rt.shell.invoke('agent:getSession', targetThreadId)) as
				| { ok: true; session?: AgentSessionSnapshot | null }
				| { ok: false };
			if (session.ok) {
				rt.restoreAgentSession(targetThreadId, session.session ?? null);
			}
		} catch (e) {
			rt.clearInFlightIpcRouting(targetThreadId);
			rt.resetStreamingSession({ clearThread: false });
			rt.streamStartedAtRef.current = null;
			rt.clearStreamingToolPreviewNow();
			rt.resetLiveAgentBlocks();
			const msg = e instanceof Error ? e.message : String(e);
			if (!/abort/i.test(msg)) {
				rt.flashComposerAttachErr(msg);
			}
			void rt.loadMessages(targetThreadId);
		}
	}, []);

	const abortActiveStream = useCallback(async () => {
		const rt = runtimeRef.current;
		if (!rt.shell) {
			return;
		}
		// 切工作区后 currentId 可能已是另一线程，但后台流仍挂在 ipcInFlight 上
		const threadToAbort = rt.ipcInFlightChatThreadIdRef.current ?? rt.currentId;
		if (!threadToAbort) {
			return;
		}
		rt.planBuildPendingMarkerRef.current = null;
		rt.clearMistakeLimitRequest();
		await rt.shell.invoke('chat:abort', threadToAbort);
		// 与 App 原逻辑一致：不 resetStreamingSession，由后端 done/error 收尾正文流式状态
		rt.clearInFlightIpcRouting(threadToAbort);
		rt.clearStreamingToolPreviewNow();
		rt.resetLiveAgentBlocks();
		rt.clearRootUserInputRequest(threadToAbort);
		rt.setAwaitingReply(false);
	}, []);

	return {
		sendMessage,
		abortActiveStream,
	};
}

export function useStreamingChatSubscription(runtime: StreamingSubscriptionRuntime) {
	const runtimeRef = useRef(runtime);
	runtimeRef.current = runtime;

	useEffect(() => {
		const shell = runtime.shell;
		if (!shell) {
			return;
		}
		const unsub = shell.subscribeChat((raw: unknown) => {
			const rt = runtimeRef.current;
			const payload = raw as ChatStreamPayload;
			if (payload.type === 'agent_session_sync') {
				rt.restoreAgentSession(payload.threadId, payload.session);
				if (payload.threadId === rt.currentIdRef.current) {
					void rt.refreshThreads();
				}
				return;
			}
			if (payload.type === 'sub_agent_background_done') {
				const preview = payload.result.length > 240 ? `${payload.result.slice(0, 240)}…` : payload.result;
				const text = payload.success
					? rt.t('agent.subAgentBg.done', { preview })
					: rt.t('agent.subAgentBg.fail', { preview });
				rt.showTransientToast(payload.success, text, 6500, {
					threadId: payload.threadId,
					agentId: payload.agentId,
				});
				if (payload.threadId === rt.currentIdRef.current) {
					void rt.refreshThreads();
				}
				return;
			}
			const inFlight = rt.ipcInFlightChatThreadIdRef.current;
			if (!inFlight || payload.threadId !== inFlight) {
				return;
			}
			if (
				payload.streamNonce !== undefined &&
				payload.streamNonce !== rt.ipcStreamNonceRef.current
			) {
				return;
			}

			const visible = payload.threadId === rt.currentIdRef.current;
			/* plan_question_request 可能带 teamRoleScope；须先弹出 UI，再写入对应专家工作流 */
			if (payload.type === 'plan_question_request') {
				if (visible) {
					rt.setPlanQuestion(payload.question);
					rt.setPlanQuestionRequestId(payload.requestId);
				}
				if ('teamRoleScope' in payload && payload.teamRoleScope) {
					rt.applyTeamPayload(payload);
				}
				return;
			}
			if (payload.type === 'user_input_request') {
				if ('teamRoleScope' in payload && payload.teamRoleScope) {
					rt.applyTeamPayload(payload);
				} else if (visible) {
					rt.setRootUserInputRequest(payload.threadId, payload.request);
				}
				return;
			}
			if ('teamRoleScope' in payload && payload.teamRoleScope) {
				rt.applyTeamPayload(payload);
				return;
			}
			const draftRow = () => {
				const m = rt.offThreadStreamDraftsRef.current;
				if (!m[payload.threadId]) {
					m[payload.threadId] = { streaming: '', streamingThinking: '' };
				}
				return m[payload.threadId]!;
			};
			const patchStream = (updater: (s: string) => string) => {
				if (visible) {
					rt.setStreaming(updater);
				} else {
					const d = draftRow();
					d.streaming = updater(d.streaming);
				}
			};
			const patchThinking = (updater: (s: string) => string) => {
				if (visible) {
					rt.setStreamingThinking(updater);
				} else {
					const d = draftRow();
					d.streamingThinking = updater(d.streamingThinking);
				}
			};

			const trackLiveBlocks =
				(rt.composerMode === 'agent' || rt.composerMode === 'plan' || rt.composerMode === 'team') && visible;
			const applyToolInputDeltaUi = (p: { name: string; partialJson: string; index: number }) => {
				if (!visible) {
					return;
				}
				if (rt.streamingToolPreviewClearTimerRef.current !== null) {
					window.clearTimeout(rt.streamingToolPreviewClearTimerRef.current);
					rt.streamingToolPreviewClearTimerRef.current = null;
				}
				rt.setStreamingToolPreview({
					name: p.name,
					partialJson: p.partialJson,
					index: p.index,
				});
				if (trackLiveBlocks) {
					rt.setLiveAssistantBlocks((st) =>
						applyLiveAgentChatPayload(st, {
							type: 'tool_input_delta',
							name: p.name,
							partialJson: p.partialJson,
							index: p.index,
						})
					);
				}
			};

			if (payload.type === 'delta') {
				const subParent = payload.parentToolCallId;
				if (subParent) {
					const deltaText = payload.text;
					patchStream((s) => {
						const inner = escapeSubAgentXmlText(deltaText);
						const p = escapeStreamAttr(subParent);
						const d = payload.nestingDepth ?? 1;
						return `${s}<sub_agent_delta parent="${p}" depth="${d}">${inner}</sub_agent_delta>`;
					});
					if (trackLiveBlocks) {
						rt.setLiveAssistantBlocks((st) =>
							applyLiveAgentChatPayload(st, {
								type: 'delta',
								text: deltaText,
								parentToolCallId: subParent,
								nestingDepth: payload.nestingDepth,
							})
						);
					}
				} else {
					if (visible && payload.text.length > 0) {
						rt.markFirstToken();
					}
					patchStream((s) => s + payload.text);
					if (trackLiveBlocks) {
						rt.setLiveAssistantBlocks((st) =>
							applyLiveAgentChatPayload(st, {
								type: 'delta',
								text: payload.text,
							})
						);
					}
				}
			} else if (payload.type === 'tool_input_delta') {
				if (!payload.parentToolCallId) {
					applyToolInputDeltaUi({
						name: payload.name,
						partialJson: payload.partialJson,
						index: payload.index,
					});
				}
			} else if (payload.type === 'thinking_delta') {
				const parentToolCallId = payload.parentToolCallId;
				if (parentToolCallId) {
					patchStream((s) => {
						const inner = escapeSubAgentXmlText(payload.text);
						const p = escapeStreamAttr(parentToolCallId);
						const d = payload.nestingDepth ?? 1;
						return `${s}<sub_agent_thinking parent="${p}" depth="${d}">${inner}</sub_agent_thinking>`;
					});
					if (trackLiveBlocks) {
						rt.setLiveAssistantBlocks((st) =>
							applyLiveAgentChatPayload(st, {
								type: 'thinking_delta',
								text: payload.text,
								parentToolCallId,
								nestingDepth: payload.nestingDepth,
							})
						);
					}
				} else {
					patchThinking((s) => s + payload.text);
					if (trackLiveBlocks) {
						rt.setLiveAssistantBlocks((st) =>
							applyLiveAgentChatPayload(st, {
								type: 'thinking_delta',
								text: payload.text,
							})
						);
					}
				}
			} else if (payload.type === 'tool_call') {
				if (
					visible &&
					!payload.parentToolCallId &&
					payload.name === 'plan_submit_draft' &&
					rt.shell
				) {
					try {
						const parsedArgs = JSON.parse(payload.args) as Record<string, unknown>;
						const normalized = normalizePlanDraftSubmission(parsedArgs);
						if (normalized.ok) {
							const parsedPlan = planDraftToParsedPlan(normalized.draft);
							rt.setParsedPlan(parsedPlan);
							void (async () => {
								const filename = generatePlanFilename(parsedPlan.name);
								const result = (await rt.shell!.invoke('plan:save', { filename, content: toPlanMd(parsedPlan) })) as
									| { ok: true; path: string; relPath?: string }
									| { ok: false };
								if (result.ok) {
									rt.setPlanFilePath(result.path);
									rt.setPlanFileRelPath(result.relPath ?? null);
								}
								await rt.shell!.invoke('plan:saveStructured', {
									threadId: payload.threadId,
									plan: planDraftToThreadPlan(normalized.draft, {
										path: result.ok ? result.path : null,
										relPath: result.ok ? result.relPath ?? null : null,
									}),
								});
							})();
						}
					} catch {
						// Ignore malformed draft args; the tool result path will surface the error.
					}
				}
				if (
					visible &&
					!payload.parentToolCallId &&
					rt.streamingToolPreviewClearTimerRef.current !== null
				) {
					window.clearTimeout(rt.streamingToolPreviewClearTimerRef.current);
					rt.streamingToolPreviewClearTimerRef.current = null;
				}
				const nest =
					payload.parentToolCallId != null
						? ` sub_parent="${escapeStreamAttr(payload.parentToolCallId)}" sub_depth="${payload.nestingDepth ?? 1}"`
						: '';
				const marker = `\n<tool_call tool="${payload.name}"${nest}>${payload.args}</tool_call>\n`;
				patchStream((s) => s + marker);
				if (trackLiveBlocks && !payload.parentToolCallId) {
					rt.setLiveAssistantBlocks((st) =>
						applyLiveAgentChatPayload(st, {
							type: 'tool_call',
							name: payload.name,
							args: payload.args,
							toolCallId: payload.toolCallId,
						})
					);
				}
			} else if (payload.type === 'tool_result') {
				if (!payload.parentToolCallId && visible) {
					rt.setStreamingToolPreview(null);
				}
				const truncated =
					payload.result.length > 3000 ? `${payload.result.slice(0, 3000)}\n... (truncated)` : payload.result;
				const safe = truncated.split('</tool_result>').join('</tool\u200c_result>');
				const marker = `<tool_result tool="${payload.name}" success="${payload.success}">${safe}</tool_result>\n`;
				patchStream((s) => s + marker);
				if (trackLiveBlocks && !payload.parentToolCallId) {
					rt.setLiveAssistantBlocks((st) =>
						applyLiveAgentChatPayload(st, {
							type: 'tool_result',
							name: payload.name,
							result: truncated,
							success: payload.success,
							toolCallId: payload.toolCallId,
						})
					);
				}
			} else if (payload.type === 'tool_progress') {
				if (trackLiveBlocks && !payload.parentToolCallId) {
					rt.setLiveAssistantBlocks((st) =>
						applyLiveAgentChatPayload(st, {
							type: 'tool_progress',
							name: payload.name,
							phase: payload.phase,
							detail: payload.detail,
						})
					);
				}
			} else if (payload.type === 'tool_approval_request') {
				if (visible) {
					rt.setToolApprovalRequest({
						approvalId: payload.approvalId,
						toolName: payload.toolName,
						command: payload.command,
						path: payload.path,
					});
				}
			} else if (payload.type === 'agent_mistake_limit') {
				if (visible) {
					rt.setMistakeLimitRequest({
						recoveryId: payload.recoveryId,
						consecutiveFailures: payload.consecutiveFailures,
						threshold: payload.threshold,
					});
				}
			} else if (
				payload.type === 'team_phase' ||
				payload.type === 'team_task_created' ||
				payload.type === 'team_expert_started' ||
				payload.type === 'team_expert_progress' ||
				payload.type === 'team_expert_done' ||
				payload.type === 'team_review' ||
				payload.type === 'team_plan_summary' ||
				payload.type === 'team_preflight_review' ||
				payload.type === 'team_plan_proposed' ||
				payload.type === 'team_plan_decision' ||
				payload.type === 'team_plan_revised'
			) {
				rt.applyTeamPayload(payload);
			} else if (payload.type === 'done') {
				rt.recordThoughtSeconds(payload.threadId, 0.5);
				if (payload.usage) {
					rt.setLastTurnUsage(payload.usage);
				}
				delete rt.offThreadStreamDraftsRef.current[payload.threadId];
				rt.ipcInFlightChatThreadIdRef.current = null;

				if (visible) {
					rt.resetStreamingSession({ clearThread: false });
					rt.setStreamingThinking('');
					rt.setToolApprovalRequest(null);
					rt.setMistakeLimitRequest(null);
					rt.setPlanQuestionRequestId(null);
					rt.clearStreamingToolPreviewNow();
					rt.resetLiveAgentBlocks();
					rt.setFileChangesDismissed(false);
					rt.setDismissedFiles(new Set());
				}
				rt.clearRootUserInputRequest(payload.threadId);

				const pendingPlan = rt.planBuildPendingMarkerRef.current;
				if (pendingPlan && pendingPlan.threadId === payload.threadId) {
					rt.planBuildPendingMarkerRef.current = null;
					if (pendingPlan.pathKey && rt.shell) {
						void rt.shell.invoke('threads:markPlanExecuted', {
							threadId: pendingPlan.threadId,
							pathKey: pendingPlan.pathKey,
						});
						if (pendingPlan.threadId === rt.currentIdRef.current) {
							rt.setExecutedPlanKeys((prev) =>
								prev.includes(pendingPlan.pathKey) ? prev : [...prev, pendingPlan.pathKey]
							);
						}
					}
				}

				clearPersistedAgentFileChanges(payload.threadId);
				const pendingPatches = payload.pendingAgentPatches;
				if (pendingPatches && pendingPatches.length > 0) {
					rt.setAgentReviewPendingByThread((prev) => ({
						...prev,
						[payload.threadId]: pendingPatches,
					}));
				}

				const fullText = payload.text ?? '';
				const textForPlanMarkers = flattenAssistantTextPartsForSearch(fullText);
				if (visible) {
					rt.setMessages((messages) => {
						const last = messages[messages.length - 1];
						if (last?.role === 'assistant' && last.content === fullText) {
							return messages;
						}
						return [...messages, { role: 'assistant', content: fullText }];
					});

					const question = parseQuestions(textForPlanMarkers);
					if (question) {
						rt.setPlanQuestion(question);
						rt.setPlanQuestionRequestId(null);
					} else {
						rt.setPlanQuestion(null);
						rt.setPlanQuestionRequestId(null);
					}

					const plan = parsePlanDocument(textForPlanMarkers);
					if (plan) {
						rt.setParsedPlan(plan);
						const filename = generatePlanFilename(plan.name);
						const markdown = toPlanMd(plan);
						if (rt.shell) {
							void (async () => {
								const result = (await rt.shell!.invoke('plan:save', { filename, content: markdown })) as
									| { ok: true; path: string; relPath?: string }
									| { ok: false };
								if (result.ok) {
									rt.setPlanFilePath(result.path);
									rt.setPlanFileRelPath(result.relPath ?? null);
								}
								await rt.shell!.invoke('plan:saveStructured', {
									threadId: payload.threadId,
									plan: {
										title: plan.name,
										steps: plan.todos.map((todo) => ({
											id: todo.id,
											title: todo.content.split(':')[0]?.trim() ?? todo.content,
											description: todo.content,
											status: 'pending' as const,
										})),
										updatedAt: Date.now(),
									},
								});
							})();
						}
					}
				}

				void rt.loadMessages(payload.threadId);
				void rt.refreshThreads();
			} else if (payload.type === 'error') {
				rt.recordThoughtSeconds(payload.threadId, 0.3);
				rt.planBuildPendingMarkerRef.current = null;
				delete rt.offThreadStreamDraftsRef.current[payload.threadId];
				rt.ipcInFlightChatThreadIdRef.current = null;
				rt.clearRootUserInputRequest(payload.threadId);
				if (visible) {
					rt.resetStreamingSession({ clearThread: false });
					rt.setStreamingThinking('');
					rt.setToolApprovalRequest(null);
					rt.setMistakeLimitRequest(null);
					rt.setPlanQuestionRequestId(null);
					rt.clearStreamingToolPreviewNow();
					rt.resetLiveAgentBlocks();
					const errorLine = rt.t('app.errorPrefix', {
						message: translateChatError(payload.message, rt.t),
					});
					rt.setMessages((messages) => {
						const last = messages[messages.length - 1];
						if (last?.role === 'assistant' && last.content === errorLine) {
							return messages;
						}
						return [...messages, { role: 'assistant', content: errorLine }];
					});
				} else {
					void rt.loadMessages(payload.threadId);
				}
				void rt.refreshThreads();
			}
		});

		return () => {
			unsub();
		};
	}, [runtime.shell]);
}
