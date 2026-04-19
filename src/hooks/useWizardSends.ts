import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { segmentsToWireText, type ComposerSegment } from '../composerSegments';
import type { TFunction } from '../i18n';
import type { ChatMessage } from '../threadTypes';
import type { ComposerMode } from '../ComposerPlusMenu';
import type { AgentRuleScope } from '../agentSettingsTypes';

export type WizardPending = {
	tailSegments: ComposerSegment[];
	targetThreadId: string;
};

export type UseWizardSendsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	currentId: string | null;
	defaultModel: string;
	t: TFunction;
	setComposerModePersist: (mode: ComposerMode) => void;
	setCurrentId: Dispatch<SetStateAction<string | null>>;
	loadMessages: (id: string) => Promise<unknown>;
	clearAgentReviewForThread: (id: string) => void;
	setComposerSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	setStreamingThinking: Dispatch<SetStateAction<string>>;
	clearStreamingToolPreviewNow: () => void;
	resetLiveAgentBlocks: () => void;
	beginStream: (threadId: string) => number;
	setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
	refreshThreads: () => void | Promise<unknown>;
	resetStreamingSession: () => void;
	flashComposerAttachErr: (msg: string) => void;
};

export type UseWizardSendsResult = {
	executeSkillCreatorSend: (
		scope: 'user' | 'project',
		pending: WizardPending
	) => Promise<void>;
	executeRuleWizardSend: (
		ruleScope: AgentRuleScope,
		globPattern: string | undefined,
		pending: WizardPending
	) => Promise<void>;
	executeSubagentWizardSend: (
		scope: 'user' | 'project',
		pending: WizardPending
	) => Promise<void>;
};

type WizardSendSpec = {
	/** 顶部介绍气泡文案 */
	head: string;
	/** 在 head 与用户尾部之间额外插入的一行（仅 ruleWizard glob 用到） */
	middleLine?: string;
	/** 透传给 chat:send 的额外字段（区分 skillCreator / ruleCreator / subagentCreator） */
	extraPayload: Record<string, unknown>;
	/** error === 'no-workspace' 时弹原生 alert 的文案；不传表示该 wizard 不区分此分支 */
	noWorkspaceAlert?: string;
};

/**
 * 三个 wizard 的发送动作：skill creator / rule wizard / subagent wizard。
 *
 * 它们的流程几乎完全同构（切换线程 → reset → 乐观插入用户气泡 → IPC `chat:send`），
 * 只是 head 文案、可选 middle 行、payload 字段名、以及"无工作区"分支文案不同。
 * 因此抽出 `runWizardSend` 公共骨架，三个对外 API 仅描述差异点。
 *
 * 行为与原 App.tsx 三段实现一致：
 *  - 都强制把 composer 切到 `agent` 模式（plan 没有写文件工具）
 *  - 失败时 reset stream 并按原始错误分支行为反馈
 */
