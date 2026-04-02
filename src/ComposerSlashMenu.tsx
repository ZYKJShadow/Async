import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { computeClampedPopoverLayout, POPOVER_VIEW_MARGIN } from './anchorPopoverLayout';
import type { CaretRectSnapshot } from './caretRectSnapshot';
import type { SlashMenuRowItem } from './composerSlashCommands';
import { useI18n } from './i18n';

function SlashCommandLabel({ label, query }: { label: string; query: string }) {
	const name = label.startsWith('/') ? label.slice(1) : label;
	const q = query.toLowerCase();
	const n = name.toLowerCase();
	let matchLen = 0;
	if (q.length > 0) {
		for (let i = 0; i < Math.min(q.length, n.length); i++) {
			if (n[i] === q[i]) {
				matchLen++;
			} else {
				break;
			}
		}
	}
	return (
		<span className="ref-slash-menu-label">
			<span className="ref-slash-menu-slash">/</span>
			{matchLen > 0 ? (
				<>
					<span className="ref-slash-menu-match">{name.slice(0, matchLen)}</span>
					<span className="ref-slash-menu-name-rest">{name.slice(matchLen)}</span>
				</>
			) : (
				<span className="ref-slash-menu-name-rest">{name}</span>
			)}
		</span>
	);
}

type Props = {
	open: boolean;
	query: string;
	items: SlashMenuRowItem[];
	highlightIndex: number;
	caretRect: CaretRectSnapshot | null;
	onHighlight: (index: number) => void;
	onSelect: (item: SlashMenuRowItem) => void;
	onClose: () => void;
};

export function ComposerSlashMenu({
	open,
	query,
	items,
	highlightIndex,
	caretRect,
	onHighlight,
	onSelect,
	onClose,
}: Props) {
	const { t } = useI18n();
	const menuRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		/* 与下方 render 一致：未展示菜单时不挂监听，避免 menuRef 为空时误把全屏点击都当成「点外侧」 */
		if (!open || !caretRect) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			const node = e.target as Node;
			if (menuRef.current?.contains(node)) {
				return;
			}
			onClose();
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [open, caretRect, onClose]);

	useLayoutEffect(() => {
		if (!open || items.length === 0) {
			return;
		}
		const root = menuRef.current;
		if (!root) {
			return;
		}
		const safeHi = Math.min(Math.max(0, highlightIndex), items.length - 1);
		const row = root.querySelector<HTMLElement>(`[data-slash-menu-idx="${safeHi}"]`);
		row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}, [open, items, highlightIndex]);

	if (!open || !caretRect) {
		return null;
	}

	const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
	const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
	const menuWidth = Math.min(380, vw - 2 * POPOVER_VIEW_MARGIN);
	const rowH = 52;
	const estHeight = Math.min(Math.max(items.length * rowH + 8, items.length ? 48 : 44), vh * 0.45);

	const anchorRect = new DOMRect(caretRect.left, caretRect.top, caretRect.width, caretRect.height);
	const layout = computeClampedPopoverLayout(anchorRect, {
		viewportWidth: vw,
		viewportHeight: vh,
		menuWidth,
		contentHeight: estHeight,
	});

	const posStyle: React.CSSProperties = {
		position: 'fixed',
		left: layout.left,
		width: layout.width,
		maxHeight: layout.maxHeightPx,
		zIndex: 20001,
	};
	if (layout.top !== undefined) {
		posStyle.top = layout.top;
	}
	if (layout.bottom !== undefined) {
		posStyle.bottom = layout.bottom;
	}

	if (items.length === 0) {
		return createPortal(
			<div
				ref={menuRef}
				className="ref-slash-menu ref-slash-menu--empty"
				style={posStyle}
				onMouseDown={(e) => e.preventDefault()}
				role="status"
			>
				<div className="ref-slash-menu-empty">{t('slashCmd.noMatch')}</div>
			</div>,
			document.body
		);
	}

	const safeHi = Math.min(highlightIndex, items.length - 1);

	return createPortal(
		<div
			ref={menuRef}
			className="ref-slash-menu"
			role="listbox"
			aria-label={t('slashCmd.menuAria')}
			style={posStyle}
			onMouseDown={(e) => e.preventDefault()}
		>
			{items.map((it, i) => (
				<button
					key={it.id}
					type="button"
					data-slash-menu-idx={i}
					role="option"
					aria-selected={i === highlightIndex}
					className={`ref-slash-menu-row ${i === safeHi ? 'is-active' : ''}`}
					onMouseEnter={() => onHighlight(i)}
					onClick={() => onSelect(it)}
				>
					<div className="ref-slash-menu-row-main">
						<SlashCommandLabel label={it.label} query={query} />
						{i === safeHi ? (
							<kbd className="ref-slash-menu-kbd" aria-hidden>
								↵
							</kbd>
						) : null}
					</div>
					<div className="ref-slash-menu-desc">{it.description}</div>
				</button>
			))}
		</div>,
		document.body
	);
}
