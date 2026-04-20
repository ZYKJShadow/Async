import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useI18n } from './i18n';
import { dispatchTerminalHotkey } from './terminalWindow/terminalHotkeyDispatch';
import { installXtermHotkeyRouting } from './terminalWindow/terminalHotkeyXtermInstall';
import { showTerminalCopiedNotice } from './terminalWindow/terminalNoticeToast';
import {
	loadTerminalSettings,
	mergeResolvedTerminalHotkeysMap,
	subscribeTerminalSettings,
	type TerminalAppSettings,
} from './terminalWindow/terminalSettings';
import {
	isTerminalAlternateScreen,
	prepareTerminalPasteText,
} from './terminalWindow/terminalRuntime';

type XTermThemeColors = {
	background: string;
	foreground: string;
	cursor: string;
	selectionBackground: string;
	black: string;
	brightBlack: string;
};

export type PtyTerminalViewProps = {
	sessionId: string;
	/** 多标签时仅当前标签参与 fit / pty resize */
	active: boolean;
	compactChrome?: boolean;
	/** shell 退出时（pty 已由主进程关闭） */
	onSessionExit?: () => void;
};

/**
 * 与主进程 node-pty 会话绑定的 xterm；输入直接进伪终端（VS Code 式交互 shell）。
 * 快捷键由 terminalSettings.hotkeys 配置。
 */
