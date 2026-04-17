import type { CSSProperties } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from './i18n';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { IconDotsHorizontal, IconPlus, IconSettings, IconTerminal } from './icons';
import { TerminalSettingsPanel } from './terminalWindow/TerminalSettingsPanel';
import {
	buildTermSessionCreatePayload,
	loadTerminalSettings,
	saveTerminalSettings,
	type TerminalAppSettings,
} from './terminalWindow/terminalSettings';

type SessionInfo = {
	id: string;
	title: string;
	cwd: string;
	shell: string;
	cols: number;
	rows: number;
	alive: boolean;
	bufferBytes: number;
	createdAt: number;
};

type BufferSlice = {
	id: string;
	content: string;
	seq: number;
	alive: boolean;
	exitCode: number | null;
	bufferBytes: number;
};

type ShellBridge = NonNullable<Window['asyncShell']>;

type TabViewProps = {
	sessionId: string;
	active: boolean;
	shell: ShellBridge;
	onExit(code: number | null): void;
	theme: XTermThemeColors;
	appSettings: TerminalAppSettings;
};

type XTermThemeColors = {
	background: string;
	foreground: string;
	cursor: string;
	selectionBackground: string;
	black: string;
	brightBlack: string;
};

/** 单个 xterm 视图。订阅主进程广播的 `term:data`；首次挂载会回放缓冲区。 */
function TerminalTabView({ sessionId, active, shell, onExit, theme, appSettings }: TabViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<XTerm | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const seenSeqRef = useRef(0);
	const activeRef = useRef(active);
	const onExitRef = useRef(onExit);
	const appSettingsRef = useRef(appSettings);
	activeRef.current = active;
	onExitRef.current = onExit;
	appSettingsRef.current = appSettings;

	useEffect(() => {
		const el = containerRef.current;
		if (!el || !shell?.subscribeTerminalSessionData) {
			return;
		}
		const s = appSettingsRef.current;
		const term = new XTerm({
			theme: {
				background: theme.background,
				foreground: theme.foreground,
				cursor: theme.cursor,
				cursorAccent: theme.background,
				selectionBackground: theme.selectionBackground,
				black: theme.black,
				brightBlack: theme.brightBlack,
			},
			fontFamily: s.fontFamily,
			fontSize: s.fontSize,
			lineHeight: s.lineHeight,
			cursorBlink: s.cursorBlink,
			cursorStyle: s.cursorStyle,
			scrollback: s.scrollback,
			allowProposedApi: true,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(el);
		termRef.current = term;
		fitRef.current = fit;

		let cancelled = false;
		let sendQueued = false;
		const subscribeAndReplay = async () => {
			try {
				const sub = (await shell.invoke('term:sessionSubscribe', sessionId)) as
					| { ok: true; slice: BufferSlice }
					| { ok: false };
				if (cancelled || !sub.ok) {
					return;
				}
				seenSeqRef.current = sub.slice.seq;
				if (sub.slice.content) {
					term.write(sub.slice.content);
				}
				if (!sub.slice.alive) {
					onExitRef.current?.(sub.slice.exitCode);
				}
			} catch {
				/* ignore */
			}
		};
		void subscribeAndReplay();

		const unsubData = shell.subscribeTerminalSessionData?.((id, data, seq) => {
			if (id !== sessionId) {
				return;
			}
			if (seq && seq <= seenSeqRef.current) {
				return;
			}
			seenSeqRef.current = seq || seenSeqRef.current + 1;
			term.write(data);
		});
		const unsubExit =
			shell.subscribeTerminalSessionExit?.((id, code) => {
				if (id === sessionId) {
					onExitRef.current?.(typeof code === 'number' ? code : null);
				}
			}) ?? (() => {});

		const inputDisposer = term.onData((data) => {
			void shell.invoke('term:sessionWrite', sessionId, data);
		});

		const onSelectionChange = () => {
			if (!appSettingsRef.current.copyOnSelect || !term.hasSelection()) {
				return;
			}
			const txt = term.getSelection();
			if (txt) {
				void shell.invoke('clipboard:writeText', txt).catch(() => {
					/* ignore */
				});
			}
		};
		const selDisposer = term.onSelectionChange(onSelectionChange);

		const bellDisposer = term.onBell(() => {
			if (appSettingsRef.current.bell !== 'visual') {
				return;
			}
			el.classList.add('ref-uterm-bell-flash');
			window.setTimeout(() => el.classList.remove('ref-uterm-bell-flash'), 160);
		});

		const onContextMenu = (ev: MouseEvent) => {
			if (!appSettingsRef.current.rightClickPaste) {
				return;
			}
			ev.preventDefault();
			void shell
				.invoke('clipboard:readText')
				.then((raw) => {
					const text = typeof raw === 'string' ? raw : '';
					if (text) {
						term.paste(text);
					}
				})
				.catch(() => {
					/* ignore */
				});
		};
		el.addEventListener('contextmenu', onContextMenu);

		const propagateResize = () => {
			const f = fitRef.current;
			if (!f || !activeRef.current || !containerRef.current) {
				return;
			}
			try {
				f.fit();
				const dims = f.proposeDimensions();
				if (dims && dims.cols && dims.rows) {
					void shell.invoke('term:sessionResize', sessionId, dims.cols, dims.rows);
				}
			} catch {
				/* ignore */
			}
		};
		const ro = new ResizeObserver(() => {
			if (sendQueued) {
				return;
			}
			sendQueued = true;
			requestAnimationFrame(() => {
				sendQueued = false;
				propagateResize();
			});
		});
		ro.observe(el);

		return () => {
			cancelled = true;
			ro.disconnect();
			inputDisposer.dispose();
			selDisposer.dispose();
			bellDisposer.dispose();
			el.removeEventListener('contextmenu', onContextMenu);
			unsubData?.();
			unsubExit();
			void shell.invoke('term:sessionUnsubscribe', sessionId).catch(() => {
				/* ignore */
			});
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
		};
	}, [sessionId, shell, theme]);

	useEffect(() => {
		const term = termRef.current;
		if (!term) {
			return;
		}
		const s = appSettings;
		term.options.fontFamily = s.fontFamily;
		term.options.fontSize = s.fontSize;
		term.options.lineHeight = s.lineHeight;
		term.options.cursorBlink = s.cursorBlink;
		term.options.cursorStyle = s.cursorStyle;
		term.options.scrollback = s.scrollback;
		try {
			term.refresh(0, term.rows - 1);
		} catch {
			/* ignore */
		}
	}, [appSettings]);

	useEffect(() => {
		const term = termRef.current;
		if (!term) {
			return;
		}
		term.options.theme = {
			background: theme.background,
			foreground: theme.foreground,
			cursor: theme.cursor,
			cursorAccent: theme.background,
			selectionBackground: theme.selectionBackground,
			black: theme.black,
			brightBlack: theme.brightBlack,
		};
		try {
			term.refresh(0, term.rows - 1);
		} catch {
			/* ignore */
		}
	}, [theme]);

	useEffect(() => {
		if (!active) {
			return;
		}
		const term = termRef.current;
		const fit = fitRef.current;
		if (!term || !fit) {
			return;
		}
		const raf = requestAnimationFrame(() => {
			try {
				fit.fit();
				term.focus();
				const dims = fit.proposeDimensions();
				if (dims && dims.cols && dims.rows) {
					void shell.invoke('term:sessionResize', sessionId, dims.cols, dims.rows);
				}
			} catch {
				/* ignore */
			}
		});
		return () => cancelAnimationFrame(raf);
	}, [active, sessionId, shell]);

	return (
		<div
			ref={containerRef}
			className="ref-uterm-viewport"
			data-active={active ? '1' : '0'}
			aria-hidden={!active}
		/>
	);
}

const MemoTerminalTabView = memo(TerminalTabView);

type Props = { t: TFunction };

export const TerminalWindowSurface = memo(function TerminalWindowSurface({ t }: Props) {
	const shell = window.asyncShell;
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [exitByTab, setExitByTab] = useState<Record<string, number | null>>({});
	const [themeColors, setThemeColors] = useState<XTermThemeColors>(() => readXtermThemeColors());
	const [terminalSettings, setTerminalSettings] = useState<TerminalAppSettings>(() => loadTerminalSettings());
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [windowMaximized, setWindowMaximized] = useState(false);
	const creatingRef = useRef(false);
	const initialListLoadedRef = useRef(false);
	const createSessionRef = useRef<() => Promise<void>>(async () => {});
	const menuWrapRef = useRef<HTMLDivElement>(null);

	const refreshList = useCallback(async () => {
		if (!shell) {
			return;
		}
		try {
			const res = (await shell.invoke('term:sessionList')) as
				| { ok: true; sessions: SessionInfo[] }
				| { ok: false };
			if (!res.ok) {
				return;
			}
			setSessions(res.sessions);
			setActiveId((cur) => {
				if (cur && res.sessions.some((s) => s.id === cur)) {
					return cur;
				}
				return res.sessions[0]?.id ?? null;
			});
			const firstCycle = !initialListLoadedRef.current;
			initialListLoadedRef.current = true;
			if (firstCycle && res.sessions.length === 0) {
				await createSessionRef.current();
			}
		} catch {
			/* ignore */
		}
	}, [shell]);

	const createSession = useCallback(async () => {
		if (!shell || creatingRef.current) {
			return;
		}
		creatingRef.current = true;
		try {
			const profile =
				terminalSettings.profiles.find((p) => p.id === terminalSettings.defaultProfileId) ??
				terminalSettings.profiles[0];
			const payload = profile ? buildTermSessionCreatePayload(profile) : {};
			const res = (await shell.invoke('term:sessionCreate', payload)) as
				| { ok: true; session: SessionInfo }
				| { ok: false; error?: string };
			if (res.ok) {
				setSessions((prev) => (prev.some((s) => s.id === res.session.id) ? prev : [...prev, res.session]));
				setActiveId(res.session.id);
			}
		} finally {
			creatingRef.current = false;
		}
	}, [shell, terminalSettings]);

	createSessionRef.current = createSession;

	const closeSession = useCallback(
		async (id: string) => {
			if (!shell) {
				return;
			}
			await shell.invoke('term:sessionKill', id).catch(() => {
				/* ignore */
			});
			setExitByTab((prev) => {
				if (!(id in prev)) {
					return prev;
				}
				const next = { ...prev };
				delete next[id];
				return next;
			});
			setSessions((prev) => {
				const next = prev.filter((s) => s.id !== id);
				requestAnimationFrame(() => {
					setActiveId((cur) => (cur === id ? next[0]?.id ?? null : cur));
					if (next.length === 0) {
						void shell.invoke('app:windowClose').catch(() => {
							/* ignore */
						});
					}
				});
				return next;
			});
		},
		[shell]
	);

	useEffect(() => {
		void refreshList();
	}, [refreshList]);

	useEffect(() => {
		const unsub = shell?.subscribeTerminalSessionListChanged?.(() => {
			void refreshList();
		});
		return () => {
			unsub?.();
		};
	}, [shell, refreshList]);

	useEffect(() => {
		const obs = new MutationObserver(() => {
			setThemeColors(readXtermThemeColors());
		});
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-scheme'] });
		return () => obs.disconnect();
	}, []);

	useEffect(() => {
		if (!menuOpen) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			if (menuWrapRef.current?.contains(e.target as Node)) {
				return;
			}
			setMenuOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [menuOpen]);

	useEffect(() => {
		if (!shell || !menuOpen) {
			return;
		}
		let cancelled = false;
		void shell.invoke('app:windowGetState').then((r) => {
			if (cancelled) {
				return;
			}
			const o = r as { ok?: boolean; maximized?: boolean };
			if (o?.ok && typeof o.maximized === 'boolean') {
				setWindowMaximized(o.maximized);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [shell, menuOpen]);

	const handleExit = useCallback((id: string, code: number | null) => {
		setExitByTab((prev) => (prev[id] === code ? prev : { ...prev, [id]: code }));
	}, []);

	const persistSettings = useCallback((next: TerminalAppSettings) => {
		setTerminalSettings(next);
		saveTerminalSettings(next);
	}, []);

	const activeSessionExists = useMemo(() => sessions.some((s) => s.id === activeId), [sessions, activeId]);

	const onToggleMaximize = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('app:windowToggleMaximize');
		const r = (await shell.invoke('app:windowGetState')) as { ok?: boolean; maximized?: boolean };
		if (r?.ok && typeof r.maximized === 'boolean') {
			setWindowMaximized(r.maximized);
		}
		setMenuOpen(false);
	}, [shell]);

	const bodyStyle = useMemo(
		(): CSSProperties => ({
			opacity: terminalSettings.opacity,
		}),
		[terminalSettings.opacity]
	);

	if (!shell) {
		return <div className="ref-uterm-root ref-uterm-root--empty">{t('app.universalTerminalUnavailable')}</div>;
	}

	return (
		<div className="ref-uterm-root">
			{settingsOpen ? (
				<TerminalSettingsPanel
					t={t}
					settings={terminalSettings}
					onChange={persistSettings}
					onClose={() => setSettingsOpen(false)}
				/>
			) : null}
			<div className="ref-uterm-titlebar" role="banner">
				<div className="ref-uterm-title">
					<IconTerminal className="ref-uterm-title-icon" />
					<span>{t('app.universalTerminalWindowTitle')}</span>
				</div>
				<div className="ref-uterm-tabstrip" role="tablist" aria-label={t('app.universalTerminalWindowTitle')}>
					{sessions.map((s, idx) => {
						const isActive = s.id === activeId;
						const exitCode = exitByTab[s.id];
						return (
							<div
								key={s.id}
								role="tab"
								aria-selected={isActive}
								className={`ref-uterm-tab ${isActive ? 'is-active' : ''} ${
									exitCode !== undefined ? 'is-exited' : ''
								}`}
							>
								<button
									type="button"
									className="ref-uterm-tab-select"
									onClick={() => setActiveId(s.id)}
									title={s.cwd}
								>
									<IconTerminal className="ref-uterm-tab-icon" />
									<span className="ref-uterm-tab-label">{s.title || `Shell ${idx + 1}`}</span>
								</button>
								<button
									type="button"
									className="ref-uterm-tab-close"
									aria-label={t('app.universalTerminalCloseTab')}
									onClick={() => void closeSession(s.id)}
								>
									×
								</button>
							</div>
						);
					})}
					<button
						type="button"
						className="ref-uterm-tab-add"
						onClick={() => void createSession()}
						title={t('app.universalTerminalNewTab')}
						aria-label={t('app.universalTerminalNewTab')}
					>
						<IconPlus className="ref-uterm-tab-add-icon" />
					</button>
				</div>
				<div className="ref-uterm-drag-spacer" aria-hidden="true" />
				<div className="ref-uterm-titlebar-actions">
					<button
						type="button"
						className="ref-uterm-icon-btn"
						onClick={() => setSettingsOpen(true)}
						title={t('app.universalTerminalSettings.title')}
						aria-label={t('app.universalTerminalSettings.title')}
					>
						<IconSettings className="ref-uterm-icon-btn-svg" />
					</button>
					<div className="ref-uterm-menu-wrap" ref={menuWrapRef}>
						<button
							type="button"
							className="ref-uterm-icon-btn"
							aria-expanded={menuOpen}
							aria-haspopup="menu"
							onClick={() => setMenuOpen((o) => !o)}
							title={t('app.universalTerminalMenu.title')}
							aria-label={t('app.universalTerminalMenu.title')}
						>
							<IconDotsHorizontal className="ref-uterm-icon-btn-svg" />
						</button>
						{menuOpen ? (
							<div className="ref-uterm-dropdown" role="menu">
								<button
									type="button"
									role="menuitem"
									className="ref-uterm-dropdown-item"
									onClick={() => {
										setMenuOpen(false);
										void createSession();
									}}
								>
									{t('app.universalTerminalNewTab')}
								</button>
								<button
									type="button"
									role="menuitem"
									className="ref-uterm-dropdown-item"
									disabled={!activeId}
									onClick={() => {
										if (activeId) {
											setMenuOpen(false);
											void closeSession(activeId);
										}
									}}
								>
									{t('app.universalTerminalMenu.closeActiveTab')}
								</button>
								<div className="ref-uterm-dropdown-sep" role="separator" />
								<button
									type="button"
									role="menuitem"
									className="ref-uterm-dropdown-item"
									onClick={() => {
										setMenuOpen(false);
										setSettingsOpen(true);
									}}
								>
									{t('app.universalTerminalSettings.title')}
								</button>
								<div className="ref-uterm-dropdown-sep" role="separator" />
								<button
									type="button"
									role="menuitem"
									className="ref-uterm-dropdown-item"
									onClick={() => {
										setMenuOpen(false);
										void shell.invoke('app:windowMinimize');
									}}
								>
									{t('app.window.minimize')}
								</button>
								<button
									type="button"
									role="menuitem"
									className="ref-uterm-dropdown-item"
									onClick={() => void onToggleMaximize()}
								>
									{windowMaximized ? t('app.window.restore') : t('app.window.maximize')}
								</button>
								<button
									type="button"
									role="menuitem"
									className="ref-uterm-dropdown-item ref-uterm-dropdown-item--danger"
									onClick={() => {
										setMenuOpen(false);
										void shell.invoke('app:windowClose');
									}}
								>
									{t('app.window.close')}
								</button>
							</div>
						) : null}
					</div>
				</div>
			</div>
			<div className="ref-uterm-body" style={bodyStyle}>
				{sessions.length === 0 ? (
					<div className="ref-uterm-empty">{t('app.universalTerminalEmpty')}</div>
				) : (
					sessions.map((s) => {
						const isActive = activeSessionExists && s.id === activeId;
						const exitCode = exitByTab[s.id];
						return (
							<div
								key={s.id}
								className={`ref-uterm-pane ${isActive ? 'is-active' : ''}`}
								aria-hidden={!isActive}
							>
								<MemoTerminalTabView
									sessionId={s.id}
									active={isActive}
									shell={shell}
									theme={themeColors}
									appSettings={terminalSettings}
									onExit={(code) => handleExit(s.id, code)}
								/>
								{exitCode !== undefined && (
									<div className="ref-uterm-pane-exitbadge">
										{t('app.universalTerminalSessionExited', {
											code: exitCode === null ? '?' : String(exitCode),
										})}
									</div>
								)}
							</div>
						);
					})
				)}
			</div>
		</div>
	);
});

function readCssVar(name: string, fallback: string): string {
	try {
		const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return v || fallback;
	} catch {
		return fallback;
	}
}

function readXtermThemeColors(): XTermThemeColors {
	const bg = readCssVar('--void-bg-0', '#11171c');
	const fg = readCssVar('--void-fg-0', '#f3f7f8');
	const ring = readCssVar('--void-ring', '#37d6d4');
	return {
		background: bg,
		foreground: fg,
		cursor: ring,
		selectionBackground: '#37d6d455',
		black: bg,
		brightBlack: '#3f4b57',
	};
}
