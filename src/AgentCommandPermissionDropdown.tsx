import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { computeClampedPopoverLayout, type ClampedPopoverLayout } from './anchorPopoverLayout';
import type { ShellPermissionMode } from './agentSettingsTypes';

export type CommandPermissionMode = ShellPermissionMode;

function modeToCssToken(mode: ShellPermissionMode): string {
	return mode === 'ask_every_time' ? 'ask-every-time' : mode;
}

type Props = {
	value: CommandPermissionMode;
	onChange: (next: CommandPermissionMode) => void;
	alwaysLabel: string;
	rulesLabel: string;
	askEveryTimeLabel: string;
	ariaLabel: string;
	disabled?: boolean;
};

const MENU_Z = 6000;

function IconShield({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
			<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z" strokeLinejoin="round" />
		</svg>
	);
}

function IconSpark({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
			<path d="M12 5l1.7 5.3L19 12l-5.3 1.7L12 19l-1.7-5.3L5 12l5.3-1.7L12 5z" strokeLinejoin="round" />
		</svg>
	);
}

/** 规则 / 列表 — 表示「按规则放行」 */
function IconRuleList({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
			<path d="M8 6h13M8 12h13M8 18h13" strokeLinecap="round" />
			<path d="M4 6h.01M4 12h.01M4 18h.01" strokeLinecap="round" strokeWidth="2.2" />
		</svg>
	);
}

function IconCheck({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconChevron({ className }: { className?: string }) {
	return (
		<svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function AgentCommandPermissionDropdown({
	value,
	onChange,
	alwaysLabel,
	rulesLabel,
	askEveryTimeLabel,
	ariaLabel,
	disabled,
}: Props) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const triggerId = useId();
	const titleId = `${triggerId}-title`;
	const listId = `${triggerId}-listbox`;
	const [open, setOpen] = useState(false);
	const [layout, setLayout] = useState<ClampedPopoverLayout>({
		placement: 'below',
		left: 0,
		width: 184,
		top: 80,
		maxHeightPx: 220,
		minHeightPx: 80,
	});

	const options = useMemo(
		() =>
			[
				{ value: 'always' as const, label: alwaysLabel, icon: IconSpark },
				{ value: 'rules' as const, label: rulesLabel, icon: IconRuleList },
				{ value: 'ask_every_time' as const, label: askEveryTimeLabel, icon: IconShield },
			] as const,
		[alwaysLabel, rulesLabel, askEveryTimeLabel]
	);

	const selected = options.find((option) => option.value === value) ?? options[1];
	const SelectedIcon = selected.icon;
	const triggerModeClass = `ref-command-permission-trigger--${modeToCssToken(selected.value)}`;

	const recompute = useCallback(() => {
		const trigger = triggerRef.current;
		const menu = menuRef.current;
		if (!trigger || !menu) {
			return;
		}
		const rect = trigger.getBoundingClientRect();
		const menuWidth = Math.max(200, Math.ceil(rect.width));
		const naturalHeight = Math.min(280, Math.max(menu.scrollHeight, options.length * 46 + 12));
		setLayout(
			computeClampedPopoverLayout(rect, {
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
				menuWidth,
				contentHeight: naturalHeight,
			})
		);
	}, [options.length]);

	useLayoutEffect(() => {
		if (!open) {
			return;
		}
		recompute();
		const id = requestAnimationFrame(recompute);
		return () => cancelAnimationFrame(id);
	}, [open, recompute, value]);

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
		const onDoc = (event: MouseEvent) => {
			const target = event.target as Node;
			if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
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
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				setOpen(false);
				triggerRef.current?.focus();
			}
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [open]);

	const menuStyle: CSSProperties = {
		position: 'fixed',
		zIndex: MENU_Z,
		left: layout.left,
		width: layout.width,
		maxHeight: layout.maxHeightPx,
		minHeight: Math.min(layout.minHeightPx, layout.maxHeightPx),
		overflow: 'auto',
		...(layout.placement === 'below' ? { top: layout.top } : { bottom: layout.bottom }),
	};

	const menu = open ? (
		<div
			ref={menuRef}
			className="ref-command-permission-menu"
			role="dialog"
			aria-labelledby={titleId}
			style={menuStyle}
		>
			<div id={titleId} className="ref-command-permission-menu-title">
				{ariaLabel}
			</div>
			<div id={listId} className="ref-command-permission-menu-list" role="listbox" aria-labelledby={titleId}>
				{options.map((option) => {
					const isSelected = option.value === value;
					const OptionIcon = option.icon;
					const cssTok = modeToCssToken(option.value);
					return (
						<button
							key={option.value}
							type="button"
							role="option"
							aria-selected={isSelected}
							className={`ref-command-permission-option ref-command-permission-option--${cssTok} ${isSelected ? 'is-selected' : ''}`}
							onClick={() => {
								onChange(option.value);
								setOpen(false);
								triggerRef.current?.focus();
							}}
						>
							<span className="ref-command-permission-option-main">
								<span className="ref-command-permission-option-ico-wrap">
									<OptionIcon className="ref-command-permission-option-ico" />
								</span>
								<span className="ref-command-permission-option-label">{option.label}</span>
							</span>
							{isSelected ? <IconCheck className="ref-command-permission-option-check" /> : null}
						</button>
					);
				})}
			</div>
		</div>
	) : null;

	return (
		<div className="ref-command-permission">
			<button
				ref={triggerRef}
				id={triggerId}
				type="button"
				className={`ref-command-permission-trigger ${triggerModeClass} ${open ? 'is-open' : ''}`}
				aria-label={ariaLabel}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				disabled={disabled}
				onClick={() => {
					if (disabled) {
						return;
					}
					setOpen((prev) => !prev);
				}}
			>
				<span className="ref-command-permission-trigger-ico-wrap">
					<SelectedIcon className="ref-command-permission-trigger-ico" />
				</span>
				<span className="ref-command-permission-trigger-label">
					<span className="ref-command-permission-trigger-label-text">{selected.label}</span>
				</span>
				<span className="ref-command-permission-trigger-chev-wrap" aria-hidden>
					<IconChevron className="ref-command-permission-trigger-chev" />
				</span>
			</button>
			{typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : null}
		</div>
	);
}
