import type { CSSProperties } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from './i18n';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { IconDotsHorizontal, IconPlus, IconSettings, IconTerminal } from './icons';
import { TerminalSettingsPanel } from './terminalWindow/TerminalSettingsPanel';
import {
	buildTerminalProfileTarget,
	buildTermSessionCreatePayload,
	loadTerminalSettings,
	saveTerminalSettings,
	subscribeTerminalSettings,
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
		const settings = appSettingsRef.current;
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
			fontFamily: settings.fontFamily,
			fontSize: settings.fontSize,
			fontWeight: settings.fontWeight,
			fontWeightBold: settings.fontWeightBold,
			lineHeight: settings.lineHeight,
			cursorBlink: settings.cursorBlink,
			cursorStyle: settings.cursorStyle,
			scrollback: settings.scrollback,
			minimumContrastRatio: settings.minimumContrastRatio,
			drawBoldTextInBrightColors: settings.drawBoldTextInBrightColors,
			scrollOnUserInput: settings.scrollOnInput,
			wordSeparator: settings.wordSeparator,
			allowProposedApi: true,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(el);
		termRef.current = term;
		fitRef.current = fit;

		let cancelled = false;
		let resizeQueued = false;
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

		const unsubData = shell.subscribeTerminalSessionData((id, data, seq) => {
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

		const selectionDisposer = term.onSelectionChange(() => {
			if (!appSettingsRef.current.copyOnSelect || !term.hasSelection()) {
				return;
			}
			const selection = term.getSelection();
			if (selection) {
				void shell.invoke('clipboard:writeText', selection).catch(() => {
					/* ignore */
				});
			}
		});

		const bellDisposer = term.onBell(() => {
			if (appSettingsRef.current.bell !== 'visual') {
				return;
			}
			el.classList.add('ref-uterm-bell-flash');
			window.setTimeout(() => el.classList.remove('ref-uterm-bell-flash'), 160);
		});

		const onContextMenu = (event: MouseEvent) => {
			const action = appSettingsRef.current.rightClickAction;
			if (action === 'off') {
				return;
			}
			event.preventDefault();
			if (action === 'clipboard' && term.hasSelection()) {
				const selection = term.getSelection();
				if (selection) {
					void shell.invoke('clipboard:writeText', selection).catch(() => {
						/* ignore */
					});
				}
				return;
			}
			void shell.invoke('clipboard:readText').then((raw) => {
				const text = typeof raw === 'string' ? raw : '';
				if (text) {
					term.paste(text);
				}
			}).catch(() => {
				/* ignore */
			});
		};
		el.addEventListener('contextmenu', onContextMenu);

		const propagateResize = () => {
			if (!activeRef.current || !fitRef.current || !containerRef.current) {
				return;
			}
			try {
				fitRef.current.fit();
				const dims = fitRef.current.proposeDimensions();
				if (dims && dims.cols && dims.rows) {
					void shell.invoke('term:sessionResize', sessionId, dims.cols, dims.rows);
				}
			} catch {
				/* ignore */
			}
		};

		const observer = new ResizeObserver(() => {
			if (resizeQueued) {
				return;
			}
			resizeQueued = true;
			requestAnimationFrame(() => {
				resizeQueued = false;
				propagateResize();
			});
		});
		observer.observe(el);

		return () => {
			cancelled = true;
			observer.disconnect();
			inputDisposer.dispose();
			selectionDisposer.dispose();
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
		term.options.fontFamily = appSettings.fontFamily;
		term.options.fontSize = appSettings.fontSize;
		term.options.fontWeight = appSettings.fontWeight;
		term.options.fontWeightBold = appSettings.fontWeightBold;
		term.options.lineHeight = appSettings.lineHeight;
		term.options.cursorBlink = appSettings.cursorBlink;
		term.options.cursorStyle = appSettings.cursorStyle;
		term.options.scrollback = appSettings.scrollback;
		term.options.minimumContrastRatio = appSettings.minimumContrastRatio;
		term.options.drawBoldTextInBrightColors = appSettings.drawBoldTextInBrightColors;
		term.options.scrollOnUserInput = appSettings.scrollOnInput;
		term.options.wordSeparator = appSettings.wordSeparator;
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

	return <div ref={containerRef} className="ref-uterm-viewport" aria-hidden={!active} />;
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
	const createSessionRef = useRef<(profileId?: string) => Promise<void>>(async () => {});
	const menuWrapRef = useRef<HTMLDivElement>(null);

	const refreshList = useCallback(async () => {
		if (!shell) {
			return;
		}
		try {
			const result = (await shell.invoke('term:sessionList')) as
				| { ok: true; sessions: SessionInfo[] }
				| { ok: false };
			if (!result.ok) {
				return;
			}
			setSessions(result.sessions);
			setActiveId((current) => {
				if (current && result.sessions.some((session) => session.id === current)) {
					return current;
				}
				return result.sessions[0]?.id ?? null;
			});
			const firstCycle = !initialListLoadedRef.current;
			initialListLoadedRef.current = true;
			if (firstCycle && result.sessions.length === 0) {
				await createSessionRef.current();
			}
		} catch {
			/* ignore */
		}
	}, [shell]);

	const createSession = useCallback(
		async (profileId?: string) => {
			if (!shell || creatingRef.current) {
				return;
			}
			creatingRef.current = true;
			try {
				const profile =
					terminalSettings.profiles.find((item) => item.id === profileId) ??
					terminalSettings.profiles.find((item) => item.id === terminalSettings.defaultProfileId) ??
					terminalSettings.profiles[0];
				const payload = profile ? buildTermSessionCreatePayload(profile) : {};
				const result = (await shell.invoke('term:sessionCreate', payload)) as
					| { ok: true; session: SessionInfo }
					| { ok: false; error?: string };
				if (result.ok) {
					setSessions((prev) => (prev.some((session) => session.id === result.session.id) ? prev : [...prev, result.session]));
					setActiveId(result.session.id);
					setSettingsOpen(false);
				}
			} finally {
				creatingRef.current = false;
			}
		},
		[shell, terminalSettings]
	);

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
				const next = prev.filter((session) => session.id !== id);
				requestAnimationFrame(() => {
					setActiveId((current) => (current === id ? next[0]?.id ?? null : current));
					if (next.length === 0 && !settingsOpen) {
						void shell.invoke('app:windowClose').catch(() => {
							/* ignore */
						});
					}
				});
				return next;
			});
		},
		[shell, settingsOpen]
	);

	useEffect(() => {
		void refreshList();
	}, [refreshList]);

	useEffect(() => {
		const unsubscribe = shell?.subscribeTerminalSessionListChanged?.(() => {
			void refreshList();
		});
		return () => unsubscribe?.();
	}, [shell, refreshList]);

	useEffect(() => {
		const observer = new MutationObserver(() => {
			setThemeColors(readXtermThemeColors());
		});
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-scheme'] });
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		return subscribeTerminalSettings(() => {
			setTerminalSettings(loadTerminalSettings());
		});
	}, []);

	useEffect(() => {
		if (!menuOpen) {
			return;
		}
		const onDocumentMouseDown = (event: MouseEvent) => {
			if (menuWrapRef.current?.contains(event.target as Node)) {
				return;
			}
			setMenuOpen(false);
		};
		document.addEventListener('mousedown', onDocumentMouseDown);
		return () => document.removeEventListener('mousedown', onDocumentMouseDown);
	}, [menuOpen]);

	useEffect(() => {
		if (!shell || !menuOpen) {
			return;
		}
		let cancelled = false;
		void shell.invoke('app:windowGetState').then((result) => {
			if (cancelled) {
				return;
			}
			const state = result as { ok?: boolean; maximized?: boolean };
			if (state?.ok && typeof state.maximized === 'boolean') {
				setWindowMaximized(state.maximized);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [shell, menuOpen]);

	const persistSettings = useCallback((next: TerminalAppSettings) => {
		setTerminalSettings(next);
		saveTerminalSettings(next);
	}, []);

	const handleExit = useCallback((id: string, code: number | null) => {
		setExitByTab((prev) => (prev[id] === code ? prev : { ...prev, [id]: code }));
	}, []);

	const activeSession = useMemo(
		() => sessions.find((session) => session.id === activeId) ?? sessions[0] ?? null,
		[sessions, activeId]
	);

	const defaultProfile = useMemo(
		() =>
			terminalSettings.profiles.find((profile) => profile.id === terminalSettings.defaultProfileId) ??
			terminalSettings.profiles[0] ??
			null,
		[terminalSettings.defaultProfileId, terminalSettings.profiles]
	);

	const terminalStageStyle = useMemo(
		(): CSSProperties =>
			({
				'--ref-uterm-body-opacity': String(terminalSettings.opacity),
			}) as CSSProperties,
		[terminalSettings.opacity]
	);

	const onToggleMaximize = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('app:windowToggleMaximize');
		const result = (await shell.invoke('app:windowGetState')) as { ok?: boolean; maximized?: boolean };
		if (result?.ok && typeof result.maximized === 'boolean') {
			setWindowMaximized(result.maximized);
		}
		setMenuOpen(false);
	}, [shell]);

	if (!shell) {
		return <div className="ref-uterm-root ref-uterm-root--empty">{t('app.universalTerminalUnavailable')}</div>;
	}

	return (
		<div className="ref-uterm-root">
			<div className="ref-uterm-titlebar" role="banner">
				<div className="ref-uterm-tabstrip" role="tablist" aria-label={t('app.universalTerminalWindowTitle')}>
					{settingsOpen ? (
						<TerminalTabButton
							active
							icon={<IconSettings className="ref-uterm-tab-icon" />}
							label={t('app.universalTerminalSettings.title')}
							onSelect={() => setSettingsOpen(true)}
							onClose={() => setSettingsOpen(false)}
						/>
					) : null}
					{sessions.map((session, index) => (
						<TerminalTabButton
							key={session.id}
							active={!settingsOpen && session.id === activeSession?.id}
							icon={<IconTerminal className="ref-uterm-tab-icon" />}
							label={session.title || `Shell ${index + 1}`}
							meta={session.cwd}
							exited={exitByTab[session.id] !== undefined}
							onSelect={() => {
								setActiveId(session.id);
								setSettingsOpen(false);
							}}
							onClose={() => void closeSession(session.id)}
						/>
					))}
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
						className={`ref-uterm-icon-btn ${settingsOpen ? 'is-active' : ''}`}
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
							onClick={() => setMenuOpen((prev) => !prev)}
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
								{terminalSettings.profiles.length > 0 ? (
									<>
										<div className="ref-uterm-dropdown-sep" role="separator" />
										<div className="ref-uterm-dropdown-label">
											{t('app.universalTerminalMenu.newWithProfile')}
										</div>
										{terminalSettings.profiles.map((profile) => (
											<button
												key={profile.id}
												type="button"
												role="menuitem"
												className="ref-uterm-dropdown-item ref-uterm-dropdown-item--stack"
												onClick={() => {
													setMenuOpen(false);
													void createSession(profile.id);
												}}
											>
												<span>{profile.name || t('app.universalTerminalSettings.profiles.untitled')}</span>
												<span className="ref-uterm-dropdown-item-meta">
													{describeTerminalProfileTarget(profile, t)}
													{profile.id === defaultProfile?.id
														? ` · ${t('app.universalTerminalMenu.defaultSuffix')}`
														: ''}
												</span>
											</button>
										))}
									</>
								) : null}
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

			{settingsOpen ? (
				<div className="ref-uterm-stage ref-uterm-stage--settings">
					<TerminalSettingsPanel t={t} settings={terminalSettings} onChange={persistSettings} />
				</div>
			) : (
				<div className="ref-uterm-stage ref-uterm-stage--terminal" style={terminalStageStyle}>
					{activeSession ? (
						<div className="ref-uterm-sessionbar">
							<div className="ref-uterm-sessionbar-main">
								<div className="ref-uterm-sessionbar-title">
									{activeSession.title || t('app.universalTerminalWindowTitle')}
								</div>
								<div className="ref-uterm-sessionbar-subtitle">{activeSession.cwd || activeSession.shell}</div>
							</div>
							<div className="ref-uterm-sessionbar-metrics">
								<span className="ref-uterm-sessionbar-pill">{activeSession.shell}</span>
								<span className="ref-uterm-sessionbar-pill">
									{activeSession.cols}×{activeSession.rows}
								</span>
								<span className="ref-uterm-sessionbar-pill">{formatBufferBytes(activeSession.bufferBytes)}</span>
							</div>
						</div>
					) : null}

					{sessions.length === 0 ? (
						<div className="ref-uterm-empty">{t('app.universalTerminalEmpty')}</div>
					) : (
						<div className="ref-uterm-panes">
							{sessions.map((session) => {
								const isActive = session.id === activeSession?.id;
								const exitCode = exitByTab[session.id];
								return (
									<div key={session.id} className={`ref-uterm-pane ${isActive ? 'is-active' : ''}`} aria-hidden={!isActive}>
										<MemoTerminalTabView
											sessionId={session.id}
											active={isActive}
											shell={shell}
											theme={themeColors}
											appSettings={terminalSettings}
											onExit={(code) => handleExit(session.id, code)}
										/>
										{exitCode !== undefined ? (
											<div className="ref-uterm-pane-exitbadge">
												{t('app.universalTerminalSessionExited', {
													code: exitCode === null ? '?' : String(exitCode),
												})}
											</div>
										) : null}
									</div>
								);
							})}
						</div>
					)}
				</div>
			)}
		</div>
	);
});

