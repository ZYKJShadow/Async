import type { CSSProperties } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from './i18n';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
	IconDotsHorizontal,
	IconFolderOpen,
	IconPin,
	IconPlug,
	IconPlus,
	IconRefresh,
	IconSettings,
	IconTerminal,
} from './icons';
import { TerminalAuthPromptModal } from './terminalWindow/TerminalAuthPromptModal';
import {
	TerminalSettingsPanel,
	type TerminalSettingsPanelOpenProfileRequest,
} from './terminalWindow/TerminalSettingsPanel';
import { TerminalSftpPanel } from './terminalWindow/TerminalSftpPanel';
import { TerminalStartPage, type TerminalStartPageProfile } from './terminalWindow/TerminalStartPage';
import {
	buildTerminalProfileTarget,
	buildTermSessionCreatePayload,
	getBuiltinTerminalProfiles,
	getTerminalColorSchemeById,
	loadTerminalSettings,
	resolveTerminalProfile,
	saveTerminalSettings,
	subscribeTerminalSettings,
	type TerminalAppSettings,
	type TerminalInputBackspaceMode,
	type TerminalProfile,
} from './terminalWindow/terminalSettings';
import {
	isTerminalAlternateScreen,
	playAudibleTerminalBell,
	prepareTerminalPasteText,
} from './terminalWindow/terminalRuntime';

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
	authPrompt: TerminalSessionAuthPrompt | null;
};

type TerminalSessionAuthPrompt = {
	prompt: string;
	kind: 'password' | 'passphrase';
	seq: number;
};

type ActiveTerminalAuthPrompt = TerminalSessionAuthPrompt & {
	sessionId: string;
	sessionTitle: string;
	profileId: string | null;
	profileName: string;
};

type ShellBridge = NonNullable<Window['asyncShell']>;

type TabViewProps = {
	sessionId: string;
	active: boolean;
	shell: ShellBridge;
	onExit(code: number | null): void;
	theme: XTermThemeColors;
	appSettings: TerminalAppSettings;
	profile: TerminalProfile | null;
	t: TFunction;
	onRequestContextMenu(payload: TerminalContextMenuState): void;
	onAuthPrompt(sessionId: string, prompt: TerminalSessionAuthPrompt): void;
	registerRuntime(sessionId: string, runtime: TerminalRuntimeControls | null): void;
};

type XTermThemeColors = {
	background: string;
	foreground: string;
	cursor: string;
	selectionBackground: string;
	black: string;
	brightBlack: string;
};

type TerminalRuntimeControls = {
	copySelection(): Promise<boolean>;
	pasteFromClipboard(): Promise<boolean>;
	selectAll(): void;
	clear(): void;
	focus(): void;
	hasSelection(): boolean;
};

type TerminalContextMenuState = {
	sessionId: string;
	x: number;
	y: number;
};

type RestorableTerminalTab = {
	profileId: string;
};

const TERMINAL_TAB_SNAPSHOT_KEY = 'void-shell:terminal:window-tabs';
const TERMINAL_TOOLBAR_PIN_STORAGE_KEY = 'void-shell:terminal:toolbar-pinned';

