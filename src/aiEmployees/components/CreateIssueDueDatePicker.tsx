import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Chevron, DayPicker, getDefaultClassNames } from 'react-day-picker';
import type { TFunction } from '../../i18n';
import { IconCalendar, IconChevron } from '../../icons';

import 'react-day-picker/style.css';

/** 与 multica `Calendar` 一致：`weekdays` / `week` 用 flex 行对齐列宽 */
const dueCalendarClassNames = (() => {
	const d = getDefaultClassNames();
	return {
		weekdays: `${d.weekdays} ref-ai-employees-due-cal-weekdays-row`,
		weekday: `${d.weekday} ref-ai-employees-due-cal-weekday-cell`,
		week: `${d.week} ref-ai-employees-due-cal-week-row`,
		day: `${d.day} ref-ai-employees-due-cal-day-cell`,
	};
})();

function pad2(n: number): string {
	return String(Math.max(0, n)).padStart(2, '0');
}

/** `YYYY-MM-DDTHH:mm` 本地字符串（与后端 datetime 字段兼容） */
export function dateToDueLocalString(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function parseDueLocalString(s: string): { date: string; time: string } {
	const t = s.trim();
	if (!t) {
		return { date: '', time: '18:00' };
	}
	const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(t);
	if (m) {
		return { date: m[1]!, time: `${m[2]}:${m[3]}` };
	}
	const dm = /^(\d{4}-\d{2}-\d{2})$/.exec(t);
	if (dm) {
		return { date: dm[1]!, time: '18:00' };
	}
	return { date: '', time: '18:00' };
}

export function combineDueDateTime(date: string, time: string): string {
	if (!date.trim()) {
		return '';
	}
	const tm = time.trim() || '18:00';
	const [a, b] = tm.split(':');
	const hh = Number.parseInt(a ?? '18', 10);
	const mm = Number.parseInt(b ?? '0', 10);
	const h = Number.isFinite(hh) ? pad2(Math.min(23, Math.max(0, hh))) : '18';
	const m = Number.isFinite(mm) ? pad2(Math.min(59, Math.max(0, mm))) : '00';
	return `${date.trim()}T${h}:${m}`;
}

/** 将 `YYYY-MM-DDTHH:mm` 按本地日历解析为 UTC ISO，供 API */
export function dueLocalStringToIso(s: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s.trim());
	if (!m) {
		return new Date(s).toISOString();
	}
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
	return d.toISOString();
}

function startOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}

/** 从存储字符串还原为日历用的 Date（保留已选时间） */
export function dueLocalStringToSelectedDate(value: string): Date | undefined {
	const { date, time } = parseDueLocalString(value);
	if (!date) {
		return undefined;
	}
	const [y, mo, da] = date.split('-').map((x) => Number.parseInt(x, 10));
	const [a, b] = time.split(':');
	const hh = Number.parseInt(a ?? '18', 10);
	const mm = Number.parseInt(b ?? '0', 10);
	if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) {
		return undefined;
	}
	return new Date(y, mo - 1, da, Number.isFinite(hh) ? hh : 18, Number.isFinite(mm) ? mm : 0, 0, 0);
}