function TerminalTabButton({
	active,
	icon,
	label,
	meta,
	exited,
	onSelect,
	onClose,
}: {
	active: boolean;
	icon: React.ReactNode;
	label: string;
	meta?: string;
	exited?: boolean;
	onSelect(): void;
	onClose(): void;
}) {
	return (
		<div className={`ref-uterm-tab ${active ? 'is-active' : ''} ${exited ? 'is-exited' : ''}`} role="tab" aria-selected={active}>
			<button type="button" className="ref-uterm-tab-select" onClick={onSelect} title={meta || label}>
				{icon}
				<span className="ref-uterm-tab-label">{label}</span>
			</button>
			<button type="button" className="ref-uterm-tab-close" onClick={onClose} aria-label={label}>
				×
			</button>
		</div>
	);
}

function readCssVar(name: string, fallback: string): string {
	try {
		const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return value || fallback;
	} catch {
		return fallback;
	}
}

function readXtermThemeColors(): XTermThemeColors {
	const background = readCssVar('--void-bg-0', '#11171c');
	const foreground = readCssVar('--void-fg-0', '#f3f7f8');
	const cursor = readCssVar('--void-ring', '#37d6d4');
	return {
		background,
		foreground,
		cursor,
		selectionBackground: '#37d6d455',
		black: background,
		brightBlack: '#3f4b57',
	};
}

function formatBufferBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeTerminalProfileTarget(
	profile: Pick<TerminalAppSettings['profiles'][number], 'kind' | 'shell' | 'sshUser' | 'sshHost' | 'sshPort'>,
	t: TFunction
): string {
	return buildTerminalProfileTarget(profile as TerminalAppSettings['profiles'][number]) || t('app.universalTerminalSettings.systemDefaultShell');
}
