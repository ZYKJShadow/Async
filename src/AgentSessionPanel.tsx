import { memo, useMemo, useState } from 'react';
import type { AgentLifecycleStatus, AgentSessionSnapshotAgent } from './agentSessionTypes';
import type { TFunction } from './i18n';
import { ChatMarkdown } from './ChatMarkdown';
import { IconCloseSmall, IconRefresh, IconArrowUpRight } from './icons';
import type { AgentSessionState } from './hooks/useAgentSession';
import { UserInputRequestInlineCard } from './UserInputRequestDialog';

type Props = {
	t: TFunction;
	session: AgentSessionState | null;
	threadId: string | null;
	onClose: () => void;
	onSelectAgent: (agentId: string | null) => void;
	onSendInput: (agentId: string, message: string, interrupt: boolean) => Promise<void>;
	onWaitAgent: (agentId: string) => Promise<void>;
	onResumeAgent: (agentId: string) => Promise<void>;
	onCloseAgent: (agentId: string) => Promise<void>;
	onOpenTranscript: (absPath: string) => void;
	onSubmitUserInput: (requestId: string, answers: Record<string, string>) => Promise<void>;
};

type AgentTreeRow = {
	agent: AgentSessionSnapshotAgent;
	depth: number;
};

function statusLabel(t: TFunction, status: AgentLifecycleStatus): string {
	switch (status) {
		case 'running':
			return t('agent.session.status.running');
		case 'waiting_input':
			return t('agent.session.status.waiting');
		case 'completed':
			return t('agent.session.status.completed');
		case 'failed':
			return t('agent.session.status.failed');
		case 'closed':
			return t('agent.session.status.closed');
		default:
			return status;
	}
}

function collectTreeRows(
	agentsById: Record<string, AgentSessionSnapshotAgent>,
	parentAgentId: string | null,
	depth: number,
	out: AgentTreeRow[]
): void {
	const rows = Object.values(agentsById)
		.filter((agent) => agent.parentAgentId === parentAgentId)
		.sort((a, b) => b.updatedAt - a.updatedAt);
	for (const row of rows) {
		out.push({ agent: row, depth });
		collectTreeRows(agentsById, row.id, depth + 1, out);
	}
}

