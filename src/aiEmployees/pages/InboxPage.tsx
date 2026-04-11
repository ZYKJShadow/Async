import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from '../../i18n';
import { IconDotsHorizontal, IconMessageCircle, IconSend } from '../../icons';
import type {
	AiCollabMessage,
	AiEmployeesOrchestrationState,
	AiOrchestrationRun,
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

/* ─── Helpers ──────────────────────────────────────────────── */

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

type SidebarSelection =
	| { kind: 'employee'; employeeId: string }
	| { kind: 'task'; messageId: string };

/* ─── Component ────────────────────────────────────────────── */

export function InboxPage({
	t,
	orgEmployees,
	orchestration: _orchestration,
	conn,
	workspaceId,
	inboxVersion,
	agentLocalModelMap,
	employeeLocalModelMap,
	defaultModelId,
	modelOptions,
	modelOptionIdSet,
	onCreateRun,
	onSendMessage,
	onMarkMessageRead,
	listMessagesByEmployee,
	findActiveRunByEmployee,
	employeeChatStreaming,
	employeeChatError,
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
	employeeChatStreaming: Record<string, string>;
	employeeChatError: Record<string, string | undefined>;
	onCreateRun: (employeeId: string, title: string, details: string, targetBranch: string) => string;
	onSendMessage: (input: {
		runId: string;
		type?: 'text' | 'task_assignment';
		body: string;
		summary?: string;
		toEmployeeId?: string;
	}) => void;
	onMarkMessageRead: (messageId: string) => void;
	listMessagesByEmployee: (employeeId: string) => AiCollabMessage[];
	findActiveRunByEmployee: (employeeId: string) => AiOrchestrationRun | undefined;
}) {
	const sorted = useMemo(
		() => [...orgEmployees].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })),
		[orgEmployees]
	);

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

	const employeeModelLine = useCallback(
		(employee: OrgEmployee) =>
			formatEmployeeResolvedModelLabel({ employee, ...modelRouteParams }) ?? t('aiEmployees.modelDisplayNone'),
		[modelRouteParams, t]
	);

	const orgById = useMemo(() => new Map(sorted.map((employee) => [employee.id, employee])), [sorted]);
	const leadEmployee = useMemo(() => sorted.find((employee) => employee.isCeo) ?? sorted[0] ?? null, [sorted]);

	const [selection, setSelection] = useState<SidebarSelection | null>(null);
	const [draft, setDraft] = useState('');
	const [moreOpen, setMoreOpen] = useState(false);
	const moreRef = useRef<HTMLDivElement>(null);

	const selectedEmployeeId = selection?.kind === 'employee' ? selection.employeeId : null;

	// Pending tasks for the user: approval_request + blocker messages without a response
	const pendingTasks = useMemo(() => {
		const msgs = _orchestration.collabMessages;
		return msgs.filter(
			(m) =>
				(m.type === 'approval_request' || m.type === 'blocker') &&
				!m.toEmployeeId // sent to user (no toEmployeeId = user-facing)
		);
	}, [_orchestration.collabMessages]);

	// Remote inbox items from server API
	const [remoteItems, setRemoteItems] = useState<InboxItemJson[]>([]);

	const fetchRemoteInbox = useCallback(async () => {
		if (!workspaceId) return;
		try {
			const items = await apiListInboxItems(conn, workspaceId, { archived: false });
			setRemoteItems(items);
		} catch {
			// Remote inbox is optional
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
			// ignore
		}
	}, [conn, remoteItems, workspaceId]);

	// Auto-select first employee if nothing selected
	useEffect(() => {
		if (!selection && sorted[0]?.id) {
			setSelection({ kind: 'employee', employeeId: sorted[0].id });
		}
		if (selectedEmployeeId && !sorted.some((employee) => employee.id === selectedEmployeeId)) {
			setSelection(sorted[0] ? { kind: 'employee', employeeId: sorted[0].id } : null);
		}
	}, [selection, selectedEmployeeId, sorted]);

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

	const selected = selectedEmployeeId ? sorted.find((employee) => employee.id === selectedEmployeeId) : undefined;
	const thread = useMemo(() => {
		if (!selectedEmployeeId) return [];
		return [...listMessagesByEmployee(selectedEmployeeId)].sort(
			(a, b) => Date.parse(a.createdAtIso) - Date.parse(b.createdAtIso)
		);
	}, [listMessagesByEmployee, selectedEmployeeId]);
	const streamDraft = selectedEmployeeId ? employeeChatStreaming[selectedEmployeeId] : undefined;
	const streamErr = selectedEmployeeId ? employeeChatError[selectedEmployeeId] : undefined;
	const activeRun = selectedEmployeeId ? findActiveRunByEmployee(selectedEmployeeId) : undefined;

	useEffect(() => {
		for (const message of thread) {
			if (message.toEmployeeId === selectedEmployeeId && !message.readAtIso) {
				onMarkMessageRead(message.id);
			}
		}
	}, [onMarkMessageRead, selectedEmployeeId, thread]);

	const unreadCountByEmployee = useMemo(() => {
		const map = new Map<string, number>();
		for (const employee of sorted) {
			const unread = listMessagesByEmployee(employee.id).filter(
				(message) => message.toEmployeeId === employee.id && !message.readAtIso
			).length;
			map.set(employee.id, unread);
		}
		return map;
	}, [listMessagesByEmployee, sorted]);

	const sendMessage = () => {
		const text = draft.trim();
		if (!selectedEmployeeId || !text) return;
		if (activeRun) {
			onSendMessage({
				runId: activeRun.id,
				type: 'text',
				body: text,
				summary: text.slice(0, 80),
				toEmployeeId: selectedEmployeeId,
			});
		} else {
			onCreateRun(selectedEmployeeId, t('aiEmployees.inbox.defaultRunTitle'), text, '');
		}
		setDraft('');
	};

	// When viewing a task message, find the related employee for the detail panel
	const taskMessage = selection?.kind === 'task'
		? _orchestration.collabMessages.find((m) => m.id === selection.messageId)
		: undefined;
	const taskEmployee = taskMessage?.fromEmployeeId
		? orgById.get(taskMessage.fromEmployeeId)
		: undefined;

	return (
		<div className="ref-ai-employees-inbox">
			<div className="ref-ai-employees-inbox-split">
				{/* ── Left sidebar ── */}
				<div className="ref-ai-employees-inbox-list-col">
					<div className="ref-ai-employees-inbox-list-head">
						<div className="ref-ai-employees-inbox-list-head-left">
							<h2 className="ref-ai-employees-inbox-list-title">{t('aiEmployees.tab.inbox')}</h2>
						</div>
						<div className="ref-ai-employees-inbox-list-head-actions" ref={moreRef}>
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
								<div className="ref-ai-employees-inbox-dropdown" role="menu">
									<button
										type="button"
										className="ref-ai-employees-inbox-dropdown-item"
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
						{/* Tasks / Approvals section */}
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

						{/* Conversations section */}
						<div className="ref-ai-employees-inbox-section-label">
							{t('aiEmployees.inbox.sectionConversations')}
						</div>
						{sorted.length === 0 ? (
							<div className="ref-ai-employees-inbox-list-zero">
								<IconMessageCircle className="ref-ai-employees-inbox-list-zero-icon" aria-hidden />
								<p className="ref-ai-employees-inbox-list-zero-text">{t('aiEmployees.inbox.noThreads')}</p>
							</div>
						) : (
							<ul className="ref-ai-employees-inbox-peer-list" aria-label={t('aiEmployees.inbox.railAria')}>
								{sorted.map((employee) => {
									const active = selection?.kind === 'employee' && employee.id === selectedEmployeeId;
									const initial = employee.displayName.trim().slice(0, 1).toUpperCase() || '?';
									const unread = unreadCountByEmployee.get(employee.id) ?? 0;
									const run = findActiveRunByEmployee(employee.id);
									const modelLine = employeeModelLine(employee);
									return (
										<li key={employee.id}>
											<button
												type="button"
												className={`ref-ai-employees-inbox-peer-row ${active ? 'is-active' : ''}`}
												onClick={() => setSelection({ kind: 'employee', employeeId: employee.id })}
											>
												<span className="ref-ai-employees-inbox-peer-avatar" aria-hidden>
													{initial}
												</span>
												<span className="ref-ai-employees-inbox-peer-meta">
													<span className="ref-ai-employees-inbox-peer-name">{employee.displayName}</span>
													<span className="ref-ai-employees-inbox-peer-role">
														{run?.statusSummary ?? (employee.customRoleTitle || employee.roleKey)}
													</span>
													<span className="ref-ai-employees-inbox-peer-model" title={modelLine}>
														{modelLine}
													</span>
												</span>
												{unread > 0 ? <span className="ref-ai-employees-inbox-peer-badge">{unread}</span> : null}
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</div>

				{/* ── Right detail panel ── */}
				<div className="ref-ai-employees-inbox-detail">
					{/* Task detail view */}
					{selection?.kind === 'task' && taskMessage ? (
						<>
							<div className="ref-ai-employees-inbox-detail-headbar">
								<div className="ref-ai-employees-inbox-detail-headbar-main">
									<div className="ref-ai-employees-inbox-detail-title">{taskMessage.summary}</div>
									<div className="ref-ai-employees-inbox-detail-subtitle">
										{taskEmployee?.displayName ?? '?'} · {taskMessage.type === 'approval_request'
											? t('aiEmployees.collab.approvalRequest')
											: t('aiEmployees.collab.blocker')}
									</div>
								</div>
							</div>
							<div className="ref-ai-employees-comm-thread" style={{ padding: '24px 18px' }}>
								<CollabCard
									t={t}
									message={taskMessage}
									employeeMap={orgById}
								/>
								{taskMessage.body ? (
									<div style={{ marginTop: 16, fontSize: 13, lineHeight: 1.6, color: 'var(--void-fg-1, #9aa4b2)', whiteSpace: 'pre-wrap' }}>
										{taskMessage.body}
									</div>
								) : null}
								{taskMessage.type === 'approval_request' ? (
									<div className="ref-ai-employees-collab-card-actions" style={{ marginTop: 16 }}>
										<button
											type="button"
											className="ref-ai-employees-btn ref-ai-employees-btn--primary"
										>
											{t('aiEmployees.inbox.approveAction')}
										</button>
										<button
											type="button"
											className="ref-ai-employees-btn ref-ai-employees-btn--secondary"
										>
											{t('aiEmployees.inbox.rejectAction')}
										</button>
									</div>
								) : null}
							</div>
						</>
					) : null}

					{/* Employee chat view */}
					{selection?.kind === 'employee' && !selected ? (
						<div className="ref-ai-employees-inbox-detail-empty">
							<IconMessageCircle className="ref-ai-employees-inbox-detail-empty-ico ref-ai-employees-inbox-detail-empty-ico--muted" aria-hidden />
							<p className="ref-ai-employees-inbox-detail-empty-title">{t('aiEmployees.inbox.detailPickTitle')}</p>
							<p className="ref-ai-employees-inbox-detail-empty-hint ref-ai-employees-muted">{t('aiEmployees.inbox.detailPickHint')}</p>
						</div>
					) : null}

					{selection?.kind === 'employee' && selected ? (
						<>
							<div className="ref-ai-employees-inbox-detail-headbar">
								<div className="ref-ai-employees-inbox-detail-headbar-main">
									<div className="ref-ai-employees-inbox-detail-title">{selected.displayName}</div>
									<div className="ref-ai-employees-inbox-detail-subtitle">{selected.customRoleTitle || selected.roleKey}</div>
									<div className="ref-ai-employees-inbox-detail-model" title={employeeModelLine(selected)}>
										{employeeModelLine(selected)}
									</div>
								</div>
							</div>
							<div className="ref-ai-employees-comm-thread ref-ai-employees-inbox-chat-thread" role="log" aria-live="polite">
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
										const isUser = message.toEmployeeId === selected.id;

										// Render structured messages as cards
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
																employee={message.fromEmployeeId ? orgById.get(message.fromEmployeeId) ?? selected : selected}
															/>
														) : null}
														<CollabCard
															t={t}
															message={message}
															employeeMap={orgById}
														/>
													</div>
												</Fragment>
											);
										}

										// Regular text messages
										const peerFace =
											!isUser && message.fromEmployeeId
												? orgById.get(message.fromEmployeeId) ?? selected
												: !isUser
													? selected
													: null;
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
															{message.body}
														</div>
														<time className="ref-ai-employees-inbox-chat-time" dateTime={message.createdAtIso}>
															{formatChatMessageTime(message.createdAtIso)}
														</time>
													</div>
													{isUser ? (
														<InboxChatAvatarSlot conn={conn} workspaceId={workspaceId} employee={leadEmployee} />
													) : null}
												</div>
											</Fragment>
										);
									})
								)}
								{streamDraft !== undefined ? (
									<div className="ref-ai-employees-inbox-chat-row is-peer">
										<InboxChatAvatarSlot conn={conn} workspaceId={workspaceId} employee={selected} />
										<div className="ref-ai-employees-inbox-chat-msg is-peer ref-ai-employees-inbox-chat-msg--streaming">
											<div
												className="ref-ai-employees-comm-bubble ref-ai-employees-comm-bubble--system ref-ai-employees-inbox-streaming"
												aria-busy={!streamDraft}
												aria-label={streamDraft ? t('aiEmployees.inbox.streamingLabel') : t('aiEmployees.inbox.typing')}
											>
												{streamDraft ? (
													<div className="ref-ai-employees-inbox-stream-body">{streamDraft}</div>
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
											className="ref-ai-employees-comm-input ref-ai-employees-input ref-ai-employees-inbox-composer-input"
											rows={2}
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
											disabled={!draft.trim()}
											onClick={sendMessage}
											aria-label={t('aiEmployees.inbox.send')}
										>
											<IconSend className="ref-ai-employees-comm-send-ico" aria-hidden />
										</button>
									</div>
								</div>
							</div>
						</>
					) : null}

					{/* Nothing selected at all */}
					{!selection ? (
						<div className="ref-ai-employees-inbox-detail-empty">
							<IconMessageCircle className="ref-ai-employees-inbox-detail-empty-ico ref-ai-employees-inbox-detail-empty-ico--muted" aria-hidden />
							<p className="ref-ai-employees-inbox-detail-empty-title">{t('aiEmployees.inbox.detailPickTitle')}</p>
							<p className="ref-ai-employees-inbox-detail-empty-hint ref-ai-employees-muted">{t('aiEmployees.inbox.detailPickHint')}</p>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
