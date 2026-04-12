import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TFunction } from '../../i18n';
import {
	IconArrowUp,
	IconDotsHorizontal,
	IconMessageCircle,
	IconPlus,
} from '../../icons';
import type {
	AiCollabMessage,
	AiEmployeesOrchestrationState,
	AiOrchestrationRun,
	AiSubAgentJob,
} from '../../../shared/aiEmployeesSettings';
import type { OrgEmployee } from '../api/orgTypes';
import {
	apiBatchInbox,
	apiListInboxItems,
	type AiEmployeesConnection,
} from '../api/client';
import type { InboxItemJson } from '../api/types';
import { formatEmployeeResolvedModelLabel } from '../adapters/modelAdapter';
import { useOrgEmployeeAvatarPreview } from '../hooks/useOrgEmployeeAvatarPreview';
import type { LocalModelEntry } from '../sessionTypes';
import { CollabCard, isStructuredMessage } from '../components/CollabCard';
import { SubAgentExecutionCard } from '../components/SubAgentExecutionCard';
import { SubAgentDetailPanel } from './SubAgentDetailPanel';

function InboxChatAvatarSlot({
	conn,
	workspaceId,
	employee,
}: {
	conn: AiEmployeesConnection;
	workspaceId: string;
	employee: OrgEmployee | null;
}) {
	const id = employee?.id ?? null;
	const hasAsset = Boolean(employee?.avatarAssetId);
	const preview = useOrgEmployeeAvatarPreview(conn, workspaceId, id, hasAsset);
	const initial = employee?.displayName?.trim().slice(0, 1).toUpperCase() || '?';
	return (
		<div className="ref-ai-employees-inbox-chat-avatar" aria-hidden>
			{preview ? (
				<img src={preview} alt="" className="ref-ai-employees-inbox-chat-avatar-img" />
			) : (
				<span className="ref-ai-employees-inbox-chat-avatar-ph">{initial}</span>
			)}
		</div>
	);
}

