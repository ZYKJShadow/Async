import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import { VoidSelect } from '../../VoidSelect';
import type { AgentJson, CreateIssuePayload, IssueJson, ProjectJson, WorkspaceMemberJson } from '../api/types';
import { BoardPage } from './BoardPage';
import { IssueDetailPanel } from './IssueDetailPanel';
import { CreateIssueDialog } from '../components/CreateIssueDialog';
import { IssueStatusChip } from '../components/IssueStatusChip';
import { IssuesHubIconMenus } from '../components/IssuesHubIconMenus';
import type { FilterOption } from '../components/FilterDropdown';
import { PriorityBadge } from '../components/PriorityBadge';
import { notifyAiEmployeesRequestFailed } from '../AiEmployeesNetworkToast';
import {
	applyFilters,
	type IssueBoardState,
	type IssueSortBy,
	sortIssues,
	DEFAULT_ISSUE_BOARD_STATE,
} from '../domain/issueBoard';
import { batchAssigneeVoidOptions, issueStatusVoidOptions, priorityFieldVoidOptions } from '../voidSelectOptions';

export type IssuesHubVariant = 'workspace' | 'my';

type AssigneeScopeFilter = 'all' | 'members' | 'agents';

const BATCH_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked'] as const;

function isDoneLike(status: string): boolean {
	const s = (status || '').toLowerCase();
	return s === 'done' || s === 'cancelled' || s === 'closed';
}

const STATUS_OPTS: FilterOption[] = [
	{ value: 'backlog', label: 'backlog' },
	{ value: 'todo', label: 'todo' },
	{ value: 'in_progress', label: 'in progress' },
	{ value: 'in_review', label: 'in review' },
	{ value: 'done', label: 'done' },
	{ value: 'blocked', label: 'blocked' },
	{ value: 'cancelled', label: 'cancelled' },
];

function priorityOptions(t: TFunction): FilterOption[] {
	return [
		{ value: 'urgent', label: t('aiEmployees.issuesHub.priorityUrgent') },
		{ value: 'high', label: t('aiEmployees.issuesHub.priorityHigh') },
		{ value: 'medium', label: t('aiEmployees.issuesHub.priorityMedium') },
		{ value: 'low', label: t('aiEmployees.issuesHub.priorityLow') },
		{ value: 'none', label: t('aiEmployees.issuesHub.priorityNone') },
	];
}

