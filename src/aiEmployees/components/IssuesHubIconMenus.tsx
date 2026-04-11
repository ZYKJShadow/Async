import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type Dispatch,
	type ReactNode,
	type RefObject,
	type SetStateAction,
} from 'react';
import type { TFunction } from '../../i18n';
import { IconArrowDown, IconArrowUp, IconFilter, IconLayoutColumns, IconLayoutList, IconSlidersHorizontal } from '../../icons';
import type { FilterOption } from './FilterDropdown';
import type { IssueBoardState, IssueSortBy } from '../domain/issueBoard';

type OpenMenu = 'filter' | 'display' | 'view' | null;

function useClickOutside(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
	useEffect(() => {
		if (!open) {
			return;
		}
		const fn = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				onClose();
			}
		};
		document.addEventListener('mousedown', fn);
		return () => document.removeEventListener('mousedown', fn);
	}, [open, onClose, ref]);
}

function MenuTrigger({
	active,
	hasDot,
	title,
	children,
	onClick,
}: {
	active: boolean;
	hasDot?: boolean;
	title: string;
	children: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={`ref-ai-employees-issues-menu-trigger${active ? ' is-active' : ''}`}
			title={title}
			aria-expanded={active}
			onClick={onClick}
		>
			<span className="ref-ai-employees-issues-menu-trigger-icon">{children}</span>
			{hasDot ? <span className="ref-ai-employees-issues-menu-dot" aria-hidden /> : null}
		</button>
	);
}