export function PtyTerminalView({ sessionId, active, compactChrome, onSessionExit }: PtyTerminalViewProps) {
	const { t } = useI18n();
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<XTerm | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const activeRef = useRef(active);
	const onExitRef = useRef(onSessionExit);
	const settingsRef = useRef<TerminalAppSettings>(loadTerminalSettings());
	const zoomLevelRef = useRef(0);
	const searchAddonRef = useRef<SearchAddon | null>(null);
	const findInputRef = useRef<HTMLInputElement | null>(null);
	const [settings, setSettings] = useState<TerminalAppSettings>(() => loadTerminalSettings());
	const [themeColors, setThemeColors] = useState<XTermThemeColors>(() => readPtyThemeColors());
	const [searchUi, setSearchUi] = useState<{ open: boolean; query: string }>({ open: false, query: '' });
	activeRef.current = active;
	onExitRef.current = onSessionExit;
	settingsRef.current = settings;

	useEffect(() => {
		return subscribeTerminalSettings(() => {
			setSettings(loadTerminalSettings());
		});
	}, []);

	useEffect(() => {
		const observer = new MutationObserver(() => {
			setThemeColors(readPtyThemeColors());
		});
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-scheme'] });
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const shell = window.asyncShell;
		const el = containerRef.current;
		if (!shell?.subscribeTerminalPtyData || !el) {
			return;
		}
		const current = settingsRef.current;
		const term = new XTerm({
			theme: {
				background: themeColors.background,
				foreground: themeColors.foreground,
				cursor: themeColors.cursor,
				cursorAccent: themeColors.background,
				selectionBackground: themeColors.selectionBackground,
				black: themeColors.black,
				brightBlack: themeColors.brightBlack,
			},
			fontSize: current.fontSize,
			fontFamily: current.fontFamily,
			fontWeight: current.fontWeight,
			fontWeightBold: current.fontWeightBold,
			lineHeight: current.lineHeight,
			cursorBlink: current.cursorBlink,
			cursorStyle: current.cursorStyle,
			scrollback: current.scrollback,
			minimumContrastRatio: current.minimumContrastRatio,
			drawBoldTextInBrightColors: current.drawBoldTextInBrightColors,
			scrollOnUserInput: current.scrollOnInput,
			wordSeparator: current.wordSeparator,
			ignoreBracketedPasteMode: !current.bracketedPaste,
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
				settingsRef.current,
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

		const propagateResize = () => {
			if (!activeRef.current || !fitRef.current || !containerRef.current) {
				return;
			}
			try {
				fitRef.current.fit();
				const dims = fitRef.current.proposeDimensions();
				if (dims) {
					void shell.invoke('terminal:ptyResize', sessionId, dims.cols, dims.rows);
				}
			} catch {
				/* ignore */
			}
		};

		const applyZoomFontSize = () => {
			const base = settingsRef.current.fontSize;
			const scale = Math.pow(1.1, zoomLevelRef.current);
			term.options.fontSize = base * scale;
			try {
				term.refresh(0, term.rows - 1);
			} catch {
				/* ignore */
			}
			propagateResize();
		};

		const searchAddon = new SearchAddon({ highlightLimit: 500 });
		term.loadAddon(searchAddon);
		searchAddonRef.current = searchAddon;

		const disposeHotkeys = installXtermHotkeyRouting(
			term,
			() => mergeResolvedTerminalHotkeysMap(settingsRef.current),
			(hotkeyId) => {
				void dispatchTerminalHotkey(hotkeyId, {
					term,
					write: async (data) => {
						await shell.invoke('terminal:ptyWrite', sessionId, data);
					},
					copySelection,
					pasteFromClipboard,
					selectAll: () => term.selectAll(),
					clear: () => term.clear(),
					getCwd: () => '',
					writeClipboardText: async (text) => {
						await shell.invoke('clipboard:writeText', text);
					},
					showCopiedNotice: () => showTerminalCopiedNotice(t('app.universalTerminalToast.copied')),
					zoom: {
						levelRef: zoomLevelRef,
						applyFontSize: () => applyZoomFontSize(),
					},
					search: {
						addon: searchAddon,
						open: () => {
							const selected = term.getSelection().trim();
							setSearchUi({ open: true, query: selected });
						},
					},
				});
			}
		);

		const unsubData = shell.subscribeTerminalPtyData((id, data) => {
			if (id === sessionId) {
				term.write(data);
			}
		});
		const unsubExit =
			shell.subscribeTerminalPtyExit?.((id) => {
				if (id === sessionId) {
					onExitRef.current?.();
				}
			}) ?? (() => {});

		const onDataDisposer = term.onData((data) => {
			void shell.invoke('terminal:ptyWrite', sessionId, data);
		});

		const selectionDisposer = term.onSelectionChange(() => {
			if (!settingsRef.current.copyOnSelect || !term.hasSelection()) {
				return;
			}
			const selected = term.getSelection();
			if (selected) {
				void shell.invoke('clipboard:writeText', selected).catch(() => {
					/* ignore */
				});
			}
		});

		const bellDisposer = term.onBell(() => {
			if (settingsRef.current.bell !== 'visual') {
				return;
			}
			el.classList.add('pty-term-root--bell');
			window.setTimeout(() => el.classList.remove('pty-term-root--bell'), 160);
		});

		const onContextMenu = (event: MouseEvent) => {
			const action = settingsRef.current.rightClickAction;
			if (action === 'off') {
				return;
			}
			event.preventDefault();
			if (action === 'clipboard' && term.hasSelection()) {
				const selected = term.getSelection();
				if (selected) {
					void shell.invoke('clipboard:writeText', selected).catch(() => {
						/* ignore */
					});
				}
				return;
			}
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

		const ro = new ResizeObserver(() => {
			propagateResize();
		});
		ro.observe(el);

		return () => {
			disposeHotkeys();
			searchAddonRef.current = null;
			ro.disconnect();
			onDataDisposer.dispose();
			selectionDisposer.dispose();
			bellDisposer.dispose();
			el.removeEventListener('contextmenu', onContextMenu);
			unsubData();
			unsubExit();
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
		};
	}, [sessionId, t, themeColors]);

	useEffect(() => {
		zoomLevelRef.current = 0;
	}, [settings.fontSize]);

	useEffect(() => {
		const term = termRef.current;
		if (!term) {
			return;
		}
		term.options.fontSize = settings.fontSize * Math.pow(1.1, zoomLevelRef.current);
		term.options.fontFamily = settings.fontFamily;
		term.options.fontWeight = settings.fontWeight;
		term.options.fontWeightBold = settings.fontWeightBold;
		term.options.lineHeight = settings.lineHeight;
		term.options.cursorBlink = settings.cursorBlink;
		term.options.cursorStyle = settings.cursorStyle;
		term.options.scrollback = settings.scrollback;
		term.options.minimumContrastRatio = settings.minimumContrastRatio;
		term.options.drawBoldTextInBrightColors = settings.drawBoldTextInBrightColors;
		term.options.scrollOnUserInput = settings.scrollOnInput;
		term.options.wordSeparator = settings.wordSeparator;
		term.options.ignoreBracketedPasteMode = !settings.bracketedPaste;
		try {
			term.refresh(0, term.rows - 1);
		} catch {
			/* ignore */
		}
	}, [settings]);

	useEffect(() => {
		const term = termRef.current;
		if (!term) {
			return;
		}
		term.options.theme = {
			background: themeColors.background,
			foreground: themeColors.foreground,
			cursor: themeColors.cursor,
			cursorAccent: themeColors.background,
			selectionBackground: themeColors.selectionBackground,
			black: themeColors.black,
			brightBlack: themeColors.brightBlack,
		};
		try {
			term.refresh(0, term.rows - 1);
		} catch {
			/* ignore */
		}
	}, [themeColors]);

	useEffect(() => {
		if (!active) {
			return;
		}
		const term = termRef.current;
		const fit = fitRef.current;
		const shell = window.asyncShell;
		if (!term || !fit || !shell) {
			return;
		}
		const id = requestAnimationFrame(() => {
			try {
				fit.fit();
				const dims = fit.proposeDimensions();
				if (dims) {
					void shell.invoke('terminal:ptyResize', sessionId, dims.cols, dims.rows);
				}
			} catch {
				/* ignore */
			}
		});
		return () => cancelAnimationFrame(id);
	}, [active, sessionId]);

	useEffect(() => {
		if (!searchUi.open || !active) {
			return;
		}
		const term = termRef.current;
		const addon = searchAddonRef.current;
		if (!term || !addon) {
			return;
		}
		const id = requestAnimationFrame(() => {
			findInputRef.current?.focus();
			findInputRef.current?.select();
			const q = searchUi.query;
			if (q) {
				addon.findNext(q, {
					caseSensitive: false,
					decorations: {
						matchOverviewRuler: '#888888',
						activeMatchColorOverviewRuler: '#ffff00',
						matchBackground: '#888888',
						activeMatchBackground: '#ffff00',
					},
				});
			}
		});
		return () => cancelAnimationFrame(id);
	}, [searchUi.open, searchUi.query, active]);

	const closeFind = useCallback(() => {
		searchAddonRef.current?.clearDecorations();
		setSearchUi({ open: false, query: '' });
		termRef.current?.focus();
	}, []);

	const onFindNext = useCallback(() => {
		const addon = searchAddonRef.current;
		if (!addon) {
			return;
		}
		const q = findInputRef.current?.value ?? searchUi.query;
		addon.findNext(q, {
			caseSensitive: false,
			decorations: {
				matchOverviewRuler: '#888888',
				activeMatchColorOverviewRuler: '#ffff00',
				matchBackground: '#888888',
				activeMatchBackground: '#ffff00',
			},
		});
	}, [searchUi.query]);

	const onFindPrevious = useCallback(() => {
		const addon = searchAddonRef.current;
		if (!addon) {
			return;
		}
		const q = findInputRef.current?.value ?? searchUi.query;
		addon.findPrevious(q, {
			caseSensitive: false,
			decorations: {
				matchOverviewRuler: '#888888',
				activeMatchColorOverviewRuler: '#ffff00',
				matchBackground: '#888888',
				activeMatchBackground: '#ffff00',
			},
		});
	}, [searchUi.query]);

	return (
		<div className={`pty-term-root${compactChrome ? ' pty-term-root--embedded' : ''}`}>
			<div className="ref-uterm-tab-term-wrap">
				{searchUi.open && active ? (
					<div className="ref-uterm-findbar" role="search">
						<input
							ref={findInputRef}
							className="ref-uterm-findbar-input"
							type="search"
							value={searchUi.query}
							placeholder={t('app.universalTerminalFind.placeholder')}
							aria-label={t('app.universalTerminalFind.placeholder')}
							onChange={(event) => setSearchUi((prev) => ({ ...prev, query: event.target.value }))}
							onKeyDown={(event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									if (event.shiftKey) {
										onFindPrevious();
									} else {
										onFindNext();
									}
								}
								if (event.key === 'Escape') {
									event.preventDefault();
									closeFind();
								}
							}}
						/>
						<button type="button" className="ref-uterm-findbar-btn" onClick={onFindPrevious}>
							{t('app.universalTerminalFind.prev')}
						</button>
						<button type="button" className="ref-uterm-findbar-btn" onClick={onFindNext}>
							{t('app.universalTerminalFind.next')}
						</button>
						<button type="button" className="ref-uterm-findbar-btn ref-uterm-findbar-btn--close" onClick={closeFind}>
							{t('app.universalTerminalFind.close')}
						</button>
					</div>
				) : null}
				<div ref={containerRef} className="xterm-viewport" />
			</div>
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

function readPtyThemeColors(): XTermThemeColors {
	const background = readCssVar('--void-bg-0', '#11171c');
	const foreground = readCssVar('--void-fg-0', '#f3f7f8');
	const cursor = readCssVar('--void-ring', '#37d6d4');
	return {
		background,
		foreground,
		cursor,
		selectionBackground: withAlpha(cursor, 0.33),
		black: background,
		brightBlack: readCssVar('--void-fg-3', '#657582'),
	};
}

function withAlpha(color: string, alpha: number): string {
	const hex = color.trim();
	if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
		return `${hex}${Math.round(alpha * 255)
			.toString(16)
			.padStart(2, '0')}`;
	}
	return `rgba(55, 214, 212, ${alpha})`;
}