export function IssuesHubPage({
	t,
	issues,
	issuesLookup,
	variant,
	agents,
	members,
	projects = [],
	workspaceDisplayName,
	onPatchIssue,
	onCreateIssue,
	onDeleteIssue,
	openCreateSignal = 0,
}: {
	t: TFunction;
	issues: IssueJson[];
	issuesLookup?: IssueJson[];
	variant: IssuesHubVariant;
	agents: AgentJson[];
	members: WorkspaceMemberJson[];
	projects?: ProjectJson[];
	/** 顶栏工作区名，传入新建任务弹窗面包屑 */
	workspaceDisplayName?: string;
	openCreateSignal?: number;
	onPatchIssue: (issueId: string, patch: Record<string, unknown>) => Promise<void>;
	onCreateIssue: (payload: CreateIssuePayload) => Promise<void | IssueJson>;
	onDeleteIssue?: (issueId: string) => Promise<void>;
}) {
	const [scope, setScope] = useState<'active' | 'all'>(variant === 'my' ? 'active' : 'all');
	const [assigneeScope, setAssigneeScope] = useState<AssigneeScopeFilter>('all');
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [boardState, setBoardState] = useState<IssueBoardState>(DEFAULT_ISSUE_BOARD_STATE);
	const [createOpen, setCreateOpen] = useState(false);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	const [batchStatusV, setBatchStatusV] = useState('__ph');
	const [batchPriorityV, setBatchPriorityV] = useState('__ph');
	const [batchAssigneeV, setBatchAssigneeV] = useState('__ph');

	const lookupList = issuesLookup ?? issues;

	const scoped = useMemo(() => {
		let list = issues;
		if (variant === 'workspace') {
			if (assigneeScope === 'members') {
				list = list.filter((i) => i.assignee_type === 'member');
			} else if (assigneeScope === 'agents') {
				list = list.filter((i) => i.assignee_type === 'agent');
			}
		}
		if (variant === 'my' && scope === 'active') {
			list = list.filter((i) => !isDoneLike(i.status));
		}
		return list;
	}, [issues, variant, scope, assigneeScope]);

	const filtered = useMemo(() => applyFilters(scoped, boardState), [scoped, boardState]);
	const displayIssues = useMemo(
		() => sortIssues(filtered, boardState.sortBy as IssueSortBy, boardState.sortDirection),
		[filtered, boardState.sortBy, boardState.sortDirection]
	);

	const selected = selectedId ? issues.find((i) => i.id === selectedId) ?? null : null;
	const parentIssue =
		selected?.parent_issue_id ? lookupList.find((i) => i.id === selected.parent_issue_id) ?? null : null;

	const openIssue = useCallback((issue: IssueJson) => setSelectedId(issue.id), []);

	const assigneeOptions: FilterOption[] = useMemo(() => {
		const m: FilterOption[] = members.map((x) => ({ value: `member:${x.user_id}`, label: x.name }));
		const a: FilterOption[] = agents.map((x) => ({ value: `agent:${x.id}`, label: x.name }));
		return [...m, ...a];
	}, [agents, members]);

	const statusOptionsLabeled = useMemo(
		() =>
			STATUS_OPTS.map((o) => {
				const key = `aiEmployees.boardColumn.${o.value}` as const;
				const lab = t(key);
				return { value: o.value, label: lab === key ? o.value.replace(/_/g, ' ') : lab };
			}),
		[t]
	);

	const batchStatusOpts = useMemo(
		() => [
			{ value: '__ph', label: t('aiEmployees.issuesHub.batchChangeStatus'), disabled: true },
			...issueStatusVoidOptions(t, BATCH_STATUSES),
		],
		[t],
	);
	const batchPriorityOpts = useMemo(
		() => [
			{ value: '__ph', label: t('aiEmployees.issuesHub.batchChangePriority'), disabled: true },
			...priorityFieldVoidOptions(t),
		],
		[t],
	);
	const batchAssigneeOpts = useMemo(() => batchAssigneeVoidOptions(t, members, agents), [t, members, agents]);

	const groupedList = useMemo(() => {
		const m = new Map<string, IssueJson[]>();
		for (const i of displayIssues) {
			const st = i.status || 'backlog';
			const arr = m.get(st) ?? [];
			arr.push(i);
			m.set(st, arr);
		}
		return m;
	}, [displayIssues]);

	const toggleCollapsed = useCallback((st: string) => {
		setCollapsed((prev) => {
			const n = new Set(prev);
			if (n.has(st)) {
				n.delete(st);
			} else {
				n.add(st);
			}
			return n;
		});
	}, []);

	const toggleSelect = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const n = new Set(prev);
			if (n.has(id)) {
				n.delete(id);
			} else {
				n.add(id);
			}
			return n;
		});
	}, []);

	const batchPatch = useCallback(
		async (patch: Record<string, unknown>) => {
			const ids = [...selectedIds];
			try {
				for (const id of ids) {
					await onPatchIssue(id, patch);
				}
				setSelectedIds(new Set());
			} catch (e) {
				notifyAiEmployeesRequestFailed(e);
			}
		},
		[onPatchIssue, selectedIds]
	);

	useEffect(() => {
		if (openCreateSignal > 0) {
			setCreateOpen(true);
		}
	}, [openCreateSignal]);

	const assigneeScopePills: { key: AssigneeScopeFilter; label: string; title: string }[] = [
		{ key: 'all', label: t('aiEmployees.issuesHub.scopeAllIssues'), title: t('aiEmployees.issuesHub.scopeAllIssuesHint') },
		{ key: 'members', label: t('aiEmployees.issuesHub.scopeMembers'), title: t('aiEmployees.issuesHub.scopeMembersHint') },
		{ key: 'agents', label: t('aiEmployees.issuesHub.scopeAgents'), title: t('aiEmployees.issuesHub.scopeAgentsHint') },
	];

	return (
		<div className="ref-ai-employees-issues-hub">
			<CreateIssueDialog
				open={createOpen}
				t={t}
				agents={agents}
				members={members}
				projects={projects}
				issues={lookupList}
				workspaceDisplayName={workspaceDisplayName}
				issuesHubVariant={variant}
				onClose={() => setCreateOpen(false)}
				onCreate={onCreateIssue}
			/>
			<div className="ref-ai-employees-issues-header">
				<div className="ref-ai-employees-issues-header-inner">
					<div className="ref-ai-employees-issues-header-left">
						{variant === 'workspace' ? (
							<div className="ref-ai-employees-issues-hub-toolbar-filters" role="tablist" aria-label={t('aiEmployees.issuesHub.assigneeScopeAria')}>
								{assigneeScopePills.map((p) => (
									<button
										key={p.key}
										type="button"
										title={p.title}
										className={`ref-ai-employees-issues-hub-pill ${assigneeScope === p.key ? 'is-active' : ''}`}
										onClick={() => setAssigneeScope(p.key)}
									>
										{p.label}
									</button>
								))}
							</div>
						) : (
							<div className="ref-ai-employees-issues-hub-toolbar-filters">
								<button
									type="button"
									className={`ref-ai-employees-issues-hub-pill ${scope === 'active' ? 'is-active' : ''}`}
									onClick={() => setScope('active')}
								>
									{t('aiEmployees.issuesHub.scopeActive')}
								</button>
								<button type="button" className={`ref-ai-employees-issues-hub-pill ${scope === 'all' ? 'is-active' : ''}`} onClick={() => setScope('all')}>
									{t('aiEmployees.issuesHub.scopeAll')}
								</button>
							</div>
						)}
					</div>
					<div className="ref-ai-employees-issues-header-right">
						<IssuesHubIconMenus
							t={t}
							boardState={boardState}
							setBoardState={setBoardState}
							statusOptions={statusOptionsLabeled}
							priorityOptions={priorityOptions(t)}
							assigneeOptions={assigneeOptions}
						/>
					</div>
				</div>
			</div>

			<div className={`ref-ai-employees-issues-hub-body ${selected ? 'has-detail' : ''}`}>
				<div className="ref-ai-employees-issues-hub-main">
					{boardState.viewMode === 'board' ? (
						<div className="ref-ai-employees-issues-hub-board-shell">
							<BoardPage issues={displayIssues} t={t} agents={agents} members={members} onSelectIssue={openIssue} onPatchIssue={onPatchIssue} />
						</div>
					) : displayIssues.length === 0 ? (
						<div className="ref-ai-employees-issues-hub-list-silent" aria-hidden />
					) : (
						<div className="ref-ai-employees-list-view">
							{['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'].map((st) => {
								const group = groupedList.get(st) ?? [];
								if (group.length === 0) {
									return null;
								}
								const isCollapsed = collapsed.has(st);
								return (
									<div key={st} className="ref-ai-employees-list-group">
										<button type="button" className="ref-ai-employees-list-group-head" onClick={() => toggleCollapsed(st)}>
											<IssueStatusChip t={t} status={st} />
											<span className="ref-ai-employees-list-group-count">{group.length}</span>
										</button>
										{!isCollapsed ? (
											<ul className="ref-ai-employees-list-group-body">
												{group.map((issue) => (
													<li key={issue.id} className="ref-ai-employees-list-row">
														<input
															type="checkbox"
															className="ref-ai-employees-list-cb"
															checked={selectedIds.has(issue.id)}
															onChange={() => toggleSelect(issue.id)}
															aria-label={issue.title}
														/>
														<button type="button" className="ref-ai-employees-list-row-main" onClick={() => openIssue(issue)}>
															<span className="ref-ai-employees-list-row-id">{issue.identifier ?? issue.id.slice(0, 8)}</span>
															<PriorityBadge priority={issue.priority} t={t} />
															<strong>{issue.title}</strong>
															<IssueStatusChip t={t} status={issue.status ?? 'backlog'} size="sm" />
														</button>
													</li>
												))}
											</ul>
										) : null}
									</div>
								);
							})}
						</div>
					)}
				</div>
				{selected ? (
					<IssueDetailPanel
						t={t}
						issue={selected}
						agents={agents}
						members={members}
						projects={projects}
						parentIssue={parentIssue}
						onClose={() => setSelectedId(null)}
						onPatch={onPatchIssue}
						onDelete={onDeleteIssue}
						onCreateChild={async (parentId, payload) => {
							await onCreateIssue({
								title: payload.title,
								parent_issue_id: parentId,
								assignee_type: payload.assignee_type,
								assignee_id: payload.assignee_id,
							});
						}}
						onSelectIssue={(id) => setSelectedId(id)}
					/>
				) : null}
			</div>

			{selectedIds.size > 0 && boardState.viewMode === 'list' ? (
				<div className="ref-ai-employees-batch-bar" role="toolbar">
					<span className="ref-ai-employees-batch-count">{selectedIds.size}</span>
					<VoidSelect
						className="ref-ai-employees-batch-void-select"
						variant="compact"
						ariaLabel={t('aiEmployees.issuesHub.batchChangeStatus')}
						value={batchStatusV}
						options={batchStatusOpts}
						onChange={(v) => {
							if (v === '__ph') {
								return;
							}
							setBatchStatusV('__ph');
							void batchPatch({ status: v });
						}}
					/>
					<VoidSelect
						className="ref-ai-employees-batch-void-select"
						variant="compact"
						ariaLabel={t('aiEmployees.issuesHub.batchChangePriority')}
						value={batchPriorityV}
						options={batchPriorityOpts}
						onChange={(v) => {
							if (v === '__ph') {
								return;
							}
							setBatchPriorityV('__ph');
							void batchPatch({ priority: v });
						}}
					/>
					<VoidSelect
						className="ref-ai-employees-batch-void-select"
						variant="compact"
						ariaLabel={t('aiEmployees.issuesHub.batchChangeAssignee')}
						value={batchAssigneeV}
						options={batchAssigneeOpts}
						onChange={(v) => {
							if (v === '__ph') {
								return;
							}
							setBatchAssigneeV('__ph');
							if (v === '__clear') {
								void batchPatch({ assignee_type: null, assignee_id: null });
								return;
							}
							const [typ, id] = v.split(':');
							if ((typ === 'member' || typ === 'agent') && id) {
								void batchPatch({ assignee_type: typ, assignee_id: id });
							}
						}}
					/>
				</div>
			) : null}
		</div>
	);
}