export function useWizardSends(params: UseWizardSendsParams): UseWizardSendsResult {
	const {
		shell,
		currentId,
		defaultModel,
		t,
		setComposerModePersist,
		setCurrentId,
		loadMessages,
		clearAgentReviewForThread,
		setComposerSegments,
		setStreamingThinking,
		clearStreamingToolPreviewNow,
		resetLiveAgentBlocks,
		beginStream,
		setMessages,
		refreshThreads,
		resetStreamingSession,
		flashComposerAttachErr,
	} = params;

	const runWizardSend = useCallback(
		async (pending: WizardPending, spec: WizardSendSpec) => {
			if (!shell) {
				return;
			}
			if (!defaultModel.trim()) {
				flashComposerAttachErr(t('app.noModelSelected'));
				return;
			}
			setComposerModePersist('agent');
			const { tailSegments, targetThreadId } = pending;
			const tailWire = segmentsToWireText(tailSegments).trim();
			const visible = [spec.head, spec.middleLine ?? '', tailWire]
				.filter((x) => x.length > 0)
				.join('\n');

			if (targetThreadId !== currentId) {
				await shell.invoke('threads:select', targetThreadId);
				setCurrentId(targetThreadId);
				await loadMessages(targetThreadId);
			}
			clearAgentReviewForThread(targetThreadId);
			setComposerSegments([]);
			setStreamingThinking('');
			clearStreamingToolPreviewNow();
			resetLiveAgentBlocks();
			const streamNonce = beginStream(targetThreadId);
			setMessages((m) => [...m, { role: 'user', content: visible }]);

			const r = (await shell.invoke('chat:send', {
				threadId: targetThreadId,
				text: '',
				mode: 'agent',
				modelId: defaultModel,
				streamNonce,
				...spec.extraPayload,
			})) as { ok?: boolean; error?: string };

			if (!r?.ok) {
				resetStreamingSession();
				void loadMessages(targetThreadId);
				if (r?.error === 'no-workspace' && spec.noWorkspaceAlert) {
					window.alert(spec.noWorkspaceAlert);
				} else if (r?.error === 'no-model') {
					flashComposerAttachErr(t('app.noModelSelected'));
				}
				return;
			}
			void refreshThreads();
		},
		[
			shell,
			currentId,
			defaultModel,
			t,
			setComposerModePersist,
			setCurrentId,
			loadMessages,
			clearAgentReviewForThread,
			setComposerSegments,
			setStreamingThinking,
			clearStreamingToolPreviewNow,
			resetLiveAgentBlocks,
			beginStream,
			setMessages,
			refreshThreads,
			resetStreamingSession,
			flashComposerAttachErr,
		]
	);

	const executeSkillCreatorSend = useCallback(
		async (scope: 'user' | 'project', pending: WizardPending) => {
			const tailWire = segmentsToWireText(pending.tailSegments).trim();
			const head =
				scope === 'project' ? t('skillCreator.bubbleHeadProject') : t('skillCreator.bubbleHeadAll');
			await runWizardSend(pending, {
				head,
				extraPayload: { skillCreator: { userNote: tailWire, scope } },
				noWorkspaceAlert: t('skillCreator.sendErrorNoWs'),
			});
		},
		[runWizardSend, t]
	);

	const executeRuleWizardSend = useCallback(
		async (
			ruleScope: AgentRuleScope,
			globPattern: string | undefined,
			pending: WizardPending
		) => {
			const tailWire = segmentsToWireText(pending.tailSegments).trim();
			const headKey =
				ruleScope === 'always'
					? 'ruleWizard.bubbleHeadAlways'
					: ruleScope === 'glob'
						? 'ruleWizard.bubbleHeadGlob'
						: 'ruleWizard.bubbleHeadManual';
			const head = t(headKey);
			const middleLine =
				ruleScope === 'glob' && globPattern?.trim()
					? t('ruleWizard.globLine', { pattern: globPattern.trim() })
					: undefined;
			await runWizardSend(pending, {
				head,
				middleLine,
				extraPayload: {
					ruleCreator: {
						userNote: tailWire,
						ruleScope,
						...(ruleScope === 'glob' && globPattern?.trim()
							? { globPattern: globPattern.trim() }
							: {}),
					},
				},
				// 原 ruleWizard 没有 noWorkspaceAlert 分支
			});
		},
		[runWizardSend, t]
	);

	const executeSubagentWizardSend = useCallback(
		async (scope: 'user' | 'project', pending: WizardPending) => {
			const tailWire = segmentsToWireText(pending.tailSegments).trim();
			const head =
				scope === 'project'
					? t('subagentWizard.bubbleHeadProject')
					: t('subagentWizard.bubbleHeadAll');
			await runWizardSend(pending, {
				head,
				extraPayload: { subagentCreator: { userNote: tailWire, scope } },
				noWorkspaceAlert: t('subagentWizard.sendErrorNoWs'),
			});
		},
		[runWizardSend, t]
	);

	return {
		executeSkillCreatorSend,
		executeRuleWizardSend,
		executeSubagentWizardSend,
	};
}
