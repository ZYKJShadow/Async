import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeClampedPopoverLayout, type ClampedPopoverLayout } from './anchorPopoverLayout';

export type VoidSelectOption = {
	value: string;
	label: ReactNode;
	disabled?: boolean;
};

type Props = {
	value: string;
	onChange: (value: string) => void;
	options: VoidSelectOption[];
	disabled?: boolean;
	ariaLabel?: string;
	id?: string;
	className?: string;
	/** 追加到 listbox 容器，用于选项内含标签等场景的局部样式 */
	menuClassName?: string;
	/** listbox 最小宽度（不小于触发器宽度），便于选项内标签不被裁切 */
	menuMinWidth?: number;
	/** 触发器内展示（与 options[].label 解耦，避免「大按钮套彩色 pill」） */
	getTriggerDisplay?: (value: string, selected: VoidSelectOption | undefined) => ReactNode;
	/** 编辑器工具栏等较扁场景 */
	variant?: 'default' | 'compact';
};

const MENU_Z = 6000;

/** 任意时刻只保留一个打开的 VoidSelect listbox（对齐 multica Popover 互斥） */
const voidSelectOpenClosers = new Set<() => void>();

function IconChevDown({ className }: { className?: string }) {
	return (
		<svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function VoidSelect({
	value,
	onChange,
	options,
	disabled,
	ariaLabel,
	id: idProp,
	className,
	menuClassName,
	menuMinWidth,
	getTriggerDisplay,
	variant = 'default',
}: Props) {
	const genId = useId();
	const triggerId = idProp ?? `void-select-${genId}`;
	const listId = `${triggerId}-listbox`;
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const closeSelf = useCallback(() => setOpen(false), []);
	const [layout, setLayout] = useState<ClampedPopoverLayout>({
		placement: 'below',
		left: 0,
		width: 200,
		top: 80,
		maxHeightPx: 280,
		minHeightPx: 80,
	});

	const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);
	const displayLabel = selected?.label ?? value;
	const triggerInner = getTriggerDisplay ? getTriggerDisplay(value, selected) : displayLabel;

	useLayoutEffect(() => {
		if (!open) {
			voidSelectOpenClosers.delete(closeSelf);
			return;
		}
		for (const fn of voidSelectOpenClosers) {
			fn();
		}
		voidSelectOpenClosers.clear();
		voidSelectOpenClosers.add(closeSelf);
		return () => {
			voidSelectOpenClosers.delete(closeSelf);
		};
	}, [open, closeSelf]);

	const recompute = useCallback(() => {
		const tr = triggerRef.current;
		const menu = menuRef.current;
		if (!tr || !menu) {
			return;
		}
		const r = tr.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const menuWidth = Math.ceil(Math.max(r.width, menuMinWidth ?? 0));
		const natural = Math.min(480, Math.max(menu.scrollHeight, options.length * 36 + 8));
		setLayout(
			computeClampedPopoverLayout(r, {
				viewportWidth: vw,
				viewportHeight: vh,
				menuWidth,
				contentHeight: natural,
			})
		);
	}, [options.length, menuMinWidth]);

	useLayoutEffect(() => {
		if (!open) {
			return;
		}
		recompute();
		const t = requestAnimationFrame(() => recompute());
		return () => cancelAnimationFrame(t);
	}, [open, recompute, value, options.length, menuMinWidth]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onScroll = () => recompute();
		const onResize = () => recompute();
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', onResize);
		};
	}, [open, recompute]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			const t = e.target as Node;
			if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) {
				return;
			}
			setOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				setOpen(false);
				triggerRef.current?.focus();
			}
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [open]);

	const pick = useCallback(
		(next: string) => {
			onChange(next);
			setOpen(false);
			triggerRef.current?.focus();
		},
		[onChange]
	);

	const rootClass =
		`ref-void-select ${variant === 'compact' ? 'ref-void-select--compact' : ''}${className ? ` ${className}` : ''}`.trim();

	const menuStyle: CSSProperties = {
		position: 'fixed',
		zIndex: MENU_Z,
		left: layout.left,
		width: layout.width,
		maxHeight: layout.maxHeightPx,
		minHeight: Math.min(layout.minHeightPx, layout.maxHeightPx),
		overflow: 'auto',
		...(layout.placement === 'below'
			? { top: layout.top }
			: { bottom: layout.bottom }),
	};

	const menu = open ? (
		<div
			ref={menuRef}
			id={listId}
			className={`ref-void-select-menu${menuClassName ? ` ${menuClassName}` : ''}`.trim()}
			role="listbox"
			aria-labelledby={triggerId}
			style={menuStyle}
		>
			{options.map((o) => {
				const isSel = o.value === value;
				return (
					<button
						key={o.value}
						type="button"
						role="option"
						aria-selected={isSel}
						disabled={o.disabled}
						className={`ref-void-select-option ${isSel ? 'is-selected' : ''}`}
						onClick={() => {
							if (o.disabled) {
								return;
							}
							pick(o.value);
						}}
					>
						{o.label}
					</button>
				);
			})}
		</div>
	) : null;

	return (
		<div className={rootClass}>
			<button
				ref={triggerRef}
				id={triggerId}
				type="button"
				className={`ref-void-select-trigger ${open ? 'is-open' : ''}`}
				disabled={disabled}
				aria-label={ariaLabel}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				onClick={() => {
					if (disabled) {
						return;
					}
					setOpen((v) => !v);
				}}
				onKeyDown={(e) => {
					if (disabled) {
						return;
					}
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						setOpen((v) => !v);
					}
					if (e.key === 'ArrowDown' && !open) {
						e.preventDefault();
						setOpen(true);
					}
				}}
			>
				<span className="ref-void-select-value">{triggerInner}</span>
				<IconChevDown className="ref-void-select-chev" />
			</button>
			{typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : null}
		</div>
	);
}
