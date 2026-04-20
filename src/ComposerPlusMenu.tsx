import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeClampedPopoverLayout, POPOVER_VIEW_MARGIN, type ClampedPopoverLayout } from './anchorPopoverLayout';
import { useI18n } from './i18n';
import type { McpServerStatus } from './mcpTypes';

export type ComposerMode = 'agent' | 'plan' | 'team' | 'debug' | 'ask';

export type ComposerPlusSkillItem = {
	id: string;
	name: string;
	slug: string;
	description: string;
};

export type ComposerPlusMcpItem = {
	id: string;
	name: string;
	enabled: boolean;
	transport: string;
	status: McpServerStatus['status'];
	error?: string;
	toolsCount: number;
};

const MODE_IDS: ComposerMode[] = ['agent', 'plan', 'team', 'debug', 'ask'];
const PLUS_SUBMENU_WIDTH = 320;
const PLUS_SUBMENU_GAP = 10;
const PLUS_SUBMENU_EST_HEIGHT = 280;

type PlusSubLayout = {
	left: number;
	top?: number;
	bottom?: number;
	maxHeight: number;
};

/** 首帧估算高度（hint + 模式行 + 分隔 + 子项） */
const plusMenuEstHeight = () => MODE_IDS.length * 48 + 180;

/** 主栏无纵向滚动时 scrollHeight 常等于 clientHeight，不能反映真实内容高度 */
function measurePlusMainContentHeight(mainRoot: HTMLElement): number {
	if (mainRoot.scrollHeight > mainRoot.clientHeight + 2) {
		return mainRoot.scrollHeight;
	}
	const cs = getComputedStyle(mainRoot);
	const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
	let body = 0;
	for (const c of Array.from(mainRoot.children)) {
		if (!(c instanceof HTMLElement)) {
			continue;
		}
		const ccs = getComputedStyle(c);
		body +=
			c.offsetHeight + parseFloat(ccs.marginTop) + parseFloat(ccs.marginBottom);
	}
	return Math.ceil(padY + body);
}

/** 子栏为 flex+内层 list 滚动时，根节点 scrollHeight 不可靠，用结构累加更接近真实内容高度 */
function measurePlusSubmenuContentHeight(subRoot: HTMLElement): number {
	const cs = getComputedStyle(subRoot);
	const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
	const gap = parseFloat(cs.rowGap) || parseFloat(cs.columnGap) || parseFloat(cs.gap) || 10;
	const head = subRoot.querySelector('.ref-plus-submenu-head');
	const list = subRoot.querySelector('.ref-plus-submenu-list');
	const foot = subRoot.querySelector('.ref-plus-submenu-footer');
	let body = 0;
	if (head instanceof HTMLElement) {
		body += head.offsetHeight;
	}
	if (list instanceof HTMLElement) {
		body += list.scrollHeight;
	}
	if (foot instanceof HTMLElement) {
		body += foot.offsetHeight;
	}
	const blocks = [head, list, foot].filter((n) => n instanceof HTMLElement).length;
	const gaps = blocks >= 2 ? gap * (blocks - 1) : 0;
	return Math.ceil(padY + body + gaps);
}

function IconAgent({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="5" y="8" width="14" height="10" rx="2" />
			<path d="M9 8V6a3 3 0 0 1 6 0v2" strokeLinecap="round" />
			<circle cx="9.5" cy="13" r="1" fill="currentColor" stroke="none" />
			<circle cx="14.5" cy="13" r="1" fill="currentColor" stroke="none" />
		</svg>
	);
}

function IconPlan({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M8 6h13M8 12h13M8 18h13" strokeLinecap="round" />
			<circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none" />
			<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
			<circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none" />
		</svg>
	);
}

