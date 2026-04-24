import { memo, type RefObject } from 'react';
import { IconPencil, IconTrash } from '../icons';
import { normWorkspaceRootKey } from '../workspaceRootKey';
import type { TFunction } from '../i18n';
import type { ThreadInfo } from '../threadTypes';
import { threadRowTitle } from './threadRowUi';

function formatRelativeTime(t: TFunction, timestamp: number): string {
	const now = Date.now();
	const diffMs = now - timestamp;
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHour = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHour / 24);

	if (diffSec < 60) return t('time.justNow');
	if (diffMin < 60) return t('time.minutesAgo', { count: diffMin });
	if (diffHour < 24) return t('time.hoursAgo', { count: diffHour });
	if (diffDay < 30) return t('time.daysAgo', { count: diffDay });
	if (diffDay < 365) return t('time.monthsAgo', { count: Math.floor(diffDay / 30) });
	return t('time.yearsAgo', { count: Math.floor(diffDay / 365) });
}

export type AgentSidebarThreadItemProps = {
	th: ThreadInfo;
	threadListWorkspace?: string | null;
	workspace: string | null;
	currentId: string | null;
	hasUnreadAgentReply?: boolean;
	editingThreadId: string | null;
	editingThreadTitleDraft: string;
	setEditingThreadTitleDraft: (v: string) => void;
	threadTitleDraftRef: { current: string };
	threadTitleInputRef: RefObject<HTMLInputElement | null>;
	commitThreadTitleEdit: () => Promise<void>;
	cancelThreadTitleEdit: () => void;
	beginThreadTitleEdit: (t: ThreadInfo, threadListWorkspace?: string | null) => void;
	onSelectThread: (id: string, threadListWorkspace?: string | null) => Promise<void>;
	confirmDeleteId: string | null;
	onDeleteThread: (
		e: React.MouseEvent,
		id: string,
		threadWorkspaceRoot?: string | null
	) => Promise<void>;
	t: TFunction;
};

function AgentSidebarThreadItemImpl(props: AgentSidebarThreadItemProps) {
	const {
		th,
		threadListWorkspace,
		workspace,
		currentId,
		hasUnreadAgentReply = false,
		editingThreadId,
		editingThreadTitleDraft,
		setEditingThreadTitleDraft,
		threadTitleDraftRef,
		threadTitleInputRef,
		commitThreadTitleEdit,
		cancelThreadTitleEdit,
		beginThreadTitleEdit,
		onSelectThread,
		confirmDeleteId,
		onDeleteThread,
		t,
	} = props;

	const owningWs = threadListWorkspace ?? workspace;
	const isActive =
		th.id === currentId &&
		(!workspace || !owningWs || normWorkspaceRootKey(owningWs) === normWorkspaceRootKey(workspace));
	const isWorking = Boolean(th.isAwaitingReply);
	const showUnread = hasUnreadAgentReply && !isActive && !isWorking;

	return (
		<div
			className={`ref-agent-thread-item ${isActive ? 'is-active' : ''} ${
				isWorking ? 'is-awaiting-reply' : ''
			} ${showUnread ? 'has-unread-reply' : ''} ${
				editingThreadId === th.id ? 'is-editing-title' : ''
			}`}
		>
			{editingThreadId === th.id ? (
				<input
					ref={threadTitleInputRef}
					type="text"
					className="ref-agent-thread-title-input"
					value={editingThreadTitleDraft}
					aria-label={t('common.threadTitle')}
					onChange={(e) => {
						const v = e.target.value;
						setEditingThreadTitleDraft(v);
						threadTitleDraftRef.current = v;
					}}
					onClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							void commitThreadTitleEdit();
						}
						if (e.key === 'Escape') {
							e.preventDefault();
							cancelThreadTitleEdit();
						}
					}}
					onBlur={() => void commitThreadTitleEdit()}
				/>
			) : (
				<button
					type="button"
					className="ref-agent-thread-row"
					onClick={() => void onSelectThread(th.id, threadListWorkspace)}
					onDoubleClick={(e) => {
						e.preventDefault();
						beginThreadTitleEdit(th, threadListWorkspace);
					}}
				>
					<span className="ref-agent-thread-row-title">{threadRowTitle(t, th)}</span>
					{isWorking ? (
						<span className="ref-agent-thread-status ref-agent-thread-status--working" aria-label="Agent 正在回复">
							<span aria-hidden />
							<span aria-hidden />
							<span aria-hidden />
						</span>
					) : showUnread ? (
						<span className="ref-agent-thread-status ref-agent-thread-status--unread" aria-label="有未读回复" />
					) : null}
					<span className="ref-agent-thread-row-time">
						{formatRelativeTime(t, th.updatedAt)}
					</span>
				</button>
			)}
			<div className="ref-agent-thread-row-actions">
				<button
					type="button"
					className="ref-agent-thread-action"
					title={t('common.rename')}
					aria-label={t('common.renameThread')}
					onMouseDown={(e) => e.preventDefault()}
					onClick={(e) => {
						e.stopPropagation();
						beginThreadTitleEdit(th, threadListWorkspace);
					}}
				>
					<IconPencil className="ref-agent-thread-action-svg" />
				</button>
				<button
					type="button"
					className={`ref-agent-thread-action ${
						confirmDeleteId === th.id ? 'ref-agent-thread-action--confirm' : ''
					}`}
					title={confirmDeleteId === th.id ? t('common.confirmDelete') : t('common.delete')}
					aria-label={confirmDeleteId === th.id ? t('common.confirmDelete') : t('common.deleteThread')}
					onMouseDown={(e) => e.preventDefault()}
					onClick={(e) => void onDeleteThread(e, th.id, threadListWorkspace)}
				>
					{confirmDeleteId === th.id ? (
						<span className="ref-agent-thread-action-confirm-label">{t('common.confirm')}</span>
					) : (
						<IconTrash className="ref-agent-thread-action-svg" />
					)}
				</button>
			</div>
		</div>
	);
}

export const AgentSidebarThreadItem = memo(AgentSidebarThreadItemImpl);
