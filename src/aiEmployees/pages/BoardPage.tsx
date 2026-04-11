import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import {
	closestCorners,
	DndContext,
	DragOverlay,
	PointerSensor,
	useDroppable,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TFunction } from '../../i18n';
import type { AgentJson, IssueJson, WorkspaceMemberJson } from '../api/types';
import { notifyAiEmployeesRequestFailed } from '../AiEmployeesNetworkToast';
import { IssueStatusChip, normalizeIssueStatus } from '../components/IssueStatusChip';
import { PriorityBadge } from '../components/PriorityBadge';
import { computeNewPosition } from '../domain/issueBoard';

const STATUS_COLUMNS = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked'] as const;

function formatDue(due?: string | null): string {
	if (!due) {
		return '';
	}
	const d = new Date(due);
	if (Number.isNaN(d.getTime())) {
		return '';
	}
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function BoardCard({
	issue,
	t,
	agents,
	members,
	onSelect,
}: {
	issue: IssueJson;
	t: TFunction;
	agents: AgentJson[];
	members: WorkspaceMemberJson[];
	onSelect: (i: IssueJson) => void;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: issue.id,
		data: { type: 'card', issue },
	});
	const style: CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.35 : 1,
	};

	let assigneeLabel = '';
	if (issue.assignee_type === 'member' && issue.assignee_id) {
		assigneeLabel = members.find((m) => m.user_id === issue.assignee_id)?.name ?? '';
	} else if (issue.assignee_type === 'agent' && issue.assignee_id) {
		assigneeLabel = agents.find((a) => a.id === issue.assignee_id)?.name ?? '';
	}

	return (
		<button
			ref={setNodeRef}
			type="button"
			style={style}
			className="ref-ai-employees-board-card ref-ai-employees-board-dnd-card"
			data-dragging={isDragging ? '1' : undefined}
			{...attributes}
			{...listeners}
			onClick={() => onSelect(issue)}
		>
			<div className="ref-ai-employees-board-card-top">
				<span className="ref-ai-employees-board-card-id">{issue.identifier ?? issue.id.slice(0, 8)}</span>
				<PriorityBadge priority={issue.priority} t={t} />
			</div>
			<strong className="ref-ai-employees-board-card-title">{issue.title}</strong>
			{issue.description ? <p className="ref-ai-employees-board-card-desc ref-ai-employees-muted">{issue.description}</p> : null}
			<div className="ref-ai-employees-board-card-meta">
				{assigneeLabel ? <span className="ref-ai-employees-board-card-assignee">{assigneeLabel}</span> : <span className="ref-ai-employees-muted">—</span>}
				{issue.due_date ? <span className="ref-ai-employees-board-card-due">{formatDue(issue.due_date)}</span> : null}
			</div>
		</button>
	);
}

function BoardColumn({
	status,
	t,
	count,
	children,
}: {
	status: string;
	t: TFunction;
	count: number;
	children: React.ReactNode;
}) {
	const { setNodeRef, isOver } = useDroppable({
		id: `column:${status}`,
		data: { type: 'column', status },
	});
	const ns = normalizeIssueStatus(status);
	return (
		<section
			ref={setNodeRef}
			className={`ref-ai-employees-column ref-ai-employees-column--${ns} ref-ai-employees-board-dnd-column ${isOver ? 'is-drop-target' : ''}`}
			aria-label={status}
		>
			<div className="ref-ai-employees-column-head ref-ai-employees-board-dnd-column-head">
				<IssueStatusChip t={t} status={status} />
				<span className="ref-ai-employees-column-count">{count}</span>
			</div>
			<div className="ref-ai-employees-column-body ref-ai-employees-board-dnd-column-body">
				{children}
			</div>
		</section>
	);
}

export function BoardPage({
	issues,
	t,
	agents,
	members,
	onSelectIssue,
	onPatchIssue,
}: {
	issues: IssueJson[];
	t: TFunction;
	agents: AgentJson[];
	members: WorkspaceMemberJson[];
	onSelectIssue?: (issue: IssueJson) => void;
	onPatchIssue: (issueId: string, patch: Record<string, unknown>) => Promise<void>;
}) {
	const [activeIssue, setActiveIssue] = useState<IssueJson | null>(null);
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

	const byStatus = useMemo(() => {
		const m = new Map<string, IssueJson[]>();
		for (const st of STATUS_COLUMNS) {
			m.set(st, []);
		}
		for (const i of issues) {
			const s = STATUS_COLUMNS.includes(i.status as (typeof STATUS_COLUMNS)[number]) ? i.status : 'backlog';
			const list = m.get(s) ?? [];
			list.push(i);
			m.set(s, list);
		}
		for (const [, list] of m) {
			list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
		}
		return m;
	}, [issues]);

	const onDragStart = useCallback(
		(e: DragStartEvent) => {
			const id = String(e.active.id);
			const found = issues.find((x) => x.id === id) ?? null;
			setActiveIssue(found);
		},
		[issues]
	);

	const onDragEnd = useCallback(
		async (e: DragEndEvent) => {
			setActiveIssue(null);
			const { active, over } = e;
			if (!over) {
				return;
			}
			const activeId = String(active.id);
			const activeIssueRow = issues.find((x) => x.id === activeId);
			if (!activeIssueRow) {
				return;
			}
			const overId = String(over.id);
			let targetStatus = activeIssueRow.status;
			if (overId.startsWith('column:')) {
				targetStatus = overId.slice('column:'.length);
			} else {
				const overIssue = issues.find((x) => x.id === overId);
				if (overIssue) {
					targetStatus = overIssue.status;
				}
			}
			const columnSorted = (issues.filter((i) => i.status === targetStatus && i.id !== activeId) as IssueJson[]).sort(
				(a, b) => (a.position ?? 0) - (b.position ?? 0)
			);
			let insertAt = columnSorted.length;
			if (!overId.startsWith('column:')) {
				const overIssue = issues.find((x) => x.id === overId);
				if (overIssue && overIssue.id !== activeId) {
					const idx = columnSorted.findIndex((x) => x.id === overIssue.id);
					insertAt = idx >= 0 ? idx : columnSorted.length;
				}
			}
			const position = computeNewPosition(columnSorted, insertAt);
			try {
				await onPatchIssue(activeId, { status: targetStatus, position });
			} catch (e) {
				notifyAiEmployeesRequestFailed(e);
			}
		},
		[issues, onPatchIssue]
	);

	return (
		<DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={(ev) => void onDragEnd(ev)}>
			<div className="ref-ai-employees-board ref-ai-employees-board-dnd">
				{STATUS_COLUMNS.map((st) => {
					const col = byStatus.get(st) ?? [];
					const ids = col.map((i) => i.id);
					return (
						<BoardColumn key={st} status={st} t={t} count={col.length}>
							<SortableContext items={ids} strategy={verticalListSortingStrategy}>
								{col.map((issue) => (
									<BoardCard
										key={issue.id}
										issue={issue}
										t={t}
										agents={agents}
										members={members}
										onSelect={(i) => onSelectIssue?.(i)}
									/>
								))}
							</SortableContext>
						</BoardColumn>
					);
				})}
			</div>
			<DragOverlay dropAnimation={null}>
				{activeIssue ? (
					<div className="ref-ai-employees-board-dnd-overlay-card">
						<div className="ref-ai-employees-board-card-top">
							<span className="ref-ai-employees-board-card-id">{activeIssue.identifier ?? activeIssue.id.slice(0, 8)}</span>
							<PriorityBadge priority={activeIssue.priority} t={t} />
						</div>
						<strong className="ref-ai-employees-board-card-title">{activeIssue.title}</strong>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
