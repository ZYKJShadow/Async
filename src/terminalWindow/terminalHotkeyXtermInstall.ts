import type { Terminal } from '@xterm/xterm';
import { TerminalHotkeyMatcher } from './terminalHotkeyMatcher';

export function installXtermHotkeyRouting(
	term: Terminal,
	getHotkeysBranch: () => Record<string, unknown>,
	onHotkey: (id: string) => void
): () => void {
	const matcher = new TerminalHotkeyMatcher(getHotkeysBranch, onHotkey);

	const keyboardEventHandler = (name: string, event: KeyboardEvent): boolean => {
		if (term.buffer.active.type === 'alternate') {
			let modifiers = 0;
			modifiers += event.ctrlKey ? 1 : 0;
			modifiers += event.altKey ? 1 : 0;
			modifiers += event.shiftKey ? 1 : 0;
			modifiers += event.metaKey ? 1 : 0;
			if (event.key.startsWith('Arrow') && modifiers === 1) {
				return true;
			}
		}

		matcher.pushKeyEvent(name, event);

		let ret = true;
		if (matcher.matchActiveHotkey(true) !== null) {
			event.stopPropagation();
			event.preventDefault();
			ret = false;
		}
		return ret;
	};

	term.attachCustomKeyEventHandler((event) => {
		if (event.getModifierState('Meta') && event.key.startsWith('Arrow')) {
			return false;
		}
		return keyboardEventHandler('keydown', event);
	});

	const xtermCore = (term as unknown as { _core: { _keyUp: (e: KeyboardEvent) => void; updateCursorStyle: (e: KeyboardEvent) => void } })._core;
	const oldKeyUp = xtermCore._keyUp.bind(xtermCore);
	xtermCore._keyUp = (e: KeyboardEvent) => {
		xtermCore.updateCursorStyle(e);
		if (keyboardEventHandler('keyup', e)) {
			oldKeyUp(e);
		}
	};

	return () => {
		xtermCore._keyUp = oldKeyUp;
	};
}