/** Multica 触发器：仅展示「Apr 11」 */
function triggerLabel(value: string, t: TFunction): string {
	if (!value.trim()) {
		return t('aiEmployees.createIssue.dueDatePlaceholder');
	}
	const d = dueLocalStringToSelectedDate(value);
	if (!d || Number.isNaN(d.getTime())) {
		return t('aiEmployees.createIssue.dueDatePlaceholder');
	}
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isDueOverdue(value: string): boolean {
	const d = dueLocalStringToSelectedDate(value);
	if (!d) {
		return false;
	}
	return d < startOfDay(new Date());
}

/**
 * 与 Multica `DueDatePicker` 一致：药丸 + Popover + `react-day-picker` 月历点选，
 * 选中日默认本地当天 18:00 写入（与「工作日截止」习惯一致，且便于转 ISO）。
 */
export function CreateIssueDueDatePicker({ t, value, onChange, disabled }: { t: TFunction; value: string; onChange: (next: string) => void; disabled?: boolean }) {
	const id = useId();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<{ top: number; left: number; minW: number } | null>(null);
	const [month, setMonth] = useState<Date>(() => new Date());

	const selected = useMemo(() => dueLocalStringToSelectedDate(value), [value]);

	useEffect(() => {
		if (open && selected) {
			setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
		}
		if (open && !selected) {
			setMonth(new Date());
		}
	}, [open, selected]);

	const updatePos = useCallback(() => {
		const el = triggerRef.current;
		if (!el) {
			return;
		}
		const r = el.getBoundingClientRect();
		/* Multica：7×--spacing(7) + Calendar `p-2` 左右各 8px */
		const minW = 220;
		const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - minW - 8));
		setPos({ top: r.bottom + 6, left, minW });
	}, []);

	useEffect(() => {
		if (!open) {
			setPos(null);
			return;
		}
		updatePos();
		const onWin = () => updatePos();
		window.addEventListener('scroll', onWin, true);
		window.addEventListener('resize', onWin);
		return () => {
			window.removeEventListener('scroll', onWin, true);
			window.removeEventListener('resize', onWin);
		};
	}, [open, updatePos]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const isInside = (n: EventTarget | null): boolean => {
			if (!n || !(n instanceof Node)) {
				return false;
			}
			return Boolean(triggerRef.current?.contains(n) || panelRef.current?.contains(n));
		};
		/** 捕获阶段：避免其他控件在冒泡阶段 stopPropagation 导致关不掉 */
		const onOutsidePress = (e: Event) => {
			if (isInside(e.target)) {
				return;
			}
			setOpen(false);
		};
		const onFocusIn = (e: FocusEvent) => {
			if (isInside(e.target)) {
				return;
			}
			setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				setOpen(false);
			}
		};
		document.addEventListener('pointerdown', onOutsidePress, true);
		document.addEventListener('mousedown', onOutsidePress, true);
		document.addEventListener('focusin', onFocusIn, true);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onOutsidePress, true);
			document.removeEventListener('mousedown', onOutsidePress, true);
			document.removeEventListener('focusin', onFocusIn, true);
			document.removeEventListener('keydown', onKey);
		};
	}, [open]);

	const onSelectDay = useCallback(
		(d: Date | undefined) => {
			if (!d) {
				onChange('');
				return;
			}
			const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 0, 0, 0);
			onChange(dateToDueLocalString(x));
			setOpen(false);
		},
		[onChange]
	);

	const panel =
		open && pos ? (
			<div
				ref={panelRef}
				className="ref-ai-employees-due-pop-panel"
				style={{ top: pos.top, left: pos.left, minWidth: pos.minW }}
				role="dialog"
				aria-labelledby={`${id}-title`}
			>
				<div className="ref-ai-employees-due-pop-cal-wrap">
					<span id={`${id}-title`} className="ref-ai-employees-sr-only">
						{t('aiEmployees.createIssue.dueDateField')}
					</span>
					<div className="ref-ai-employees-due-rdp">
						<DayPicker
							mode="single"
							navLayout="around"
							captionLayout="label"
							classNames={dueCalendarClassNames}
							selected={selected}
							onSelect={(d) => onSelectDay(d)}
							month={month}
							onMonthChange={setMonth}
							showOutsideDays
							animate
							components={{
								Chevron: (p) => <Chevron {...p} size={16} />,
							}}
						/>
					</div>
				</div>
				{selected ? (
					<div className="ref-ai-employees-due-pop-foot">
						<button
							type="button"
							className="ref-ai-employees-due-pop-clear-btn"
							onClick={() => {
								onChange('');
								setOpen(false);
							}}
						>
							{t('aiEmployees.createIssue.dueDateClear')}
						</button>
					</div>
				) : null}
			</div>
		) : null;

	const overdue = isDueOverdue(value);

	return (
		<div className="ref-ai-employees-due-pop-wrap">
			<button
				ref={triggerRef}
				type="button"
				className="ref-ai-employees-create-dialog-due-trigger"
				disabled={disabled}
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label={t('aiEmployees.createIssue.dueDateField')}
				id={`${id}-trigger`}
				onClick={() => setOpen((o) => !o)}
			>
				<IconCalendar className="ref-ai-employees-create-dialog-due-trigger-ico" />
				<span className={`ref-ai-employees-create-dialog-due-trigger-text${overdue ? ' is-overdue' : ''}`}>{triggerLabel(value, t)}</span>
				<IconChevron className="ref-ai-employees-create-dialog-due-trigger-chev" />
			</button>
			{typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
		</div>
	);
}