function TerminalTabView({
	sessionId,
	active,
	shell,
	onExit,
	theme,
	appSettings,
	profile,
	t,
	onRequestContextMenu,
	onAuthPrompt,
	registerRuntime,
}: TabViewProps) {
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
		if (!el || !shell?.subscribeTerminalSessionData || !active) {
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
			ignoreBracketedPasteMode: !settings.bracketedPaste,
			allowProposedApi: true,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(el);
		termRef.current = term;
		fitRef.current = fit;

		const confirmMultilinePaste = async (preview: string) =>
			window.confirm(`${t('app.universalTerminalPasteMultipleLines')}\n\n${preview.slice(0, 1000)}`);

		const pasteText = async (text: string): Promise<boolean> => {
			const next = await prepareTerminalPasteText(
				text,
				appSettingsRef.current,
				isTerminalAlternateScreen(term),
				confirmMultilinePaste
			);
			if (!next) {
				return false;
			}
			term.paste(next);
			return true;
		};

		const pasteFromClipboard = async (): Promise<boolean> => {
			try {
				const raw = await shell.invoke('clipboard:readText');
				const text = typeof raw === 'string' ? raw : '';
				if (!text) {
					return false;
				}
				return pasteText(text);
			} catch {
				return false;
			}
		};

		const copySelection = async (): Promise<boolean> => {
			const selection = term.getSelection();
			if (!selection) {
				return false;
			}
			try {
				await shell.invoke('clipboard:writeText', selection);
				return true;
			} catch {
				return false;
			}
		};

		registerRuntime(sessionId, {
			copySelection,
			pasteFromClipboard,
			selectAll: () => term.selectAll(),
			clear: () => term.clear(),
			focus: () => term.focus(),
			hasSelection: () => term.hasSelection(),
		});

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
				if (sub.slice.authPrompt) {
					onAuthPrompt(sessionId, sub.slice.authPrompt);
				}
				if (!sub.slice.alive) {
					onExitRef.current?.(sub.slice.exitCode);
				}
			} catch {
				/* ignore */
			}
		};
		void subscribeAndReplay();

		const loginScriptsState = profile?.loginScripts.map((script) => ({ ...script })) ?? [];
		void maybeRunLoginScripts(shell, sessionId, '', loginScriptsState);

		const unsubData = shell.subscribeTerminalSessionData((id, data, seq) => {
			if (id !== sessionId) {
				return;
			}
			if (seq && seq <= seenSeqRef.current) {
				return;
			}
			seenSeqRef.current = seq || seenSeqRef.current + 1;
			term.write(data);
			void maybeRunLoginScripts(shell, sessionId, data, loginScriptsState);
		});
		const unsubExit =
			shell.subscribeTerminalSessionExit?.((id, code) => {
				if (id === sessionId) {
					onExitRef.current?.(typeof code === 'number' ? code : null);
				}
			}) ?? (() => {});

		const inputDisposer = term.onData((data) => {
			void shell.invoke('term:sessionWrite', sessionId, applyInputBackspaceMode(data, profile?.inputBackspace));
		});

		const selectionDisposer = term.onSelectionChange(() => {
			if (!appSettingsRef.current.copyOnSelect || !term.hasSelection()) {
				return;
			}
			void copySelection();
		});

		const bellDisposer = term.onBell(() => {
			if (appSettingsRef.current.bell === 'visual') {
				el.classList.add('ref-uterm-bell-flash');
				window.setTimeout(() => el.classList.remove('ref-uterm-bell-flash'), 160);
				return;
			}
			if (appSettingsRef.current.bell === 'audible') {
				playAudibleTerminalBell();
			}
		});

		const onContextMenu = (event: MouseEvent) => {
			const action = appSettingsRef.current.rightClickAction;
			if (action === 'off') {
				return;
			}
			event.preventDefault();
			if (action === 'menu') {
				onRequestContextMenu({
					sessionId,
					x: event.clientX,
					y: event.clientY,
				});
				return;
			}
			if (action === 'clipboard' && term.hasSelection()) {
				void copySelection();
				return;
			}
			void pasteFromClipboard();
		};
		el.addEventListener('contextmenu', onContextMenu);

		const onAuxClick = (event: MouseEvent) => {
			if (event.button !== 1 || !appSettingsRef.current.pasteOnMiddleClick) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			void pasteFromClipboard();
		};
		el.addEventListener('auxclick', onAuxClick);

		const onPasteCapture = (event: ClipboardEvent) => {
			const text = event.clipboardData?.getData('text/plain') ?? '';
			if (!text) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			void pasteText(text);
		};
		el.addEventListener('paste', onPasteCapture, true);

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
			el.removeEventListener('auxclick', onAuxClick);
			el.removeEventListener('paste', onPasteCapture, true);
			unsubData?.();
			unsubExit();
			registerRuntime(sessionId, null);
			void shell.invoke('term:sessionUnsubscribe', sessionId).catch(() => {
				/* ignore */
			});
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
		};
	}, [active, onAuthPrompt, profile, sessionId, shell, t, theme, onRequestContextMenu, registerRuntime]);

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
		term.options.ignoreBracketedPasteMode = !appSettings.bracketedPaste;
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

type Props = {
	t: TFunction;
	forceStartPage?: boolean;
};