export const AgentSessionPanel = memo(function AgentSessionPanel({
	t,
	session,
	threadId,
	onClose,
	onSelectAgent,
	onSendInput,
	onWaitAgent,
	onResumeAgent,
	onCloseAgent,
	onOpenTranscript,
	onSubmitUserInput,
}: Props) {
	const [draft, setDraft] = useState('');
	const [interrupt, setInterrupt] = useState(false);
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const rows = useMemo(() => {
		const next: AgentTreeRow[] = [];
		if (session) {
			collectTreeRows(session.agentsById, null, 0, next);
		}
		return next;
	}, [session]);
	const selectedAgent =
		(session?.selectedAgentId ? session.agentsById[session.selectedAgentId] : null) ?? rows[0]?.agent ?? null;
	const pendingInputRequest =
		selectedAgent && session?.pendingUserInput?.agentId === selectedAgent.id ? session.pendingUserInput : null;

	const runAction = async (key: string, action: () => Promise<void>) => {
		setBusyAction(key);
		try {
			await action();
		} finally {
			setBusyAction(null);
		}
	};

	const canSubmit = !!selectedAgent && draft.trim().length > 0 && !busyAction;

	return (
		<div className="ref-agent-session-shell">
			<div className="ref-agent-session-head">
				<div className="ref-agent-session-title-stack">
					<span className="ref-agent-session-kicker">{t('agent.session.kicker')}</span>
					<span className="ref-agent-session-title">{t('agent.session.title')}</span>
				</div>
				<button
					type="button"
					className="ref-team-sidebar-close"
					onClick={onClose}
					aria-label={t('common.close')}
					title={t('common.close')}
				>
					<IconCloseSmall />
				</button>
			</div>
			{!threadId || !session || rows.length === 0 ? (
				<div className="ref-team-sidebar-empty">
					<div className="ref-agent-plan-status-main">
						<div className="ref-agent-plan-status-title">{t('agent.session.emptyTitle')}</div>
						<p className="ref-agent-plan-status-body">{t('agent.session.emptyBody')}</p>
					</div>
				</div>
			) : (
				<div className="ref-agent-session-layout">
					<div className="ref-agent-session-list">
						{rows.map(({ agent, depth }) => {
							const active = selectedAgent?.id === agent.id;
							const waitingForInput = session?.pendingUserInput?.agentId === agent.id;
							const rowSummary = waitingForInput
								? session.pendingUserInput?.questions.map((question) => question.header).join(' · ') ||
									session.pendingUserInput?.agentTitle
								: agent.lastResultSummary || agent.lastInputSummary;
							return (
								<button
									key={agent.id}
									type="button"
									className={`ref-agent-session-row ${active ? 'is-active' : ''}`}
									onClick={() => onSelectAgent(agent.id)}
									style={{ marginLeft: `${depth * 14}px` }}
								>
									<span className={`ref-agent-session-status ref-agent-session-status--${agent.status}`}>
										{statusLabel(t, agent.status)}
									</span>
									<span className="ref-agent-session-row-title">{agent.title}</span>
									<span className="ref-agent-session-row-summary">{rowSummary}</span>
									{agent.background ? <span className="ref-agent-session-row-chip">{t('agent.session.background')}</span> : null}
								</button>
							);
						})}
					</div>
					<div className="ref-agent-session-detail">
						{selectedAgent ? (
							<>
								<div className="ref-agent-session-detail-head">
									<div className="ref-agent-session-detail-meta">
										<strong>{selectedAgent.title}</strong>
										<span className={`ref-agent-session-status ref-agent-session-status--${selectedAgent.status}`}>
											{statusLabel(t, selectedAgent.status)}
										</span>
									</div>
									<div className="ref-agent-session-detail-tags">
										<span className="ref-agent-session-tag">{selectedAgent.contextMode === 'full' ? t('agent.session.contextFull') : t('agent.session.contextNone')}</span>
										<span className="ref-agent-session-tag">{selectedAgent.runProfile === 'explore' ? t('agent.session.profileExplore') : t('agent.session.profileFull')}</span>
									</div>
								</div>
								<div className="ref-agent-session-actions">
									<button
										type="button"
										className="ref-browser-error-btn"
										disabled={busyAction !== null}
										onClick={() => void runAction(`wait:${selectedAgent.id}`, () => onWaitAgent(selectedAgent.id))}
									>
										<IconRefresh />
										<span>{t('agent.session.wait')}</span>
									</button>
									<button
										type="button"
										className="ref-browser-error-btn"
										disabled={busyAction !== null || !selectedAgent.transcriptPath}
										onClick={() => selectedAgent.transcriptPath && onOpenTranscript(selectedAgent.transcriptPath)}
									>
										<IconArrowUpRight />
										<span>{t('agent.session.openTranscript')}</span>
									</button>
									{selectedAgent.status !== 'running' && selectedAgent.status !== 'waiting_input' ? (
										<button
											type="button"
											className="ref-browser-error-btn"
											disabled={busyAction !== null}
											onClick={() => void runAction(`resume:${selectedAgent.id}`, () => onResumeAgent(selectedAgent.id))}
										>
											{t('agent.session.resume')}
										</button>
									) : null}
									<button
										type="button"
										className="ref-browser-error-btn"
										disabled={busyAction !== null || selectedAgent.status === 'closed'}
										onClick={() => void runAction(`close:${selectedAgent.id}`, () => onCloseAgent(selectedAgent.id))}
									>
										{t('agent.session.close')}
									</button>
								</div>
								{pendingInputRequest ? (
									<UserInputRequestInlineCard
										request={pendingInputRequest}
										onSubmit={(answers) =>
											runAction(`reply:${pendingInputRequest.requestId}`, () =>
												onSubmitUserInput(pendingInputRequest.requestId, answers)
											)
										}
									/>
								) : null}
								<div className="ref-agent-session-transcript">
									{selectedAgent.messages.map((message, index) => (
										<div key={`${selectedAgent.id}-msg-${index}`} className={`ref-agent-session-msg ref-agent-session-msg--${message.role}`}>
											<div className="ref-agent-session-msg-role">{message.role}</div>
											<ChatMarkdown content={message.content} />
										</div>
									))}
								</div>
								<div className="ref-agent-session-input">
									<textarea
										className="ref-browser-settings-textarea"
										value={draft}
										placeholder={t('agent.session.messagePlaceholder')}
										onChange={(event) => setDraft(event.target.value)}
									/>
									<label className="ref-settings-team-inline-check">
										<input
											type="checkbox"
											checked={interrupt}
											onChange={(event) => setInterrupt(event.target.checked)}
										/>
										<span>{t('agent.session.interrupt')}</span>
									</label>
									<button
										type="button"
										className="ref-browser-error-btn"
										disabled={!canSubmit}
										onClick={() =>
											void runAction(`send:${selectedAgent.id}`, async () => {
												await onSendInput(selectedAgent.id, draft.trim(), interrupt);
												setDraft('');
												setInterrupt(false);
											})
										}
									>
										{t('agent.session.send')}
									</button>
								</div>
							</>
						) : null}
					</div>
				</div>
			)}
		</div>
	);
});
