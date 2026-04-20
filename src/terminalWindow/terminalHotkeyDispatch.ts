import type { Terminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import { readHotkeyPlatform } from './terminalHotkeyPlatform';

export type TerminalHotkeyDispatchContext = {
	term: Terminal;
	write: (data: string) => void | Promise<void>;
	copySelection: () => Promise<boolean>;
	pasteFromClipboard: () => Promise<boolean>;
	selectAll: () => void;
	clear: () => void;
	getCwd: () => string;
	writeClipboardText: (text: string) => Promise<void>;
	showCopiedNotice?: () => void;
	zoom: {
		levelRef: { current: number };
		applyFontSize: () => void;
	};
	search: {
		addon: SearchAddon;
		open: () => void;
	};
	onReconnect?: () => void;
	onDisconnect?: () => void;
};

export async function dispatchTerminalHotkey(id: string, ctx: TerminalHotkeyDispatchContext): Promise<void> {
	const platform = readHotkeyPlatform();
	const isWindows = platform === 'win32';

	switch (id) {
		case 'ctrl-c': {
			if (ctx.term.getSelection()) {
				const ok = await ctx.copySelection();
				ctx.term.clearSelection();
				if (ok) {
					ctx.showCopiedNotice?.();
				}
			} else {
				await ctx.write('\x03');
			}
			break;
		}
		case 'copy': {
			const ok = await ctx.copySelection();
			ctx.term.clearSelection();
			if (ok) {
				ctx.showCopiedNotice?.();
			}
			break;
		}
		case 'paste': {
			await ctx.pasteFromClipboard();
			break;
		}
		case 'select-all': {
			ctx.selectAll();
			break;
		}
		case 'clear': {
			ctx.clear();
			break;
		}
		case 'zoom-in': {
			ctx.zoom.levelRef.current += 1;
			ctx.zoom.applyFontSize();
			break;
		}
		case 'zoom-out': {
			ctx.zoom.levelRef.current -= 1;
			ctx.zoom.applyFontSize();
			break;
		}
		case 'reset-zoom': {
			ctx.zoom.levelRef.current = 0;
			ctx.zoom.applyFontSize();
			break;
		}
		case 'previous-word': {
			const seq = isWindows ? '\x1b[1;5D' : '\x1bb';
			await ctx.write(seq);
			break;
		}
		case 'next-word': {
			const seq = isWindows ? '\x1b[1;5C' : '\x1bf';
			await ctx.write(seq);
			break;
		}
		case 'delete-line': {
			await ctx.write('\x1bw');
			break;
		}
		case 'delete-previous-word': {
			await ctx.write('\u0017');
			break;
		}
		case 'delete-next-word': {
			const seq = isWindows ? '\x1bd\x1b[3;5~' : '\x1bd';
			await ctx.write(seq);
			break;
		}
		case 'copy-current-path': {
			const cwd = ctx.getCwd().trim();
			if (cwd) {
				await ctx.writeClipboardText(cwd);
				ctx.showCopiedNotice?.();
			}
			break;
		}
		case 'search': {
			ctx.search.open();
			break;
		}
		case 'home': {
			await ctx.write('\x01');
			break;
		}
		case 'end': {
			await ctx.write('\x05');
			break;
		}
		case 'scroll-to-top': {
			ctx.term.scrollToTop();
			break;
		}
		case 'scroll-page-up': {
			ctx.term.scrollPages(-1);
			break;
		}
		case 'scroll-up': {
			ctx.term.scrollLines(-1);
			break;
		}
		case 'scroll-down': {
			ctx.term.scrollLines(1);
			break;
		}
		case 'scroll-page-down': {
			ctx.term.scrollPages(1);
			break;
		}
		case 'scroll-to-bottom': {
			ctx.term.scrollToBottom();
			break;
		}
		case 'pane-focus-all':
		case 'focus-all-tabs':
			break;
		case 'reconnect-tab': {
			ctx.onReconnect?.();
			break;
		}
		case 'disconnect-tab': {
			ctx.onDisconnect?.();
			break;
		}
		default:
			break;
	}
}