export function IssuesHubIconMenus({
	t,
	boardState,
	setBoardState,
	statusOptions,
	priorityOptions,
	assigneeOptions,
}: {
	t: TFunction;
	boardState: IssueBoardState;
	setBoardState: Dispatch<SetStateAction<IssueBoardState>>;
	statusOptions: FilterOption[];
	priorityOptions: FilterOption[];
	assigneeOptions: FilterOption[];
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	const [menu, setMenu] = useState<OpenMenu>(null);

	const close = useCallback(() => setMenu(null), []);
	useClickOutside(rootRef, menu !== null, close);

	const statusSel = useMemo(() => new Set(boardState.statusFilters), [boardState.statusFilters]);
	const prioritySel = useMemo(() => new Set(boardState.priorityFilters), [boardState.priorityFilters]);
	const assigneeSel = useMemo(() => {
		const s = new Set<string>();
		for (const f of boardState.assigneeFilters) {
			s.add(`${f.type}:${f.id}`);
		}
		return s;
	}, [boardState.assigneeFilters]);

	const toggleStatus = (value: string) => {
		setBoardState((prev) => {
			const next = new Set(prev.statusFilters);
			if (next.has(value)) {
				next.delete(value);
			} else {
				next.add(value);
			}
			return { ...prev, statusFilters: [...next] };
		});
	};

	const togglePriority = (value: string) => {
		setBoardState((prev) => {
			const next = new Set(prev.priorityFilters);
			if (next.has(value)) {
				next.delete(value);
			} else {
				next.add(value);
			}
			return { ...prev, priorityFilters: [...next] };
		});
	};

	const toggleAssignee = (value: string) => {
		setBoardState((prev) => {
			const next = new Set<string>();
			for (const f of prev.assigneeFilters) {
				next.add(`${f.type}:${f.id}`);
			}
			if (next.has(value)) {
				next.delete(value);
			} else {
				next.add(value);
			}
			const filters: { type: 'member' | 'agent'; id: string }[] = [];
			for (const v of next) {
				const [typ, id] = v.split(':');
				if ((typ === 'member' || typ === 'agent') && id) {
					filters.push({ type: typ, id });
				}
			}
			return { ...prev, assigneeFilters: filters };
		});
	};

	const hasActiveFilters =
		boardState.statusFilters.length > 0 || boardState.priorityFilters.length > 0 || boardState.assigneeFilters.length > 0;

	const clearFilters = () => {
		setBoardState((prev) => ({
			...prev,
			statusFilters: [],
			priorityFilters: [],
			assigneeFilters: [],
		}));
	};

	const sortRows: { value: IssueSortBy; label: string }[] = useMemo(
		() => [
			{ value: 'position', label: t('aiEmployees.issuesHub.sortManual') },
			{ value: 'priority', label: t('aiEmployees.issuesHub.sortPriority') },
			{ value: 'due_date', label: t('aiEmployees.issuesHub.sortDueDate') },
			{ value: 'created_at', label: t('aiEmployees.issuesHub.sortCreated') },
			{ value: 'title', label: t('aiEmployees.issuesHub.sortTitle') },
		],
		[t]
	);

	const sortLabel = sortRows.find((r) => r.value === boardState.sortBy)?.label ?? t('aiEmployees.issuesHub.sortManual');

	const setSortBy = (value: IssueSortBy) => {
		setBoardState((prev) => ({
			...prev,
			sortBy: value,
			sortDirection: value === 'created_at' ? 'desc' : 'asc',
		}));
		close();
	};

	const flipSortDir = () => {
		setBoardState((prev) => ({
			...prev,
			sortDirection: prev.sortDirection === 'asc' ? 'desc' : 'asc',
		}));
	};

	return (
		<div className="ref-ai-employees-issues-icon-menus" ref={rootRef}>
			<div className="ref-ai-employees-issues-menu-anchor">
				<MenuTrigger
					active={menu === 'filter'}
					hasDot={hasActiveFilters}
					title={t('aiEmployees.issuesHub.toolFilter')}
					onClick={() => setMenu((m) => (m === 'filter' ? null : 'filter'))}
				>
					<IconFilter />
				</MenuTrigger>
				{menu === 'filter' ? (
					<div className="ref-void-select-menu ref-ai-employees-issues-menu-panel" role="menu">
						<div className="ref-ai-employees-issues-menu-section">
							<div className="ref-ai-employees-issues-menu-section-label">{t('aiEmployees.issuesHub.filterStatus')}</div>
							<div className="ref-ai-employees-issues-menu-scroll">
								{statusOptions.map((opt) => (
									<label key={opt.value} className="ref-void-select-option ref-ai-employees-issues-menu-check-row">
										<input type="checkbox" checked={statusSel.has(opt.value)} onChange={() => toggleStatus(opt.value)} />
										<span>{opt.label}</span>
									</label>
								))}
							</div>
						</div>
						<div className="ref-ai-employees-issues-menu-section">
							<div className="ref-ai-employees-issues-menu-section-label">{t('aiEmployees.issuesHub.filterPriority')}</div>
							<div className="ref-ai-employees-issues-menu-scroll">
								{priorityOptions.map((opt) => (
									<label key={opt.value} className="ref-void-select-option ref-ai-employees-issues-menu-check-row">
										<input type="checkbox" checked={prioritySel.has(opt.value)} onChange={() => togglePriority(opt.value)} />
										<span>{opt.label}</span>
									</label>
								))}
							</div>
						</div>
						<div className="ref-ai-employees-issues-menu-section">
							<div className="ref-ai-employees-issues-menu-section-label">{t('aiEmployees.issuesHub.filterAssignee')}</div>
							<div className="ref-ai-employees-issues-menu-scroll ref-ai-employees-issues-menu-scroll--tall">
								{assigneeOptions.map((opt) => (
									<label key={opt.value} className="ref-void-select-option ref-ai-employees-issues-menu-check-row">
										<input type="checkbox" checked={assigneeSel.has(opt.value)} onChange={() => toggleAssignee(opt.value)} />
										<span>{opt.label}</span>
									</label>
								))}
							</div>
						</div>
						{hasActiveFilters ? (
							<div className="ref-ai-employees-issues-menu-footer">
								<button type="button" className="ref-ai-employees-issues-menu-footer-btn" onClick={clearFilters}>
									{t('aiEmployees.issuesHub.resetFilters')}
								</button>
							</div>
						) : null}
					</div>
				) : null}
			</div>

			<div className="ref-ai-employees-issues-menu-anchor">
				<MenuTrigger active={menu === 'display'} title={t('aiEmployees.issuesHub.toolDisplay')} onClick={() => setMenu((m) => (m === 'display' ? null : 'display'))}>
					<IconSlidersHorizontal />
				</MenuTrigger>
				{menu === 'display' ? (
					<div className="ref-void-select-menu ref-ai-employees-issues-menu-panel ref-ai-employees-issues-menu-panel--narrow" role="menu">
						<div className="ref-ai-employees-issues-menu-section">
							<div className="ref-ai-employees-issues-menu-section-label">{t('aiEmployees.issuesHub.sortLabel')}</div>
							<div className="ref-ai-employees-issues-menu-sort-row">
								<div className="ref-ai-employees-issues-menu-sort-label">{sortLabel}</div>
								<button type="button" className="ref-ai-employees-issues-menu-icon-btn" title={t('aiEmployees.issuesHub.sortDirToggle')} onClick={flipSortDir}>
									{boardState.sortDirection === 'asc' ? <IconArrowUp /> : <IconArrowDown />}
								</button>
							</div>
							<div className="ref-ai-employees-issues-menu-scroll">
								{sortRows.map((row) => (
									<button
										key={row.value}
										type="button"
										className={`ref-void-select-option ref-ai-employees-issues-menu-item${boardState.sortBy === row.value ? ' is-selected' : ''}`}
										onClick={() => setSortBy(row.value)}
									>
										{row.label}
									</button>
								))}
							</div>
						</div>
					</div>
				) : null}
			</div>

			<div className="ref-ai-employees-issues-menu-anchor">
				<MenuTrigger
					active={menu === 'view'}
					title={boardState.viewMode === 'board' ? t('aiEmployees.issuesHub.toolViewBoard') : t('aiEmployees.issuesHub.toolViewList')}
					onClick={() => setMenu((m) => (m === 'view' ? null : 'view'))}
				>
					{boardState.viewMode === 'board' ? <IconLayoutColumns /> : <IconLayoutList />}
				</MenuTrigger>
				{menu === 'view' ? (
					<div className="ref-void-select-menu ref-ai-employees-issues-menu-panel ref-ai-employees-issues-menu-panel--narrow" role="menu">
						<div className="ref-ai-employees-issues-menu-section-label ref-ai-employees-issues-menu-pad">{t('aiEmployees.issuesHub.menuView')}</div>
						<button
							type="button"
							className={`ref-void-select-option ref-ai-employees-issues-menu-item${boardState.viewMode === 'board' ? ' is-selected' : ''}`}
							onClick={() => {
								setBoardState((s) => ({ ...s, viewMode: 'board' }));
								close();
							}}
						>
							<IconLayoutColumns />
							<span>{t('aiEmployees.issuesHub.viewBoard')}</span>
						</button>
						<button
							type="button"
							className={`ref-void-select-option ref-ai-employees-issues-menu-item${boardState.viewMode === 'list' ? ' is-selected' : ''}`}
							onClick={() => {
								setBoardState((s) => ({ ...s, viewMode: 'list' }));
								close();
							}}
						>
							<IconLayoutList />
							<span>{t('aiEmployees.issuesHub.viewList')}</span>
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}