export const TerminalWindowSurface = memo(function TerminalWindowSurface({ t, forceStartPage = false }: Props) {
	const shell = window.asyncShell;
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [exitByTab, setExitByTab] = useState<Record<string, number | null>>({});
	const [sessionProfiles, setSessionProfiles] = useState<Record<string, string>>({});
	const [builtinProfiles, setBuiltinProfiles] = useState<TerminalProfile[]>(() => getBuiltinTerminalProfiles());
	const [themeColors, setThemeColors] = useState<XTermThemeColors>(() => readXtermThemeColors());
	const [terminalSettings, setTerminalSettings] = useState<TerminalAppSettings>(() => loadTerminalSettings());
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [contextMenu, setContextMenu] = useState<TerminalContextMenuState | null>(null);
	const [windowMaximized, setWindowMaximized] = useState(false);
	const [authPromptModal, setAuthPromptModal] = useState<ActiveTerminalAuthPrompt | null>(null);
	const [settingsOpenProfileRequest, setSettingsOpenProfileRequest] =
		useState<TerminalSettingsPanelOpenProfileRequest | null>(null);
	const [sftpPanelOpenBySession, setSftpPanelOpenBySession] = useState<Record<string, boolean>>({});
	const [sftpPanelPathBySession, setSftpPanelPathBySession] = useState<Record<string, string>>({});
	const [toolbarPinned, setToolbarPinned] = useState(() => loadTerminalToolbarPinned());
	const [toolbarRevealed, setToolbarRevealed] = useState(() => loadTerminalToolbarPinned());
	const creatingRef = useRef(false);
	const initialListLoadedRef = useRef(false);
	const createSessionRef = useRef<(profileId?: string) => Promise<void>>(async () => {});
	const builtinProfilesRef = useRef<TerminalProfile[]>(builtinProfiles);
	const menuWrapRef = useRef<HTMLDivElement>(null);
	const runtimeControlsRef = useRef<Record<string, TerminalRuntimeControls>>({});
	const toolbarHideTimerRef = useRef<number | null>(null);
	builtinProfilesRef.current = builtinProfiles;

	const clearToolbarHideTimer = useCallback(() => {
		if (toolbarHideTimerRef.current != null) {
			window.clearTimeout(toolbarHideTimerRef.current);
			toolbarHideTimerRef.current = null;
		}
	}, []);

	const revealTerminalToolbar = useCallback(() => {
		clearToolbarHideTimer();
		setToolbarRevealed(true);
	}, [clearToolbarHideTimer]);

	const hideTerminalToolbar = useCallback(() => {
		if (toolbarPinned) {
			setToolbarRevealed(true);
			return;
		}
		clearToolbarHideTimer();
		toolbarHideTimerRef.current = window.setTimeout(() => {
			setToolbarRevealed(false);
			toolbarHideTimerRef.current = null;
		}, 900);
	}, [clearToolbarHideTimer, toolbarPinned]);

	const toggleTerminalToolbarPinned = useCallback(() => {
		setToolbarPinned((current) => {
			const next = !current;
			saveTerminalToolbarPinned(next);
			if (next) {
				setToolbarRevealed(true);
			}
			return next;
		});
	}, []);

	useEffect(() => {
		if (toolbarPinned) {
			clearToolbarHideTimer();
			setToolbarRevealed(true);
		}
	}, [clearToolbarHideTimer, toolbarPinned]);

	useEffect(() => () => clearToolbarHideTimer(), [clearToolbarHideTimer]);

	const closeTerminalContextMenu = useCallback(() => {
		setContextMenu(null);
	}, []);

	const registerRuntime = useCallback((sessionId: string, runtime: TerminalRuntimeControls | null) => {
		if (runtime) {
			runtimeControlsRef.current[sessionId] = runtime;
			return;
		}
		delete runtimeControlsRef.current[sessionId];
	}, []);

	const handleRequestContextMenu = useCallback((payload: TerminalContextMenuState) => {
		setMenuOpen(false);
		setContextMenu(payload);
	}, []);

	const restoreSavedTabs = useCallback(async () => {
		const snapshot = loadTerminalTabSnapshot();
		if (!snapshot.length) {
			return false;
		}
		for (const tab of snapshot) {
			await createSessionRef.current(tab.profileId);
		}
		return true;
	}, []);

	const reloadBuiltinProfiles = useCallback(async (): Promise<TerminalProfile[]> => {
		if (!shell) {
			return builtinProfilesRef.current;
		}
		try {
			const raw = (await shell.invoke('term:listBuiltinProfiles')) as { ok?: boolean; profiles?: unknown[] };
			if (!raw?.ok || !Array.isArray(raw.profiles)) {
				return builtinProfilesRef.current;
			}
			const next = raw.profiles.map((profile) => profile as TerminalProfile);
			builtinProfilesRef.current = next;
			setBuiltinProfiles(next);
			return next;
		} catch {
			return builtinProfilesRef.current;
		}
	}, [shell]);

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
			setSessionProfiles((prev) => {
				let changed = false;
				const activeIds = new Set(result.sessions.map((session) => session.id));
				const next: Record<string, string> = {};
				for (const [id, profileId] of Object.entries(prev)) {
					if (activeIds.has(id)) {
						next[id] = profileId;
					} else {
						changed = true;
					}
				}
				return changed ? next : prev;
			});
			setActiveId((current) => {
				if (current && result.sessions.some((session) => session.id === current)) {
					return current;
				}
				return result.sessions[0]?.id ?? null;
			});
			const firstCycle = !initialListLoadedRef.current;
			if (firstCycle) {
				initialListLoadedRef.current = true;
			}
			if (firstCycle && result.sessions.length === 0) {
				await reloadBuiltinProfiles();
				const restored = !forceStartPage && terminalSettings.restoreTabs ? await restoreSavedTabs() : false;
				if (!restored && !forceStartPage && terminalSettings.autoOpen) {
					await createSessionRef.current();
				}
			}
		} catch {
			/* ignore */
		}
	}, [forceStartPage, reloadBuiltinProfiles, restoreSavedTabs, shell, terminalSettings.autoOpen, terminalSettings.restoreTabs]);

	const createSession = useCallback(
		async (profileId?: string) => {
			if (!shell || creatingRef.current) {
				return;
			}
			creatingRef.current = true;
			try {
				const resolvedProfile = resolveTerminalProfile(
					terminalSettings.profiles,
					profileId ?? terminalSettings.defaultProfileId,
					builtinProfilesRef.current
				);
				const profile = resolvedProfile ? withTerminalWindowProfileLabel(resolvedProfile, t) : null;
				const payload = profile ? buildTermSessionCreatePayload(profile) : {};
				const result = (await shell.invoke('term:sessionCreate', payload)) as
					| { ok: true; session: SessionInfo }
					| { ok: false; error?: string };
				if (result.ok) {
					if (profile) {
						setSessionProfiles((prev) => ({ ...prev, [result.session.id]: profile.id }));
					}
					setSessions((prev) => (prev.some((session) => session.id === result.session.id) ? prev : [...prev, result.session]));
					setActiveId(result.session.id);
					setSettingsOpen(false);
					setMenuOpen(false);
					setContextMenu(null);
				}
			} finally {
				creatingRef.current = false;
			}
		},
		[shell, t, terminalSettings]
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
			setSessionProfiles((prev) => {
				if (!(id in prev)) {
					return prev;
				}
				const next = { ...prev };
				delete next[id];
				return next;
			});
			setContextMenu((prev) => (prev?.sessionId === id ? null : prev));
			setSessions((prev) => {
				const next = prev.filter((session) => session.id !== id);
				requestAnimationFrame(() => {
					setActiveId((current) => (current === id ? next[0]?.id ?? null : current));
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
		void reloadBuiltinProfiles();
	}, [reloadBuiltinProfiles]);

	useEffect(() => {
		if (!settingsOpen) {
			return;
		}
		void reloadBuiltinProfiles();
	}, [reloadBuiltinProfiles, settingsOpen]);

	useEffect(() => {
		if (!terminalSettings.restoreTabs) {
			saveTerminalTabSnapshot([]);
			return;
		}
		saveTerminalTabSnapshot(
			sessions
				.map((session) => {
					const profileId = sessionProfiles[session.id] ?? terminalSettings.defaultProfileId;
					return profileId ? { profileId } : null;
				})
				.filter((tab): tab is RestorableTerminalTab => Boolean(tab))
		);
	}, [sessions, sessionProfiles, terminalSettings.defaultProfileId, terminalSettings.restoreTabs]);

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
		if (!contextMenu) {
			return;
		}
		const onPointerDown = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest('.ref-uterm-context-menu')) {
				return;
			}
			setContextMenu(null);
		};
		const onEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setContextMenu(null);
			}
		};
		document.addEventListener('mousedown', onPointerDown);
		document.addEventListener('keydown', onEscape);
		window.addEventListener('blur', closeTerminalContextMenu);
		window.addEventListener('resize', closeTerminalContextMenu);
		return () => {
			document.removeEventListener('mousedown', onPointerDown);
			document.removeEventListener('keydown', onEscape);
			window.removeEventListener('blur', closeTerminalContextMenu);
			window.removeEventListener('resize', closeTerminalContextMenu);
		};
	}, [contextMenu, closeTerminalContextMenu]);

	useEffect(() => {
		setContextMenu(null);
	}, [activeId, menuOpen, settingsOpen]);

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

	const displayBuiltinProfiles = useMemo(
		() => builtinProfiles.map((profile) => withTerminalWindowProfileLabel(profile, t)),
		[builtinProfiles, t]
	);

	const defaultProfile = useMemo(
		() => resolveTerminalProfile(terminalSettings.profiles, terminalSettings.defaultProfileId, builtinProfiles),
		[builtinProfiles, terminalSettings.defaultProfileId, terminalSettings.profiles]
	);
	const startPageProfiles = useMemo(() => {
		const next: TerminalStartPageProfile[] = [];
		const seen = new Set<string>();
		const appendProfile = (profile: TerminalProfile | null | undefined) => {
			if (!profile || seen.has(profile.id)) {
				return;
			}
			const displayProfile = withTerminalWindowProfileLabel(profile, t);
			seen.add(displayProfile.id);
			next.push({
				id: displayProfile.id,
				name: displayProfile.name || t('app.universalTerminalSettings.profiles.untitled'),
				target: describeTerminalProfileTarget(displayProfile, t),
				kind: displayProfile.kind,
				isDefault: displayProfile.id === defaultProfile?.id,
			});
		};

		appendProfile(defaultProfile);
		for (const profile of terminalSettings.profiles) {
			appendProfile(profile);
		}
		for (const profile of displayBuiltinProfiles) {
			appendProfile(profile);
		}
		return next;
	}, [defaultProfile, displayBuiltinProfiles, t, terminalSettings.profiles]);
	const startPageDefaultMeta = useMemo(() => {
		const profile = startPageProfiles.find((item) => item.isDefault) ?? startPageProfiles[0] ?? null;
		if (!profile) {
			return t('app.universalTerminalStartPageDefaultFallback');
		}
		return t('app.universalTerminalStartPageDefaultHint', {
			name: profile.name,
			target: profile.target,
		});
	}, [startPageProfiles, t]);
	const visibleStartPageProfiles = useMemo(() => startPageProfiles.slice(0, 6), [startPageProfiles]);
	const resolvedSessionProfiles = useMemo(() => {
		const next: Record<string, TerminalProfile | null> = {};
		for (const session of sessions) {
			next[session.id] = resolveTerminalProfile(
				terminalSettings.profiles,
				sessionProfiles[session.id] ?? terminalSettings.defaultProfileId,
				builtinProfiles
			);
		}
		return next;
	}, [builtinProfiles, sessionProfiles, sessions, terminalSettings.defaultProfileId, terminalSettings.profiles]);

	useEffect(() => {
		const activeIds = new Set(sessions.map((session) => session.id));
		setSftpPanelOpenBySession((prev) => {
			let changed = false;
			const next: Record<string, boolean> = {};
			for (const [sessionId, open] of Object.entries(prev)) {
				if (activeIds.has(sessionId)) {
					next[sessionId] = open;
				} else {
					changed = true;
				}
			}
			return changed ? next : prev;
		});
		setSftpPanelPathBySession((prev) => {
			let changed = false;
			const next: Record<string, string> = {};
			for (const [sessionId, sftpPath] of Object.entries(prev)) {
				if (activeIds.has(sessionId)) {
					next[sessionId] = sftpPath;
				} else {
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [sessions]);

	const openAuthPrompt = useCallback(
		(sessionId: string, prompt: TerminalSessionAuthPrompt) => {
			const session = sessions.find((item) => item.id === sessionId) ?? null;
			const resolvedProfile = resolvedSessionProfiles[sessionId] ?? null;
			const displayProfile = resolvedProfile ? withTerminalWindowProfileLabel(resolvedProfile, t) : null;
			setSettingsOpen(false);
			setActiveId(sessionId);
			setAuthPromptModal((current) => {
				if (current && current.sessionId === sessionId && current.seq === prompt.seq) {
					return current;
				}
				return {
					...prompt,
					sessionId,
					sessionTitle: session?.title || t('app.universalTerminalWindowTitle'),
					profileId: displayProfile?.id ?? null,
					profileName: displayProfile?.name || t('app.universalTerminalSettings.profiles.untitled'),
				};
			});
		},
		[resolvedSessionProfiles, sessions, t]
	);

	useEffect(() => {
		const unsubscribe = shell?.subscribeTerminalSessionAuthPrompt?.((id, prompt) => {
			if (!prompt) {
				return;
			}
			openAuthPrompt(id, prompt);
		});
		return () => unsubscribe?.();
	}, [openAuthPrompt, shell]);

	useEffect(() => {
		if (!authPromptModal) {
			return;
		}
		const session = sessions.find((item) => item.id === authPromptModal.sessionId) ?? null;
		if (!session || !session.alive) {
			setAuthPromptModal(null);
		}
	}, [authPromptModal, sessions]);

	const terminalStageStyle = useMemo(
		(): CSSProperties =>
			({
				'--ref-uterm-body-opacity': String(terminalSettings.opacity),
			}) as CSSProperties,
		[terminalSettings.opacity]
	);

	const contextRuntime = contextMenu ? runtimeControlsRef.current[contextMenu.sessionId] ?? null : null;

	const contextMenuStyle = useMemo((): CSSProperties | undefined => {
		if (!contextMenu || typeof window === 'undefined') {
			return undefined;
		}
		const padding = 8;
		const estimatedWidth = 220;
		const estimatedHeight = 148;
		return {
			left: Math.max(padding, Math.min(contextMenu.x, window.innerWidth - estimatedWidth - padding)),
			top: Math.max(padding, Math.min(contextMenu.y, window.innerHeight - estimatedHeight - padding)),
			right: 'auto',
		};
	}, [contextMenu]);

	const onContextCopy = useCallback(async () => {
		if (!contextRuntime) {
			return;
		}
		await contextRuntime.copySelection();
		closeTerminalContextMenu();
	}, [contextRuntime, closeTerminalContextMenu]);

	const onContextPaste = useCallback(async () => {
		if (!contextRuntime) {
			return;
		}
		await contextRuntime.pasteFromClipboard();
		closeTerminalContextMenu();
	}, [contextRuntime, closeTerminalContextMenu]);

	const onContextSelectAll = useCallback(() => {
		contextRuntime?.selectAll();
		closeTerminalContextMenu();
	}, [contextRuntime, closeTerminalContextMenu]);

	const openProfileSettingsFromToolbar = useCallback((profile: TerminalProfile | null, tab: 'general' | 'ports') => {
		if (!profile) {
			return;
		}
		setSettingsOpenProfileRequest({
			profileId: profile.id,
			tab,
			nonce: Date.now(),
		});
		setSettingsOpen(true);
		setMenuOpen(false);
		setContextMenu(null);
	}, []);

	const openSftpPanel = useCallback(
		(sessionId: string) => {
			setSftpPanelOpenBySession((prev) => ({ ...prev, [sessionId]: true }));
			revealTerminalToolbar();
		},
		[revealTerminalToolbar]
	);

	const closeSftpPanel = useCallback((sessionId: string) => {
		setSftpPanelOpenBySession((prev) => {
			if (!prev[sessionId]) {
				return prev;
			}
			return { ...prev, [sessionId]: false };
		});
	}, []);

	const updateSftpPanelPath = useCallback((sessionId: string, nextPath: string) => {
		setSftpPanelPathBySession((prev) => ({ ...prev, [sessionId]: nextPath }));
	}, []);

	const reconnectSession = useCallback(
		async (sessionId: string) => {
			const profileId = resolvedSessionProfiles[sessionId]?.id;
			await closeSession(sessionId);
			await createSession(profileId);
			revealTerminalToolbar();
		},
		[closeSession, createSession, resolvedSessionProfiles, revealTerminalToolbar]
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

	const dismissAuthPrompt = useCallback(async () => {
		if (!authPromptModal || !shell) {
			setAuthPromptModal(null);
			return;
		}
		await shell.invoke('term:sessionClearPrompt', authPromptModal.sessionId).catch(() => {
			/* ignore */
		});
		setAuthPromptModal(null);
	}, [authPromptModal, shell]);

	const submitAuthPrompt = useCallback(
		async (value: string, remember: boolean) => {
			const promptState = authPromptModal;
			if (!promptState || !shell) {
				return;
			}
			if (!value.length) {
				return;
			}
			const result = (await shell
				.invoke('term:sessionRespondToPrompt', promptState.sessionId, `${value}\r`)
				.catch(() => ({ ok: false }))) as { ok?: boolean };
			if (result.ok && promptState.profileId) {
				await shell.invoke('term:profilePasswordCacheSet', promptState.profileId, value).catch(() => {
					/* ignore */
				});
				if (remember && promptState.kind === 'password') {
					await shell.invoke('term:profilePasswordSet', promptState.profileId, value).catch(() => {
						/* ignore */
					});
				}
			}
			setAuthPromptModal(null);
		},
		[authPromptModal, shell]
	);

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
								{terminalSettings.profiles.length > 0 || displayBuiltinProfiles.length > 0 ? (
									<>
										<div className="ref-uterm-dropdown-sep" role="separator" />
										<div className="ref-uterm-dropdown-label">
											{t('app.universalTerminalMenu.newWithProfile')}
										</div>
										{[...terminalSettings.profiles, ...displayBuiltinProfiles].map((profile) => (
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

			<div className={`ref-uterm-stage ref-uterm-stage--settings ${settingsOpen ? '' : 'is-hidden'}`}>
				<TerminalSettingsPanel
					t={t}
					settings={terminalSettings}
					builtinProfiles={builtinProfiles}
					onChange={persistSettings}
					onLaunchProfile={(profileId) => void createSession(profileId)}
					openProfileRequest={settingsOpenProfileRequest}
				/>
			</div>

			<div
				className={`ref-uterm-stage ref-uterm-stage--terminal ${settingsOpen ? 'is-hidden' : ''}`}
				style={terminalStageStyle}
				aria-hidden={settingsOpen}
			>
					{sessions.length === 0 ? (
						<TerminalStartPage
							t={t}
							defaultActionMeta={startPageDefaultMeta}
							profiles={visibleStartPageProfiles}
							remainingProfileCount={Math.max(0, startPageProfiles.length - visibleStartPageProfiles.length)}
							onCreate={() => void createSession()}
							onOpenSettings={() => setSettingsOpen(true)}
							onLaunchProfile={(profileId) => void createSession(profileId)}
						/>
					) : (
						<>
							<div className="ref-uterm-panes">
								{sessions.map((session) => {
									const isActive = session.id === activeSession?.id;
									const exitCode = exitByTab[session.id];
									const sessionProfile = resolvedSessionProfiles[session.id] ?? null;
									const paneActive = !settingsOpen && isActive;
									const showSshToolbar = paneActive && sessionProfile?.kind === 'ssh';
									const sftpPanelOpen = Boolean(sftpPanelOpenBySession[session.id]);
									const renderSftpPanel = sessionProfile?.kind === 'ssh' && sftpPanelOpen;
									return (
										<div
											key={session.id}
											className={`ref-uterm-pane ${paneActive ? 'is-active' : ''}`}
											aria-hidden={!paneActive}
											onMouseEnter={showSshToolbar ? revealTerminalToolbar : undefined}
											onMouseLeave={showSshToolbar ? hideTerminalToolbar : undefined}
										>
											{showSshToolbar ? (
												<TerminalSessionToolbar
													t={t}
													session={session}
													profile={sessionProfile}
													visible={toolbarPinned || toolbarRevealed}
													pinned={toolbarPinned}
													onPinToggle={toggleTerminalToolbarPinned}
													onReconnect={() => void reconnectSession(session.id)}
													onOpenSftp={() => openSftpPanel(session.id)}
													onOpenPorts={() => openProfileSettingsFromToolbar(sessionProfile, 'ports')}
													onMouseEnter={revealTerminalToolbar}
													onMouseLeave={hideTerminalToolbar}
												/>
											) : null}
											<MemoTerminalTabView
												sessionId={session.id}
												active={!settingsOpen && isActive}
												shell={shell}
												theme={getProfileThemeColors(sessionProfile, themeColors)}
												appSettings={terminalSettings}
												profile={sessionProfile}
												t={t}
												onRequestContextMenu={handleRequestContextMenu}
												onAuthPrompt={openAuthPrompt}
												registerRuntime={registerRuntime}
												onExit={(code) => handleExit(session.id, code)}
											/>
											{renderSftpPanel ? (
												<TerminalSftpPanel
													t={t}
													shell={shell}
													profile={sessionProfile}
													visible={sftpPanelOpen}
													path={sftpPanelPathBySession[session.id]}
													onPathChange={(nextPath) => updateSftpPanelPath(session.id, nextPath)}
													onClose={() => closeSftpPanel(session.id)}
												/>
											) : null}
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
							{contextMenu ? (
								<div className="ref-uterm-dropdown ref-uterm-context-menu" role="menu" style={contextMenuStyle}>
									<button
										type="button"
										role="menuitem"
										className="ref-uterm-dropdown-item"
										disabled={!contextRuntime?.hasSelection()}
										onClick={() => void onContextCopy()}
									>
										{t('app.edit.copy')}
									</button>
									<button
										type="button"
										role="menuitem"
										className="ref-uterm-dropdown-item"
										onClick={() => void onContextPaste()}
									>
										{t('app.edit.paste')}
									</button>
									<div className="ref-uterm-dropdown-sep" role="separator" />
									<button type="button" role="menuitem" className="ref-uterm-dropdown-item" onClick={onContextSelectAll}>
										{t('app.edit.selectAll')}
									</button>
								</div>
							) : null}
						</>
					)}
			</div>
			{authPromptModal ? (
				<TerminalAuthPromptModal
					t={t}
					kind={authPromptModal.kind}
					prompt={authPromptModal.prompt}
					sessionTitle={authPromptModal.sessionTitle}
					profileName={authPromptModal.profileName}
					onCancel={() => void dismissAuthPrompt()}
					onSubmit={(value, remember) => void submitAuthPrompt(value, remember)}
				/>
			) : null}
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

function TerminalSessionToolbar({
	t,
	session,
	profile,
	visible,
	pinned,
	onPinToggle,
	onReconnect,
	onOpenSftp,
	onOpenPorts,
	onMouseEnter,
	onMouseLeave,
}: {
	t: TFunction;
	session: SessionInfo;
	profile: TerminalProfile | null;
	visible: boolean;
	pinned: boolean;
	onPinToggle(): void;
	onReconnect(): void;
	onOpenSftp(): void;
	onOpenPorts(): void;
	onMouseEnter(): void;
	onMouseLeave(): void;
}) {
	const target = formatTerminalToolbarTarget(profile);

	return (
		<div
			className={`ref-uterm-toolbar-wrap ${visible ? 'is-visible' : ''}`}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
		>
			<div className="ref-uterm-toolbar">
				<div className="ref-uterm-toolbar-main">
					<span className={`ref-uterm-toolbar-status ${session.alive ? 'is-live' : 'is-dead'}`} aria-hidden="true" />
					<strong className="ref-uterm-toolbar-target">{target}</strong>
				</div>

				<div className="ref-uterm-toolbar-actions">
					<button type="button" className="ref-uterm-toolbar-btn" onClick={onReconnect}>
						<IconRefresh className="ref-uterm-toolbar-btn-icon" />
						<span>{t('app.universalTerminalToolbarReconnect')}</span>
					</button>
					{session.alive ? (
						<button type="button" className="ref-uterm-toolbar-btn" onClick={onOpenSftp}>
							<IconFolderOpen className="ref-uterm-toolbar-btn-icon" />
							<span>{t('app.universalTerminalToolbarSftp')}</span>
						</button>
					) : null}
					{session.alive ? (
						<button type="button" className="ref-uterm-toolbar-btn" onClick={onOpenPorts}>
							<IconPlug className="ref-uterm-toolbar-btn-icon" />
							<span>{t('app.universalTerminalToolbarPorts')}</span>
						</button>
					) : null}
					<button type="button" className="ref-uterm-toolbar-btn" onClick={onPinToggle}>
						<IconPin className="ref-uterm-toolbar-btn-icon" />
						<span>{pinned ? t('app.universalTerminalToolbarUnpin') : t('app.universalTerminalToolbarPin')}</span>
					</button>
				</div>
			</div>
		</div>
	);
}

function loadTerminalTabSnapshot(): RestorableTerminalTab[] {
	if (typeof window === 'undefined') {
		return [];
	}
	try {
		const raw = window.localStorage.getItem(TERMINAL_TAB_SNAPSHOT_KEY);
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter(
			(item): item is RestorableTerminalTab =>
				Boolean(item) && typeof item === 'object' && typeof (item as RestorableTerminalTab).profileId === 'string'
		);
	} catch {
		return [];
	}
}

function saveTerminalTabSnapshot(tabs: RestorableTerminalTab[]): void {
	if (typeof window === 'undefined') {
		return;
	}
	try {
		if (tabs.length === 0) {
			window.localStorage.removeItem(TERMINAL_TAB_SNAPSHOT_KEY);
			return;
		}
		window.localStorage.setItem(TERMINAL_TAB_SNAPSHOT_KEY, JSON.stringify(tabs));
	} catch {
		/* ignore */
	}
}

function loadTerminalToolbarPinned(): boolean {
	if (typeof window === 'undefined') {
		return true;
	}
	try {
		return window.localStorage.getItem(TERMINAL_TOOLBAR_PIN_STORAGE_KEY) !== 'false';
	} catch {
		return true;
	}
}

function saveTerminalToolbarPinned(pinned: boolean): void {
	if (typeof window === 'undefined') {
		return;
	}
	try {
		window.localStorage.setItem(TERMINAL_TOOLBAR_PIN_STORAGE_KEY, pinned ? 'true' : 'false');
	} catch {
		/* ignore */
	}
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

function getProfileThemeColors(profile: TerminalProfile | null, fallback: XTermThemeColors): XTermThemeColors {
	const scheme = getTerminalColorSchemeById(profile?.terminalColorSchemeId);
	if (!scheme) {
		return fallback;
	}
	return {
		background: scheme.background,
		foreground: scheme.foreground,
		cursor: scheme.cursor,
		selectionBackground: `${scheme.selection ?? scheme.cursor}55`,
		black: scheme.colors[0] ?? scheme.background,
		brightBlack: scheme.colors[8] ?? scheme.colors[0] ?? fallback.brightBlack,
	};
}

function applyInputBackspaceMode(data: string, mode: TerminalInputBackspaceMode | undefined): string {
	if (data !== '\x7f') {
		return data;
	}
	switch (mode) {
		case 'ctrl-h':
			return '\x08';
		case 'ctrl-?':
			return '\x7f';
		case 'delete':
			return '\x1b[3~';
		case 'backspace':
		default:
			return '\x7f';
	}
}

async function maybeRunLoginScripts(
	shell: ShellBridge,
	sessionId: string,
	chunk: string,
	scripts: Array<{ expect: string; send: string; isRegex?: boolean; optional?: boolean }>
): Promise<void> {
	if (!scripts.length) {
		return;
	}
	for (let index = 0; index < scripts.length; index += 1) {
		const script = scripts[index];
		if (!script) {
			continue;
		}
		const expect = script.expect || '';
		let matched = false;
		if (!expect) {
			matched = true;
		} else if (script.isRegex) {
			try {
				matched = new RegExp(expect, 'g').test(chunk);
			} catch {
				matched = false;
			}
		} else {
			matched = chunk.includes(expect);
		}
		if (matched) {
			scripts.splice(index, 1);
			await shell.invoke('term:sessionWrite', sessionId, `${script.send}\r`);
			return;
		}
		if (script.optional) {
			scripts.splice(index, 1);
			index -= 1;
			continue;
		}
		return;
	}
}

function formatTerminalToolbarTarget(profile: TerminalProfile | null): string {
	if (!profile || profile.kind !== 'ssh') {
		return '';
	}
	const user = profile.sshUser.trim();
	const host = profile.sshHost.trim();
	const port = profile.sshPort > 0 ? profile.sshPort : 22;
	return `${user}@${host}:${port}`;
}

function describeTerminalProfileTarget(
	profile: Pick<TerminalAppSettings['profiles'][number], 'kind' | 'shell' | 'sshUser' | 'sshHost' | 'sshPort'>,
	t: TFunction
): string {
	return buildTerminalProfileTarget(profile as TerminalAppSettings['profiles'][number]) || t('app.universalTerminalSettings.systemDefaultShell');
}

function withTerminalWindowProfileLabel(profile: TerminalAppSettings['profiles'][number], t: TFunction) {
	if (!profile.builtinKey) {
		return profile;
	}
	return {
		...profile,
		name: t(`app.universalTerminalSettings.builtin.${profile.builtinKey}`),
	};
}