function calendarDayKey(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatChatDayDivider(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function formatChatMessageTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function latestRunPreview(messages: AiCollabMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		const text = (message.summary || message.body || '').trim().replace(/\s+/g, ' ');
		if (text) {
			return text;
		}
	}
	return '';
}

function runStatusBadge(t: TFunction, run: AiOrchestrationRun): string {
	switch (run.status) {
		case 'running':
			return t('aiEmployees.groupChat.runStatus.running');
		case 'completed':
			return t('aiEmployees.groupChat.runStatus.completed');
		case 'awaiting_approval':
			return t('aiEmployees.groupChat.runStatus.awaiting');
		case 'cancelled':
			return t('aiEmployees.groupChat.runStatus.cancelled');
		default:
			return run.statusSummary ?? run.status;
	}
}

function runStatusTone(run: AiOrchestrationRun): string {
	switch (run.status) {
		case 'completed':
			return 'is-done';
		case 'awaiting_approval':
			return 'is-pending';
		case 'cancelled':
			return 'is-blocked';
		default:
			return 'is-running';
	}
}

function jobFromRun(run: AiOrchestrationRun | undefined, jobId?: string): AiSubAgentJob | undefined {
	if (!run || !jobId) return undefined;
	return (run.subAgentJobs ?? []).find((j) => j.id === jobId);
}

type SidebarSelection = { kind: 'run'; runId: string } | { kind: 'task'; messageId: string };

export function InboxPage({
	t,
	orgEmployees,
	orchestration,
	conn,
	workspaceId,
	inboxVersion,
	agentLocalModelMap,
	employeeLocalModelMap,
	defaultModelId,
	modelOptions,
	modelOptionIdSet,
	onCreateGroupRun,
	onSendMessage,
	onMarkMessageRead,
	listMessagesByRun,
	ceoEmployeeId,
	employeeChatStreaming,
	employeeChatError,
	onNavigateToActivity,
}: {
	t: TFunction;
	orgEmployees: OrgEmployee[];
	orchestration: AiEmployeesOrchestrationState;
	conn: AiEmployeesConnection;
	workspaceId: string;
	inboxVersion: number;
	agentLocalModelMap: Record<string, string> | undefined;
	employeeLocalModelMap: Record<string, string> | undefined;
	defaultModelId?: string;
	modelOptions: LocalModelEntry[];
	modelOptionIdSet: Set<string>;
	onCreateGroupRun: (title: string) => string;
	onSendMessage: (input: {
		runId: string;
		type?: 'text' | 'task_assignment';
		body: string;
		summary?: string;
		toEmployeeId?: string;
	}) => void;
	onMarkMessageRead: (messageId: string) => void;
	listMessagesByRun: (runId: string) => AiCollabMessage[];
	ceoEmployeeId?: string;
	employeeChatStreaming: Record<string, string>;
	employeeChatError: Record<string, string | undefined>;
	onNavigateToActivity?: (runId?: string) => void;
}) {
	const ceo = useMemo(() => orgEmployees.find((e) => e.isCeo), [orgEmployees]);

	const modelRouteParams = useMemo(
		() => ({
			agentLocalModelMap,
			employeeLocalModelMap,
			defaultModelId,
			modelOptionIdSet,
			modelOptions,
		}),
		[agentLocalModelMap, employeeLocalModelMap, defaultModelId, modelOptionIdSet, modelOptions]
	);

	const orgById = useMemo(() => new Map(orgEmployees.map((employee) => [employee.id, employee])), [orgEmployees]);

	const sortedRuns = useMemo(
		() =>
			[...orchestration.runs].sort(
				(a, b) =>
					Date.parse(b.lastEventAtIso ?? b.createdAtIso) - Date.parse(a.lastEventAtIso ?? a.createdAtIso)
			),
		[orchestration.runs]
	);

	const [selection, setSelection] = useState<SidebarSelection | null>(null);
	const [draft, setDraft] = useState('');
	const [moreOpen, setMoreOpen] = useState(false);
	const [detailJob, setDetailJob] = useState<AiSubAgentJob | null>(null);
	const moreRef = useRef<HTMLDivElement>(null);
	const threadRef = useRef<HTMLDivElement>(null);
	const composerInputRef = useRef<HTMLTextAreaElement>(null);

	const selectedRunId = selection?.kind === 'run' ? selection.runId : null;
	const selectedRun = selectedRunId ? orchestration.runs.find((r) => r.id === selectedRunId) : undefined;

	useEffect(() => {
		if (!selection && sortedRuns[0]?.id) {
			setSelection({ kind: 'run', runId: sortedRuns[0].id });
		}
		if (selectedRunId && !orchestration.runs.some((r) => r.id === selectedRunId)) {
			setSelection(sortedRuns[0] ? { kind: 'run', runId: sortedRuns[0].id } : null);
		}
	}, [selection, selectedRunId, sortedRuns, orchestration.runs]);

	useEffect(() => {
		if (!moreOpen) return;
		const onDoc = (event: MouseEvent) => {
			if (!moreRef.current?.contains(event.target as Node)) {
				setMoreOpen(false);
			}
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [moreOpen]);

	const thread = useMemo(() => {
		if (!selectedRunId) return [];
		return [...listMessagesByRun(selectedRunId)].sort(
			(a, b) => Date.parse(a.createdAtIso) - Date.parse(b.createdAtIso)
		);
	}, [listMessagesByRun, selectedRunId]);

	const streamDraft =
		ceoEmployeeId && selectedRunId ? employeeChatStreaming[ceoEmployeeId] : undefined;
	const streamErr = ceoEmployeeId && selectedRunId ? employeeChatError[ceoEmployeeId] : undefined;

	useEffect(() => {
		for (const message of thread) {
			if (message.toEmployeeId === ceoEmployeeId && !message.readAtIso) {
				onMarkMessageRead(message.id);
			}
		}
	}, [onMarkMessageRead, thread, ceoEmployeeId]);

	useEffect(() => {
		const el = threadRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, [selectedRunId, thread.length, streamDraft]);

	useEffect(() => {
		const el = composerInputRef.current;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
	}, [draft]);

	const pendingTasks = useMemo(() => {
		const msgs = orchestration.collabMessages;
		return msgs.filter(
			(m) =>
				(m.type === 'approval_request' || m.type === 'blocker') &&
				!m.toEmployeeId
		);
	}, [orchestration.collabMessages]);

	const [remoteItems, setRemoteItems] = useState<InboxItemJson[]>([]);

	const fetchRemoteInbox = useCallback(async () => {
		if (!workspaceId) return;
		try {
			const items = await apiListInboxItems(conn, workspaceId, { archived: false });
			setRemoteItems(items);
		} catch {
			/* optional */
		}
	}, [conn, workspaceId]);

	useEffect(() => {
		void fetchRemoteInbox();
	}, [fetchRemoteInbox, inboxVersion]);

	const unreadRemoteCount = useMemo(
		() => remoteItems.filter((item) => !item.read).length,
		[remoteItems]
	);

	const markAllRemoteRead = useCallback(async () => {
		const unreadIds = remoteItems.filter((item) => !item.read).map((item) => item.id);
		if (!unreadIds.length || !workspaceId) return;
		try {
			await apiBatchInbox(conn, workspaceId, unreadIds, 'read');
			setRemoteItems((prev) => prev.map((item) => ({ ...item, read: true })));
		} catch {
			/* ignore */
		}
	}, [conn, remoteItems, workspaceId]);

	const sendMessage = () => {
		const text = draft.trim();
		if (!text || !ceoEmployeeId) return;
		if (selectedRunId) {
			onSendMessage({
				runId: selectedRunId,
				type: 'text',
				body: text,
				summary: text.slice(0, 80),
				toEmployeeId: ceoEmployeeId,
			});
		} else {
			const runId = onCreateGroupRun(t('aiEmployees.inbox.defaultRunTitle'));
			if (runId) {
				setSelection({ kind: 'run', runId });
				onSendMessage({
					runId,
					type: 'text',
					body: text,
					summary: text.slice(0, 80),
					toEmployeeId: ceoEmployeeId,
				});
			}
		}
		setDraft('');
	};

	const newConversation = () => {
		const runId = onCreateGroupRun(t('aiEmployees.inbox.defaultRunTitle'));
		if (runId) {
			setSelection({ kind: 'run', runId });
			setDraft('');
		}
	};

	const taskMessage = selection?.kind === 'task'
		? orchestration.collabMessages.find((m) => m.id === selection.messageId)
		: undefined;
	const taskEmployee = taskMessage?.fromEmployeeId
		? orgById.get(taskMessage.fromEmployeeId)
		: undefined;

	const runPreviewById = useMemo(() => {
		const preview = new Map<string, string>();
		for (const run of sortedRuns) {
			preview.set(run.id, latestRunPreview(listMessagesByRun(run.id)));
		}
		return preview;
	}, [listMessagesByRun, sortedRuns]);

	const renderDelegationCard = (message: AiCollabMessage) => {
		const job = jobFromRun(selectedRun, message.subAgentJobId ?? message.cardMeta?.handoffId);
		if (job) {
			return (
				<SubAgentExecutionCard
					t={t}
					job={job}
					description={message.body}
					onOpenDetail={setDetailJob}
				/>
			);
		}
		const assignee = message.toEmployeeId ? orgById.get(message.toEmployeeId) : undefined;
		const placeholderJob: AiSubAgentJob = {
			id: message.subAgentJobId ?? message.cardMeta?.handoffId ?? message.id,
			runId: message.runId,
			employeeId: message.toEmployeeId ?? '',
			employeeName:
				(assignee?.displayName ?? message.summary) ||
				t('aiEmployees.groupChat.pendingAssignee'),
			taskTitle: message.summary || t('aiEmployees.groupChat.pendingTask'),
			taskDescription: message.body || '',
			status: 'queued',
			queuedAtIso: message.createdAtIso,
			toolLog: [],
		};
		return (
			<SubAgentExecutionCard
				t={t}
				job={placeholderJob}
				description={message.body}
				onOpenDetail={setDetailJob}
				isPlaceholder
			/>
		);
	};

	return (
		<div className="ref-ai-employees-inbox">
			<div className="ref-ai-employees-inbox-split">
				<div className="ref-ai-employees-inbox-list-col">
					<div className="ref-ai-employees-inbox-list-head">
						<div className="ref-ai-employees-inbox-list-head-left">
							<h2 className="ref-ai-employees-inbox-list-title">{t('aiEmployees.groupChat.sidebarTitle')}</h2>
						</div>
						<div className="ref-ai-employees-inbox-list-head-actions" ref={moreRef}>
							<button
								type="button"
								className="ref-ai-employees-btn ref-ai-employees-btn--secondary ref-ai-employees-inbox-new-run"
								onClick={newConversation}
							>
								<IconPlus className="ref-ai-employees-comm-send-ico" aria-hidden />
								{t('aiEmployees.groupChat.newConversation')}
							</button>
							<button
								type="button"
								className="ref-agent-sidebar-icon-btn"
								aria-expanded={moreOpen}
								aria-haspopup="menu"
								aria-label={t('aiEmployees.inbox.moreActions')}
								onClick={() => setMoreOpen((open) => !open)}
							>
								<IconDotsHorizontal />
							</button>
							{moreOpen ? (
								<div className="ref-void-select-menu ref-ai-employees-inbox-dropdown" role="menu">
									<button
										type="button"
										className="ref-void-select-option ref-ai-employees-inbox-dropdown-item"
										role="menuitem"
										onClick={() => {
											void markAllRemoteRead();
											setMoreOpen(false);
										}}
									>
										{t('aiEmployees.inbox.menuMarkAllRead')}
										{unreadRemoteCount > 0 ? ` (${unreadRemoteCount})` : ''}
									</button>
								</div>
							) : null}
						</div>
					</div>
					<div className="ref-ai-employees-inbox-list-scroll">
						{pendingTasks.length > 0 ? (
							<>
								<div className="ref-ai-employees-inbox-section-label">
									{t('aiEmployees.inbox.sectionTasks')}
									<span className="ref-ai-employees-inbox-section-label-count">{pendingTasks.length}</span>
								</div>
								<ul className="ref-ai-employees-inbox-peer-list" style={{ paddingTop: 0 }}>
									{pendingTasks.map((task) => {
										const fromName = orgById.get(task.fromEmployeeId ?? '')?.displayName ?? '?';
										const isActive = selection?.kind === 'task' && selection.messageId === task.id;
										return (
											<li key={task.id}>
												<button
													type="button"
													className={`ref-ai-employees-inbox-task-item ${isActive ? 'is-active' : ''}`}
													onClick={() => setSelection({ kind: 'task', messageId: task.id })}
												>
													<span
														className={`ref-ai-employees-inbox-task-dot ${
															task.type === 'approval_request'
																? 'ref-ai-employees-inbox-task-dot--approval'
																: 'ref-ai-employees-inbox-task-dot--blocker'
														}`}
													/>
													<span className="ref-ai-employees-inbox-task-meta">
														<span className="ref-ai-employees-inbox-task-title">{task.summary}</span>
														<span className="ref-ai-employees-inbox-task-from">{fromName}</span>
													</span>
												</button>
											</li>
										);
									})}
								</ul>
							</>
						) : null}

						<div className="ref-ai-employees-inbox-section-label">{t('aiEmployees.inbox.sectionConversations')}</div>
						{sortedRuns.length === 0 ? (
							<div className="ref-ai-employees-inbox-list-zero">
								<IconMessageCircle className="ref-ai-employees-inbox-list-zero-icon" aria-hidden />
								<p className="ref-ai-employees-inbox-list-zero-text">{t('aiEmployees.groupChat.noRuns')}</p>
							</div>
						) : (
							<ul className="ref-ai-employees-inbox-peer-list" aria-label={t('aiEmployees.inbox.railAria')}>
								{sortedRuns.map((run) => {
									const active = selection?.kind === 'run' && selection.runId === run.id;
									const preview = runPreviewById.get(run.id);
									return (
										<li key={run.id}>
											<button
												type="button"
												className={`ref-ai-employees-inbox-peer-row ${active ? 'is-active' : ''}`}
												onClick={() => setSelection({ kind: 'run', runId: run.id })}
											>
												<span className="ref-ai-employees-inbox-peer-avatar" aria-hidden>
													{'\u{1F4AC}'}
												</span>
												<span className="ref-ai-employees-inbox-peer-meta">
													<span className="ref-ai-employees-inbox-peer-name">{run.goal}</span>
													<span className="ref-ai-employees-inbox-peer-role">{runStatusBadge(t, run)}</span>
													{preview ? (
														<span className="ref-ai-employees-inbox-peer-preview">{preview}</span>
													) : null}
												</span>
												<span className="ref-ai-employees-inbox-peer-time">
													{formatChatMessageTime(run.lastEventAtIso ?? run.createdAtIso)}
												</span>
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</div>

				<div className="ref-ai-employees-inbox-detail">
					{selection?.kind === 'task' && taskMessage ? (
						<>
							<div className="ref-ai-employees-inbox-detail-headbar">
								<div className="ref-ai-employees-inbox-detail-headbar-main">
									<div className="ref-ai-employees-inbox-detail-title">{taskMessage.summary}</div>
									<div className="ref-ai-employees-inbox-detail-subtitle">
										{taskEmployee?.displayName ?? '?'} ·{' '}
										{taskMessage.type === 'approval_request'
											? t('aiEmployees.collab.approvalRequest')
											: t('aiEmployees.collab.blocker')}
									</div>
								</div>
							</div>
							<div className="ref-ai-employees-comm-thread" style={{ padding: '24px 18px' }}>
								<CollabCard t={t} message={taskMessage} employeeMap={orgById} />
								{taskMessage.body ? (
									<div
										style={{
											marginTop: 16,
											fontSize: 13,
											lineHeight: 1.6,
											color: 'var(--void-fg-1, #9aa4b2)',
											whiteSpace: 'pre-wrap',
										}}
									>
										{taskMessage.body}
									</div>
								) : null}
							</div>
						</>
					) : null}

					{selection?.kind === 'run' && !selectedRun ? (
						<div className="ref-ai-employees-inbox-detail-empty">
							<IconMessageCircle className="ref-ai-employees-inbox-detail-empty-ico ref-ai-employees-inbox-detail-empty-ico--muted" aria-hidden />
							<p className="ref-ai-employees-inbox-detail-empty-title">{t('aiEmployees.inbox.detailPickTitle')}</p>
							<p className="ref-ai-employees-inbox-detail-empty-hint ref-ai-employees-muted">
								{t('aiEmployees.groupChat.pickRunHint')}
							</p>
						</div>
					) : null}

					{selection?.kind === 'run' && selectedRun ? (
						<>
							<div className="ref-ai-employees-inbox-detail-headbar">
								<div className="ref-ai-employees-inbox-detail-headbar-main">
									<div className="ref-ai-employees-inbox-detail-subtitle">
										{t('aiEmployees.groupChat.headerLine')}
									</div>
									<div className="ref-ai-employees-inbox-detail-title">{selectedRun.goal}</div>
									<div className="ref-ai-employees-inbox-detail-meta">
										<span className={`ref-ai-employees-run-badge ${runStatusTone(selectedRun)}`}>
											{runStatusBadge(t, selectedRun)}
										</span>
										{ceo ? (
											<span
												className="ref-ai-employees-inbox-detail-model"
												title={
													formatEmployeeResolvedModelLabel({
														employee: ceo,
														...modelRouteParams,
													}) ?? ''
												}
											>
												CEO: {ceo.displayName} ·{' '}
												{formatEmployeeResolvedModelLabel({
													employee: ceo,
													...modelRouteParams,
												}) ?? t('aiEmployees.modelDisplayNone')}
											</span>
										) : null}
									</div>
								</div>
								{onNavigateToActivity ? (
									<button
										type="button"
										className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-inbox-run-bar-link"
										onClick={() => onNavigateToActivity(selectedRun.id)}
									>
										{t('aiEmployees.inbox.viewDetails')}
									</button>
								) : null}
							</div>
							<div ref={threadRef} className="ref-ai-employees-comm-thread ref-ai-employees-inbox-chat-thread" role="log" aria-live="polite">
								{streamErr ? (
									<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
										{streamErr}
									</div>
								) : null}
								{thread.length === 0 && streamDraft === undefined ? (
									<div className="ref-ai-employees-inbox-thread-empty ref-ai-employees-muted">{t('aiEmployees.inbox.threadEmptyHint')}</div>
								) : (
									thread.map((message, idx) => {
										const prev = thread[idx - 1];
										const showDay =
											!prev || calendarDayKey(prev.createdAtIso) !== calendarDayKey(message.createdAtIso);
										const isUser = Boolean(ceoEmployeeId && message.toEmployeeId === ceoEmployeeId && !message.fromEmployeeId);

										if (message.type === 'task_assignment' && message.subAgentJobId) {
											return (
												<Fragment key={message.id}>
													{showDay ? (
														<div className="ref-ai-employees-inbox-chat-day" role="separator" aria-label={formatChatDayDivider(message.createdAtIso)}>
															{formatChatDayDivider(message.createdAtIso)}
														</div>
													) : null}
													<div className="ref-ai-employees-inbox-chat-row is-full">
														{renderDelegationCard(message)}
													</div>
												</Fragment>
											);
										}

										if (message.type === 'result' && message.subAgentJobId) {
											return (
												<Fragment key={message.id}>
													{showDay ? (
														<div className="ref-ai-employees-inbox-chat-day" role="separator" aria-label={formatChatDayDivider(message.createdAtIso)}>
															{formatChatDayDivider(message.createdAtIso)}
														</div>
													) : null}
													<div className="ref-ai-employees-inbox-chat-row is-full">
														{renderDelegationCard(message)}
													</div>
												</Fragment>
											);
										}

										if (isStructuredMessage(message)) {
											return (
												<Fragment key={message.id}>
													{showDay ? (
														<div className="ref-ai-employees-inbox-chat-day" role="separator" aria-label={formatChatDayDivider(message.createdAtIso)}>
															{formatChatDayDivider(message.createdAtIso)}
														</div>
													) : null}
													<div className={`ref-ai-employees-inbox-chat-row ${isUser ? 'is-user' : 'is-peer'}`}>
														{!isUser ? (
															<InboxChatAvatarSlot
																conn={conn}
																workspaceId={workspaceId}
																employee={message.fromEmployeeId ? orgById.get(message.fromEmployeeId) ?? ceo ?? null : ceo ?? null}
															/>
														) : null}
														<CollabCard t={t} message={message} employeeMap={orgById} />
													</div>
												</Fragment>
											);
										}

										const peerFace =
											!isUser && message.fromEmployeeId ? orgById.get(message.fromEmployeeId) ?? ceo ?? null : !isUser ? ceo ?? null : null;
										return (
											<Fragment key={message.id}>
												{showDay ? (
													<div className="ref-ai-employees-inbox-chat-day" role="separator" aria-label={formatChatDayDivider(message.createdAtIso)}>
														{formatChatDayDivider(message.createdAtIso)}
													</div>
												) : null}
												<div className={`ref-ai-employees-inbox-chat-row ${isUser ? 'is-user' : 'is-peer'}`}>
													{!isUser ? (
														<InboxChatAvatarSlot conn={conn} workspaceId={workspaceId} employee={peerFace} />
													) : null}
													<div className={`ref-ai-employees-inbox-chat-msg ${isUser ? 'is-user' : 'is-peer'}`}>
														<div
															className={`ref-ai-employees-comm-bubble ${
																isUser ? 'ref-ai-employees-comm-bubble--user' : 'ref-ai-employees-comm-bubble--system'
															}`}
														>
															{!isUser ? (
																<div className="ref-ai-employees-skill-md-preview ref-ai-employees-comm-bubble-md">
																	<ReactMarkdown remarkPlugins={[remarkGfm]}>{message.body ?? ''}</ReactMarkdown>
																</div>
															) : (
																message.body
															)}
														</div>
														<time className="ref-ai-employees-inbox-chat-time" dateTime={message.createdAtIso}>
															{formatChatMessageTime(message.createdAtIso)}
														</time>
													</div>
													{isUser ? (
														<div className="ref-ai-employees-inbox-chat-avatar" aria-hidden>
															<span className="ref-ai-employees-inbox-chat-avatar-ph ref-ai-employees-inbox-chat-avatar-ph--user">Me</span>
														</div>
													) : null}
												</div>
											</Fragment>
										);
									})
								)}
								{streamDraft !== undefined && ceo ? (
									<div className="ref-ai-employees-inbox-chat-row is-peer">
										<InboxChatAvatarSlot conn={conn} workspaceId={workspaceId} employee={ceo} />
										<div className="ref-ai-employees-inbox-chat-msg is-peer ref-ai-employees-inbox-chat-msg--streaming">
											<div
												className="ref-ai-employees-comm-bubble ref-ai-employees-comm-bubble--system ref-ai-employees-inbox-streaming"
												aria-busy={!streamDraft}
												aria-label={streamDraft ? t('aiEmployees.inbox.streamingLabel') : t('aiEmployees.inbox.typing')}
											>
												{streamDraft ? (
													<div className="ref-ai-employees-inbox-stream-body ref-ai-employees-skill-md-preview ref-ai-employees-comm-bubble-md">
														<ReactMarkdown remarkPlugins={[remarkGfm]}>{streamDraft}</ReactMarkdown>
													</div>
												) : (
													<span className="ref-ai-employees-typing-dots" aria-hidden>
														<span />
														<span />
														<span />
													</span>
												)}
											</div>
											<time className="ref-ai-employees-inbox-chat-time" dateTime={new Date().toISOString()}>
												{t('aiEmployees.inbox.justNow')}
											</time>
										</div>
									</div>
								) : null}
							</div>
							<div className="ref-ai-employees-comm-composer-wrap">
								<div className="ref-ai-employees-comm-composer ref-ai-employees-inbox-composer">
									<div className="ref-ai-employees-inbox-composer-inner">
										<textarea
											ref={composerInputRef}
											className="ref-ai-employees-comm-input ref-ai-employees-input ref-ai-employees-inbox-composer-input"
											rows={1}
											value={draft}
											placeholder={t('aiEmployees.inbox.messagePlaceholder')}
											onChange={(event) => setDraft(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === 'Enter' && !event.shiftKey) {
													event.preventDefault();
													sendMessage();
												}
											}}
										/>
										<button
											type="button"
											className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-inbox-composer-send"
											disabled={!draft.trim() || !ceoEmployeeId}
											onClick={sendMessage}
											aria-label={t('aiEmployees.inbox.send')}
										>
											<IconArrowUp className="ref-ai-employees-comm-send-ico" aria-hidden />
										</button>
									</div>
								</div>
							</div>
						</>
					) : null}

					{!selection ? (
						<div className="ref-ai-employees-inbox-detail-empty">
							<IconMessageCircle className="ref-ai-employees-inbox-detail-empty-ico ref-ai-employees-inbox-detail-empty-ico--muted" aria-hidden />
							<p className="ref-ai-employees-inbox-detail-empty-title">{t('aiEmployees.inbox.detailPickTitle')}</p>
							<p className="ref-ai-employees-inbox-detail-empty-hint ref-ai-employees-muted">{t('aiEmployees.groupChat.pickRunHint')}</p>
						</div>
					) : null}
				</div>
			</div>
			<SubAgentDetailPanel t={t} job={detailJob} onClose={() => setDetailJob(null)} />
		</div>
	);
}