function IconDebug({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 4v2M8 6l-1 2M16 6l1 2M6 10h12M8 14l-1 4M16 14l1 4M9 20h6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconTeam({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="7" cy="9" r="2" />
			<circle cx="12" cy="7" r="2" />
			<circle cx="17" cy="9" r="2" />
			<path d="M4 18a3 3 0 0 1 6 0M9 18a3 3 0 0 1 6 0M14 18a3 3 0 0 1 6 0" strokeLinecap="round" />
		</svg>
	);
}

function IconAsk({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" strokeLinejoin="round" />
		</svg>
	);
}

function IconImage({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="3" y="5" width="18" height="14" rx="2" />
			<circle cx="8.5" cy="10" r="1.5" fill="currentColor" stroke="none" />
			<path d="M21 17l-5-5-4 4-2-2-4 4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconBook({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
			<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
		</svg>
	);
}

function IconChip({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="4" y="4" width="16" height="16" rx="2" />
			<path d="M9 9h6M9 13h4" strokeLinecap="round" />
		</svg>
	);
}

function IconChevRight({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
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

function modeIcon(id: ComposerMode) {
	switch (id) {
		case 'agent':
			return <IconAgent />;
		case 'plan':
			return <IconPlan />;
		case 'team':
			return <IconTeam />;
		case 'debug':
			return <IconDebug />;
		case 'ask':
			return <IconAsk />;
		default:
			return <IconAgent />;
	}
}

function displayMcpStatus(item: ComposerPlusMcpItem): McpServerStatus['status'] {
	if (!item.enabled) {
		return 'disabled';
	}
	return item.status === 'disconnected' ? 'stopped' : item.status;
}

function mcpStatusTone(status: McpServerStatus['status']): 'ok' | 'warn' | 'err' | 'muted' {
	switch (status) {
		case 'connected':
			return 'ok';
		case 'connecting':
			return 'warn';
		case 'error':
			return 'err';
		default:
			return 'muted';
	}
}

function mcpStatusLabel(status: McpServerStatus['status'], translate: (key: string) => string) {
	switch (status) {
		case 'connected':
			return translate('mcp.status.connected');
		case 'connecting':
			return translate('mcp.status.connecting');
		case 'error':
			return translate('mcp.status.error');
		case 'disabled':
			return translate('mcp.status.disabled');
		case 'stopped':
			return translate('mcp.status.stopped');
		case 'disconnected':
			return translate('mcp.status.disconnected');
		default:
			return translate('mcp.status.notStarted');
	}
}

type Props = {
	open: boolean;
	onClose: () => void;
	anchorRef: React.RefObject<HTMLElement | null>;
	mode: ComposerMode;
	onSelectMode: (m: ComposerMode) => void;
	onPickImages?: () => Promise<void> | void;
	skills?: ComposerPlusSkillItem[];
	onInsertSkill?: (slug: string, name: string) => Promise<void> | void;
	onOpenSkillSettings?: () => void;
	mcpServers?: ComposerPlusMcpItem[];
	onToggleMcpServer?: (id: string, nextEnabled: boolean) => Promise<void> | void;
	onOpenMcpSettings?: () => void;
};

export function ComposerPlusMenu({
	open,
	onClose,
	anchorRef,
	mode,
	onSelectMode,
	onPickImages,
	skills = [],
	onInsertSkill,
	onOpenSkillSettings,
	mcpServers = [],
	onToggleMcpServer,
	onOpenMcpSettings,
}: Props) {
	const { t } = useI18n();
	const modes = useMemo(
		() => MODE_IDS.map((id) => ({ id, label: t(`composer.mode.${id}`) })),
		[t]
	);
	const plusMainRef = useRef<HTMLDivElement>(null);
	const plusSubRef = useRef<HTMLDivElement>(null);
	const [submenu, setSubmenu] = useState<'skills' | 'mcp' | null>(null);
	const [pickingImages, setPickingImages] = useState(false);
	const [busyMcpIds, setBusyMcpIds] = useState<string[]>([]);
	const [mainLayout, setMainLayout] = useState<ClampedPopoverLayout>({
		placement: 'below',
		left: 0,
		width: 280,
		top: 120,
		maxHeightPx: 380,
		minHeightPx: 160,
	});
	const [subLayout, setSubLayout] = useState<PlusSubLayout | null>(null);

	const runLayout = useCallback(() => {
		const el = anchorRef.current;
		if (!el) {
			return;
		}
		const r = el.getBoundingClientRect();
		/* 与 getBoundingClientRect 同一套布局视口坐标；避免 visualViewport 与 document.body.style.zoom 组合时和 r 不一致 */
		const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
		const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
		const w = Math.min(300, Math.max(260, vw - 2 * POPOVER_VIEW_MARGIN));
		const est = plusMenuEstHeight();
		const mainEl = plusMainRef.current;
		let mainNatural = est;
		if (mainEl && mainEl.scrollHeight > 48) {
			mainNatural = measurePlusMainContentHeight(mainEl);
		}
		if (mainNatural < 80) {
			mainNatural = est;
		}
		const mainL = computeClampedPopoverLayout(r, {
			viewportWidth: vw,
			viewportHeight: vh,
			menuWidth: w,
			contentHeight: mainNatural,
			preferAboveNearViewportBottom: true,
		});
		setMainLayout(mainL);

		const subOpen = submenu === 'skills' || submenu === 'mcp';
		if (!subOpen) {
			setSubLayout(null);
			return;
		}
		const subEl = plusSubRef.current;
		const subNatural = subEl ? measurePlusSubmenuContentHeight(subEl) : PLUS_SUBMENU_EST_HEIGHT;
		const mainRight = mainL.left + mainL.width;
		const canRight =
			mainRight + PLUS_SUBMENU_GAP + PLUS_SUBMENU_WIDTH <= vw - POPOVER_VIEW_MARGIN;
		const canLeft = mainL.left - PLUS_SUBMENU_GAP - PLUS_SUBMENU_WIDTH >= POPOVER_VIEW_MARGIN;
		const side: 'left' | 'right' = canRight || !canLeft ? 'right' : 'left';
		const subLeft =
			side === 'right'
				? mainRight + PLUS_SUBMENU_GAP
				: Math.max(POPOVER_VIEW_MARGIN, mainL.left - PLUS_SUBMENU_WIDTH - PLUS_SUBMENU_GAP);
		const hardCap = Math.max(120, Math.floor(vh * 0.88));
		if (mainL.placement === 'below') {
			const top = mainL.top ?? 0;
			const avail = Math.max(0, vh - POPOVER_VIEW_MARGIN - top);
			const maxH = Math.max(120, Math.min(subNatural, avail, hardCap));
			setSubLayout({ left: subLeft, top, maxHeight: maxH });
		} else {
			const bottom = mainL.bottom ?? 0;
			const avail = Math.max(0, vh - POPOVER_VIEW_MARGIN - bottom);
			const maxH = Math.max(120, Math.min(subNatural, avail, hardCap));
			setSubLayout({ left: subLeft, bottom, maxHeight: maxH });
		}
	}, [anchorRef, submenu]);

	useLayoutEffect(() => {
		if (!open) {
			return;
		}
		runLayout();
		const id0 = requestAnimationFrame(() => {
			runLayout();
			requestAnimationFrame(() => runLayout());
		});
		const ro =
			typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => runLayout()) : null;
		if (ro) {
			if (plusMainRef.current) {
				ro.observe(plusMainRef.current);
			}
			if (plusSubRef.current) {
				ro.observe(plusSubRef.current);
			}
		}
		const onWin = () => runLayout();
		window.addEventListener('resize', onWin);
		window.addEventListener('scroll', onWin, true);
		const vv = window.visualViewport;
		vv?.addEventListener('resize', onWin);
		vv?.addEventListener('scroll', onWin);
		return () => {
			cancelAnimationFrame(id0);
			ro?.disconnect();
			window.removeEventListener('resize', onWin);
			window.removeEventListener('scroll', onWin, true);
			vv?.removeEventListener('resize', onWin);
			vv?.removeEventListener('scroll', onWin);
		};
	}, [open, runLayout, submenu]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			const target = e.target as Node;
			if (
				plusMainRef.current?.contains(target) ||
				plusSubRef.current?.contains(target) ||
				anchorRef.current?.contains(target)
			) {
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

	useEffect(() => {
		if (!open) {
			setSubmenu(null);
			setPickingImages(false);
			setBusyMcpIds([]);
		}
	}, [open]);

	const handlePickImages = useCallback(async () => {
		if (!onPickImages || pickingImages) {
			return;
		}
		setPickingImages(true);
		try {
			await Promise.resolve(onPickImages());
			onClose();
		} finally {
			setPickingImages(false);
		}
	}, [onClose, onPickImages, pickingImages]);

	const handleInsertSkill = useCallback(
		async (slug: string, name: string) => {
			if (!onInsertSkill) {
				return;
			}
			await Promise.resolve(onInsertSkill(slug, name));
			onClose();
		},
		[onClose, onInsertSkill]
	);

	const handleToggleMcp = useCallback(
		async (id: string, nextEnabled: boolean) => {
			if (!onToggleMcpServer || busyMcpIds.includes(id)) {
				return;
			}
			setBusyMcpIds((prev) => [...prev, id]);
			try {
				await Promise.resolve(onToggleMcpServer(id, nextEnabled));
			} finally {
				setBusyMcpIds((prev) => prev.filter((entry) => entry !== id));
			}
		},
		[busyMcpIds, onToggleMcpServer]
	);

	if (!open) {
		return null;
	}

	const submenuOpen = submenu === 'skills' || submenu === 'mcp';

	return createPortal(
		<>
			<div
				ref={plusMainRef}
				className={`ref-plus-menu ${mainLayout.placement === 'above' ? 'ref-plus-menu--above' : ''}`}
				style={{
					position: 'fixed',
					left: mainLayout.left,
					width: mainLayout.width,
					maxHeight: mainLayout.maxHeightPx,
					overflowY: 'auto',
					...(mainLayout.placement === 'below'
						? { top: mainLayout.top ?? 0 }
						: { bottom: mainLayout.bottom ?? 0 }),
				}}
				role="menu"
				aria-label={t('composer.plusMenuAria')}
			>
				<div
					className="ref-plus-menu-modes"
					role="group"
					aria-label={t('composer.plusMenuModes')}
					onMouseEnter={() => setSubmenu(null)}
				>
					{modes.map((m) => (
						<button
							key={m.id}
							type="button"
							role="menuitemradio"
							aria-checked={mode === m.id}
							className={`ref-plus-menu-row ref-plus-menu-row--mode ref-plus-menu-row--${m.id} ${mode === m.id ? 'is-active' : ''}`}
							onClick={() => {
								onSelectMode(m.id);
								onClose();
							}}
						>
							<span className="ref-plus-menu-ico">{modeIcon(m.id)}</span>
							<span className="ref-plus-menu-label">{m.label}</span>
							<span className="ref-plus-menu-check" aria-hidden>
								{mode === m.id ? <IconCheck /> : null}
							</span>
						</button>
					))}
				</div>
				<div className="ref-plus-menu-sep" role="separator" />
				<button
					type="button"
					className="ref-plus-menu-row ref-plus-menu-row--sub"
					role="menuitem"
					onMouseEnter={() => setSubmenu(null)}
					onFocus={() => setSubmenu(null)}
					onClick={() => void handlePickImages()}
					disabled={pickingImages}
				>
					<span className="ref-plus-menu-ico">
						<IconImage />
					</span>
					<span className="ref-plus-menu-label">{t('composer.plusImage')}</span>
				</button>
				<button
					type="button"
					className={`ref-plus-menu-row ref-plus-menu-row--sub ${submenu === 'skills' ? 'is-active' : ''}`}
					role="menuitem"
					aria-haspopup="menu"
					aria-expanded={submenu === 'skills'}
					onMouseEnter={() => setSubmenu('skills')}
					onFocus={() => setSubmenu('skills')}
				>
					<span className="ref-plus-menu-ico">
						<IconBook />
					</span>
					<span className="ref-plus-menu-label">{t('composer.plusSkills')}</span>
					<IconChevRight className="ref-plus-menu-chev" />
				</button>
				<button
					type="button"
					className={`ref-plus-menu-row ref-plus-menu-row--sub ${submenu === 'mcp' ? 'is-active' : ''}`}
					role="menuitem"
					aria-haspopup="menu"
					aria-expanded={submenu === 'mcp'}
					onMouseEnter={() => setSubmenu('mcp')}
					onFocus={() => setSubmenu('mcp')}
				>
					<span className="ref-plus-menu-ico">
						<IconChip />
					</span>
					<span className="ref-plus-menu-label">{t('composer.plusMcp')}</span>
					<IconChevRight className="ref-plus-menu-chev" />
				</button>
			</div>

			{submenuOpen && subLayout ? (
				<div
					ref={plusSubRef}
					className={`ref-plus-submenu ${mainLayout.placement === 'above' ? 'ref-plus-submenu--above' : ''}`}
					style={{
						position: 'fixed',
						left: subLayout.left,
						width: PLUS_SUBMENU_WIDTH,
						maxHeight: subLayout.maxHeight,
						...(subLayout.top !== undefined
							? { top: subLayout.top }
							: { bottom: subLayout.bottom ?? 0 }),
					}}
					role="menu"
					aria-label={submenu === 'skills' ? t('composer.plusSkills') : t('composer.plusMcp')}
				>
					{submenu === 'skills' ? (
						<>
							<div className="ref-plus-submenu-head">
								<div className="ref-plus-submenu-title">{t('composer.plusSkills')}</div>
								<div className="ref-plus-submenu-note">{t('composer.plusSkillsHint')}</div>
							</div>
							<div className="ref-plus-submenu-list">
								{skills.length > 0 ? (
									skills.map((skill) => (
										<button
											key={skill.id}
											type="button"
											className="ref-plus-submenu-item"
											onClick={() => void handleInsertSkill(skill.slug, skill.name)}
											title={`./${skill.slug}`}
										>
											<div className="ref-plus-submenu-item-top">
												<span className="ref-plus-submenu-item-title">{skill.name}</span>
												<span className="ref-plus-submenu-item-chip">./{skill.slug}</span>
											</div>
											<div className="ref-plus-submenu-item-desc">
												{skill.description || t('composer.plusUseSkill')}
											</div>
										</button>
									))
								) : (
									<div className="ref-plus-submenu-empty">{t('composer.plusSkillsEmpty')}</div>
								)}
							</div>
							<button
								type="button"
								className="ref-plus-submenu-footer"
								onClick={() => {
									onOpenSkillSettings?.();
									onClose();
								}}
							>
								{t('composer.plusOpenSkillSettings')}
							</button>
						</>
					) : (
						<>
							<div className="ref-plus-submenu-head">
								<div className="ref-plus-submenu-title">{t('composer.plusMcp')}</div>
								<div className="ref-plus-submenu-note">{t('composer.plusMcpHint')}</div>
							</div>
							<div className="ref-plus-submenu-list">
								{mcpServers.length > 0 ? (
									mcpServers.map((server) => {
										const status = displayMcpStatus(server);
										const statusTone = mcpStatusTone(status);
										const busy = busyMcpIds.includes(server.id);
										return (
											<div key={server.id} className="ref-plus-mcp-item">
												<div className="ref-plus-mcp-item-copy">
													<div className="ref-plus-mcp-item-top">
														<span className="ref-plus-submenu-item-title">{server.name}</span>
														<span className={`ref-plus-mcp-status ref-plus-mcp-status--${statusTone}`}>
															{mcpStatusLabel(status, t)}
														</span>
													</div>
													<div className="ref-plus-submenu-item-desc">
														{server.transport}
														{' · '}
														{server.toolsCount > 0 ? t('mcp.toolsCount', { count: server.toolsCount }) : t('mcp.noTools')}
													</div>
													{server.error ? (
														<div className="ref-plus-mcp-item-error">{server.error}</div>
													) : null}
												</div>
												<label className={`ref-plus-switch ${busy ? 'is-busy' : ''}`}>
													<input
														type="checkbox"
														checked={server.enabled}
														disabled={busy}
														onChange={(e) => void handleToggleMcp(server.id, e.target.checked)}
													/>
													<span className="ref-plus-switch-track">
														<span className="ref-plus-switch-thumb" />
													</span>
												</label>
											</div>
										);
									})
								) : (
									<div className="ref-plus-submenu-empty">{t('composer.plusMcpEmpty')}</div>
								)}
							</div>
							<button
								type="button"
								className="ref-plus-submenu-footer"
								onClick={() => {
									onOpenMcpSettings?.();
									onClose();
								}}
							>
								{t('composer.plusOpenMcpSettings')}
							</button>
						</>
					)}
				</div>
			) : null}
		</>,
		document.body
	);
}

export function composerModeLabel(id: ComposerMode, translate: (key: string) => string): string {
	return translate(`composer.mode.${id}`);
}

export function ComposerModeIcon({ mode, className }: { mode: ComposerMode; className?: string }) {
	return <span className={className}>{modeIcon(mode)}</span>;
}
