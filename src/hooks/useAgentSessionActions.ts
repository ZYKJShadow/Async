import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ShellLayoutMode } from '../app/shellLayoutStorage';
import type { TFunction } from '../i18n';
import type { ChatMessage } from '../threadTypes';
import type { AgentRightSidebarView } from './useTeamSessionActions';

export type UseAgentSessionActionsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	currentId: string | null;
	currentIdRef: MutableRefObject<string | null>;
	layoutMode: ShellLayoutMode;
	t: TFunction;
	setSelectedAgent: (threadId: string, agentId: string | null) => void;
	setAgentRightSidebarView: Dispatch<SetStateAction<AgentRightSidebarView>>;
	setAgentRightSidebarOpen: Dispatch<SetStateAction<boolean>>;
	setCurrentId: Dispatch<SetStateAction<string | null>>;
	loadMessages: (
		id: string,
		onLoad?: (
			msgs: ChatMessage[],
			threadId: string,
			extra?: { teamSession?: unknown; agentSession?: unknown }
		) => void
	) => Promise<unknown>;
	onMessagesLoaded: (
		msgs: ChatMessage[],
		threadId: string,
		extra?: { teamSession?: unknown; agentSession?: unknown }
	) => void;
	showTransientToast: (success: boolean, message: string) => void;
};

export type UseAgentSessionActionsResult = {
	onSelectAgentSession: (agentId: string | null) => void;
	onSendAgentInput: (agentId: string, message: string, interrupt: boolean) => Promise<void>;
	onSubmitAgentUserInput: (
		requestId: string,
		answers: Record<string, string>
	) => Promise<void>;
	onWaitAgent: (agentId: string) => Promise<void>;
	onResumeAgent: (agentId: string) => Promise<void>;
	onCloseAgent: (agentId: string) => Promise<void>;
	onOpenAgentTranscript: (absPath: string) => void;
	onSubAgentToastClick: (threadId: string, agentId: string) => Promise<void>;
};

/**
 * Agent 子会话面板的 7 个交互回调（选 / 发消息 / 提交问询 / 等 / 续 / 关 / 打开 transcript / toast 跳转）。
 *
 * 行为与原 App.tsx 完全一致：
 *  - 所有 IPC 失败都通过 `showTransientToast(false, ...)` 反馈，不阻塞 UI；
 *  - `onSubAgentToastClick` 收到非当前线程的 toast 时切换线程并 reload；
 *  - `onWaitAgent` 固定 30s 超时，区分超时与完成两种 toast 文案。
 */
export function useAgentSessionActions(
	params: UseAgentSessionActionsParams
): UseAgentSessionActionsResult {
	const {
		shell,
		currentId,
		currentIdRef,
		layoutMode,
		t,
		setSelectedAgent,
		setAgentRightSidebarView,
		setAgentRightSidebarOpen,
		setCurrentId,
		loadMessages,
		onMessagesLoaded,
		showTransientToast,
	} = params;

	const onSelectAgentSession = useCallback(
		(agentId: string | null) => {
			if (!currentId) {
				return;
			}
			setSelectedAgent(currentId, agentId);
			setAgentRightSidebarView('agents');
			if (layoutMode === 'agent') {
				setAgentRightSidebarOpen(true);
			}
		},
		[
			currentId,
			setSelectedAgent,
			layoutMode,
			setAgentRightSidebarView,
			setAgentRightSidebarOpen,
		]
	);

	const onSendAgentInput = useCallback(
		async (agentId: string, message: string, interrupt: boolean) => {
			if (!currentId || !shell) {
				return;
			}
			const result = (await shell.invoke('agent:sendInput', {
				threadId: currentId,
				agentId,
				message,
				interrupt,
			})) as { ok?: boolean; error?: string };
			if (!result?.ok) {
				showTransientToast(false, result?.error || t('app.chatSendFailed'));
				return;
			}
			setSelectedAgent(currentId, agentId);
			showTransientToast(true, t('agent.session.sentToast'));
		},
		[currentId, shell, showTransientToast, t, setSelectedAgent]
	);

	const onSubmitAgentUserInput = useCallback(
		async (requestId: string, answers: Record<string, string>) => {
			if (!currentId || !shell) {
				return;
			}
			const result = (await shell.invoke('agent:userInputRespond', {
				requestId,
				answers,
			})) as { ok?: boolean; error?: string };
			if (!result?.ok) {
				showTransientToast(false, result?.error || t('app.chatSendFailed'));
				return;
			}
			showTransientToast(true, t('agent.userInput.submittedToast'));
		},
		[currentId, shell, showTransientToast, t]
	);

	const onWaitAgent = useCallback(
		async (agentId: string) => {
			if (!currentId || !shell) {
				return;
			}
			const result = (await shell.invoke('agent:wait', {
				threadId: currentId,
				agentIds: [agentId],
				timeoutMs: 30000,
			})) as {
				ok?: boolean;
				timedOut?: boolean;
				statuses?: Record<string, { status: string }>;
			};
			if (!result?.ok) {
				showTransientToast(false, t('agent.session.waitFailed'));
				return;
			}
			const status = result.statuses?.[agentId]?.status ?? 'running';
			showTransientToast(
				true,
				result.timedOut
					? t('agent.session.waitTimedOut')
					: t('agent.session.waitDone', { status })
			);
		},
		[currentId, shell, showTransientToast, t]
	);

	const onResumeAgent = useCallback(
		async (agentId: string) => {
			if (!currentId || !shell) {
				return;
			}
			const result = (await shell.invoke('agent:resume', {
				threadId: currentId,
				agentId,
			})) as { ok?: boolean; error?: string };
			if (!result?.ok) {
				showTransientToast(false, result?.error || t('agent.session.resumeFailed'));
				return;
			}
			showTransientToast(true, t('agent.session.resumeDone'));
		},
		[currentId, shell, showTransientToast, t]
	);

	const onCloseAgent = useCallback(
		async (agentId: string) => {
			if (!currentId || !shell) {
				return;
			}
			const result = (await shell.invoke('agent:close', {
				threadId: currentId,
				agentId,
			})) as { ok?: boolean; error?: string };
			if (!result?.ok) {
				showTransientToast(false, result?.error || t('agent.session.closeFailed'));
				return;
			}
			showTransientToast(true, t('agent.session.closeDone'));
		},
		[currentId, shell, showTransientToast, t]
	);

	const onOpenAgentTranscript = useCallback(
		(absPath: string) => {
			if (!shell || !absPath.trim()) {
				return;
			}
			void shell.invoke('shell:openDefault', absPath.trim());
		},
		[shell]
	);

	const onSubAgentToastClick = useCallback(
		async (threadId: string, agentId: string) => {
			if (!shell) {
				return;
			}
			if (threadId !== currentIdRef.current) {
				await shell.invoke('threads:select', threadId);
				setCurrentId(threadId);
				await loadMessages(threadId, onMessagesLoaded);
			}
			setSelectedAgent(threadId, agentId);
			setAgentRightSidebarView('agents');
			setAgentRightSidebarOpen(true);
		},
		[
			shell,
			loadMessages,
			onMessagesLoaded,
			setSelectedAgent,
			currentIdRef,
			setCurrentId,
			setAgentRightSidebarView,
			setAgentRightSidebarOpen,
		]
	);

	return {
		onSelectAgentSession,
		onSendAgentInput,
		onSubmitAgentUserInput,
		onWaitAgent,
		onResumeAgent,
		onCloseAgent,
		onOpenAgentTranscript,
		onSubAgentToastClick,
	};
}
