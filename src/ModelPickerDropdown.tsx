import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from './i18n';
import { computeClampedPopoverLayout, type ClampedPopoverLayout } from './anchorPopoverLayout';
import type { ThinkingLevel } from './ipcTypes';
import { THINKING_EFFORT_IDS } from './ipcTypes';

export type ModelPickerItem = {
	id: string;
	label: string;
	description: string;
	subtitle?: string;
	/** 弱化展示：模型所属提供商名称 */
	providerLabel?: string;
};

const OPTIONS_PANEL_W = 276;

function IconGlobe({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="12" cy="12" r="10" />
			<path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
		</svg>
	);
}

function IconCheck({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
			<path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

type Props = {
	open: boolean;
	onClose: () => void;
	anchorRef: React.RefObject<HTMLElement | null>;
	items: ModelPickerItem[];
	selectedId: string;
	/** 点击某一模型行时切换当前对话模型 */
	onSelectModel: (id: string) => void;
	/** 在右栏底部「管理模型…」进入设置（非「编辑」按钮） */
	onNavigateToSettings: () => void;
	onAddModels: () => void;
	/** 按选择器 id（`auto` 或模型条目 id）读取/写入思考档位 */
	getThinkingLevel: (modelId: string) => ThinkingLevel;
	onThinkingLevelChange: (modelId: string, level: ThinkingLevel) => void;
};

type MenuLayout = ClampedPopoverLayout & { minWidth: number; listMinW: number };

export function ModelPickerDropdown({
	open,
	onClose,
	anchorRef,
	items,
	selectedId,
	onSelectModel,
	onNavigateToSettings,
	onAddModels,
	getThinkingLevel,
	onThinkingLevelChange,
}: Props) {
	const { t } = useI18n();
	const menuRef = useRef<HTMLDivElement>(null);
	const [menuLayout, setMenuLayout] = useState<MenuLayout>({
		placement: 'below',
		left: 0,
		width: 300 + OPTIONS_PANEL_W,
		minWidth: 300 + OPTIONS_PANEL_W,
		listMinW: 300,
		top: 100,
		maxHeightPx: 400,
		minHeightPx: 160,
	});
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	/** 点击「编辑」后展开右栏，并锁定为该条模型展示说明 */
	const [optsOpen, setOptsOpen] = useState(false);
	const [optsModelId, setOptsModelId] = useState<string | null>(null);

	const panelModelId = optsOpen ? (optsModelId ?? selectedId) : selectedId;
	const thinkingLevel = getThinkingLevel(panelModelId);
	const thinkingOn = thinkingLevel !== 'off';

	useEffect(() => {
		if (!open) {
			setOptsOpen(false);
			setOptsModelId(null);
		}
	}, [open]);

	const computeLayout = useCallback(() => {
		const el = anchorRef.current;
		if (!el) {
			return;
		}
		const menu = menuRef.current;
		const r = el.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const listMinW = Math.max(280, Math.ceil(r.width));
		const totalW = listMinW + (optsOpen ? OPTIONS_PANEL_W : 0);
		const estimate = Math.min(420, Math.max(160, items.length * 52 + 140));
		const natural =
			menu && menu.scrollHeight > 48 ? Math.max(menu.scrollHeight, estimate) : estimate;
		const L = computeClampedPopoverLayout(r, {
			viewportWidth: vw,
			viewportHeight: vh,
			menuWidth: totalW,
			contentHeight: natural,
		});
		setMenuLayout({ ...L, minWidth: totalW, listMinW });
	}, [anchorRef, items.length, optsOpen]);

	useLayoutEffect(() => {
		if (!open) {
			return;
		}
		computeLayout();
		const id0 = requestAnimationFrame(() => {
			computeLayout();
			requestAnimationFrame(() => computeLayout());
		});
		const menu = menuRef.current;
		const ro =
			menu && typeof ResizeObserver !== 'undefined'
				? new ResizeObserver(() => computeLayout())
				: null;
		if (menu && ro) {
			ro.observe(menu);
		}
		const onWin = () => computeLayout();
		window.addEventListener('resize', onWin);
		window.addEventListener('scroll', onWin, true);
		return () => {
			cancelAnimationFrame(id0);
			ro?.disconnect();
			window.removeEventListener('resize', onWin);
			window.removeEventListener('scroll', onWin, true);
		};
	}, [open, computeLayout, optsOpen]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			const tgt = e.target as Node;
			if (menuRef.current?.contains(tgt) || anchorRef.current?.contains(tgt)) {
				return;
			}
			onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		};
		document.addEventListener('mousedown', onDoc);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDoc);
			document.removeEventListener('keydown', onKey);
		};
	}, [open, onClose, anchorRef]);

	if (!open) {
		return null;
	}

	const focusId = optsOpen && optsModelId ? optsModelId : hoveredId ?? selectedId;
	const focusItem = items.find((i) => i.id === focusId) ?? items.find((i) => i.id === selectedId);

	const setThinkingToggle = (modelId: string, on: boolean) => {
		const cur = getThinkingLevel(modelId);
		if (on) {
			onThinkingLevelChange(modelId, cur === 'off' ? 'medium' : cur);
		} else {
			onThinkingLevelChange(modelId, 'off');
		}
	};

	const node = (
		<div
			ref={menuRef}
			className={`ref-model-dd ref-model-dd--split ${optsOpen ? 'ref-model-dd--opts-open' : ''} ${menuLayout.placement === 'above' ? 'ref-model-dd--above' : ''}`}
			style={{
				left: menuLayout.left,
				width: menuLayout.minWidth,
				minWidth: menuLayout.minWidth,
				top: menuLayout.placement === 'below' ? menuLayout.top : 'auto',
				bottom: menuLayout.placement === 'above' ? menuLayout.bottom : 'auto',
				maxHeight: menuLayout.maxHeightPx,
				minHeight: menuLayout.minHeightPx,
				display: 'flex',
				flexDirection: 'column',
				overflow: 'hidden',
			}}
			role="presentation"
		>
			<div className="ref-model-dd-split">
				<div
					className="ref-model-dd-col ref-model-dd-col--list"
					style={{ flexBasis: menuLayout.listMinW, maxWidth: menuLayout.listMinW }}
					onMouseLeave={() => setHoveredId(null)}
				>
					<div
						className="ref-model-dd-inner"
						role="listbox"
						aria-label={t('modelPicker.selectAria')}
					>
						{items.length === 0 ? (
							<div className="ref-model-dd-empty">
								<p className="ref-model-dd-empty-text">{t('modelPicker.emptyHint')}</p>
							</div>
						) : null}
						{items.map((m) => {
							const isSel = selectedId === m.id;
							const rowThink = getThinkingLevel(m.id);
							return (
								<div
									key={m.id}
									role="option"
									aria-selected={isSel}
									tabIndex={0}
									className={`ref-model-dd-row ${isSel ? 'is-selected' : ''}`}
									onMouseEnter={() => setHoveredId(m.id)}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											void onSelectModel(m.id);
											onClose();
										}
									}}
									onClick={() => {
										void onSelectModel(m.id);
										onClose();
									}}
								>
									<span className="ref-model-dd-globe" aria-hidden>
										<IconGlobe />
									</span>
									<span className="ref-model-dd-main">
										<span className="ref-model-dd-title-row">
											<span className="ref-model-dd-label" title={m.label}>{m.label}</span>
											<span
												className={`ref-model-dd-tag ref-model-dd-tag--think ref-model-dd-tag--think-${rowThink}`}
												title={t('thinking.badgeTitle')}
											>
												{t(`thinking.badge.${rowThink}`)}
											</span>
										</span>
										{m.providerLabel ? (
											<span className="ref-model-dd-provider-meta" title={m.providerLabel}>
												{m.providerLabel}
											</span>
										) : null}
										{m.subtitle ? <span className="ref-model-dd-sub">{m.subtitle}</span> : null}
									</span>
									<div className="ref-model-dd-trailing">
										<button
											type="button"
											className="ref-model-dd-edit"
											onClick={(e) => {
												e.preventDefault();
												e.stopPropagation();
												setOptsModelId(m.id);
												setOptsOpen(true);
											}}
										>
											{t('modelPicker.edit')}
										</button>
										{isSel ? (
											<span className="ref-model-dd-check" aria-hidden>
												<IconCheck />
											</span>
										) : null}
									</div>
								</div>
							);
						})}
					</div>
					<div className="ref-model-dd-sep" role="separator" />
					<button type="button" className="ref-model-dd-add" onClick={() => { onAddModels(); onClose(); }}>
						{t('modelPicker.addModels')}
					</button>
				</div>

				{optsOpen ? (
					<>
						<div className="ref-model-dd-col-divider" aria-hidden />

						<aside
							className="ref-model-dd-col ref-model-dd-col--opts"
							aria-label={t('thinking.panelAria')}
							onMouseDown={(e) => e.stopPropagation()}
						>
							<button
								type="button"
								className="ref-model-opts-collapse"
								onClick={() => {
									setOptsOpen(false);
									setOptsModelId(null);
								}}
							>
								<svg className="ref-model-opts-collapse-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
									<path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
								</svg>
								{t('thinking.collapsePanel')}
							</button>

							<div className="ref-model-opts-focus">
								<span className="ref-model-opts-focus-name">{focusItem?.label ?? '—'}</span>
								<p className="ref-model-opts-focus-desc">{focusItem?.description ?? ''}</p>
							</div>

							<p className="ref-model-opts-hint">{t('thinking.panelHint')}</p>

							<div className="ref-model-opts-section">{t('thinking.section.options')}</div>
							<div className="ref-model-opts-toggle-row">
								<span className="ref-model-opts-toggle-label">{t('thinking.toggleLabel')}</span>
								<button
									type="button"
									className={`ref-model-opts-switch ${thinkingOn ? 'is-on' : ''}`}
									role="switch"
									aria-checked={thinkingOn}
									onClick={() => setThinkingToggle(panelModelId, !thinkingOn)}
								>
									<span className="ref-model-opts-switch-knob" />
								</button>
							</div>

							<div className="ref-model-opts-section">{t('thinking.section.effort')}</div>
							<div className={`ref-model-opts-effort ${!thinkingOn ? 'is-disabled' : ''}`}>
								{THINKING_EFFORT_IDS.map((id) => {
									const active = thinkingOn && thinkingLevel === id;
									return (
										<button
											key={id}
											type="button"
											className={`ref-model-opts-effort-row ${active ? 'is-active' : ''}`}
											disabled={!thinkingOn}
											onClick={() => onThinkingLevelChange(panelModelId, id)}
										>
											<span>{t(`thinking.effort.${id}`)}</span>
											{active ? (
												<span className="ref-model-opts-effort-check" aria-hidden>
													<IconCheck />
												</span>
											) : (
												<span className="ref-model-opts-effort-check-placeholder" aria-hidden />
											)}
										</button>
									);
								})}
							</div>

							<button
								type="button"
								className="ref-model-opts-settings-foot"
								onClick={() => {
									onNavigateToSettings();
									onClose();
								}}
							>
								{t('modelPicker.manageInSettings')}
							</button>
						</aside>
					</>
				) : null}
			</div>
		</div>
	);

	return createPortal(node, document.body);
}
