import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
	loadTerminalSettings,
	subscribeTerminalSettings,
	type TerminalAppSettings,
} from './terminalWindow/terminalSettings';

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
 */
export function PtyTerminalView({ sessionId, active, compactChrome, onSessionExit }: PtyTerminalViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<XTerm | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const activeRef = useRef(active);
	const onExitRef = useRef(onSessionExit);
	const settingsRef = useRef<TerminalAppSettings>(loadTerminalSettings());
	const [settings, setSettings] = useState<TerminalAppSettings>(() => loadTerminalSettings());
	const [themeColors, setThemeColors] = useState<XTermThemeColors>(() => readPtyThemeColors());
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
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(el);
		termRef.current = term;
		fitRef.current = fit;

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

		const ro = new ResizeObserver(() => {
			if (!activeRef.current) {
				return;
			}
			fit.fit();
			const dims = fit.proposeDimensions();
			if (dims) {
				void shell.invoke('terminal:ptyResize', sessionId, dims.cols, dims.rows);
			}
		});
		ro.observe(el);

		return () => {
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
	}, [sessionId, themeColors]);

	useEffect(() => {
		const term = termRef.current;
		if (!term) {
			return;
		}
		term.options.fontSize = settings.fontSize;
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

	return (
		<div className={`pty-term-root${compactChrome ? ' pty-term-root--embedded' : ''}`}>
			<div ref={containerRef} className="xterm-viewport" />
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
