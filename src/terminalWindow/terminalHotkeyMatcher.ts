import { altKeyNameForPlatform, metaKeyNameForPlatform, readHotkeyPlatform } from './terminalHotkeyPlatform';
import type { KeyEventData, KeyName, Keystroke } from './terminalHotkeyUtil';
import { getKeyName, getKeystrokeName } from './terminalHotkeyUtil';

type PastKeystroke = {
	keystroke: Keystroke;
	time: number;
};

export class TerminalHotkeyMatcher {
	private readonly metaKeyName: string;
	private readonly altKeyName: string;
	private disabledLevel = 0;
	private pressedKeys = new Set<KeyName>();
	private pressedKeyTimestamps = new Map<KeyName, number>();
	private pressedHotkey: string | null = null;
	private pressedKeystroke: Keystroke | null = null;
	private lastKeystrokes: PastKeystroke[] = [];
	private recognitionPhase = true;
	private lastEventTimestamp = 0;

	constructor(
		private readonly getHotkeysBranch: () => Record<string, unknown>,
		private readonly onHotkey: (id: string) => void,
		private readonly onKeystroke?: (stroke: string) => void
	) {
		const platform = readHotkeyPlatform();
		this.metaKeyName = metaKeyNameForPlatform(platform);
		this.altKeyName = altKeyNameForPlatform(platform);
	}

	enable(): void {
		this.disabledLevel--;
	}

	disable(): void {
		this.disabledLevel++;
	}

	isEnabled(): boolean {
		return this.disabledLevel === 0;
	}

	pushKeyEvent(eventName: string, nativeEvent: KeyboardEvent): void {
		if (nativeEvent.timeStamp === this.lastEventTimestamp) {
			return;
		}

		const eventData: KeyEventData = {
			ctrlKey: nativeEvent.ctrlKey,
			metaKey: nativeEvent.metaKey,
			altKey: nativeEvent.altKey,
			shiftKey: nativeEvent.shiftKey,
			code: nativeEvent.code,
			key: nativeEvent.key,
			eventName,
			time: nativeEvent.timeStamp,
			registrationTime: typeof performance !== 'undefined' ? performance.now() : nativeEvent.timeStamp,
		};

		for (const [key, time] of this.pressedKeyTimestamps.entries()) {
			if (typeof performance !== 'undefined' && time < performance.now() - 2000) {
				this.removePressedKey(key);
			}
		}

		const keyName = getKeyName(eventData, this.metaKeyName, this.altKeyName);
		if (eventName === 'keydown') {
			this.addPressedKey(keyName, eventData);
			this.recognitionPhase = true;
			this.updateModifiers(eventData);
		}
		if (eventName === 'keyup') {
			const keystroke = getKeystrokeName([...this.pressedKeys], this.metaKeyName, this.altKeyName);
			if (this.recognitionPhase) {
				this.lastKeystrokes.push({
					keystroke,
					time: typeof performance !== 'undefined' ? performance.now() : nativeEvent.timeStamp,
				});
				if (this.onKeystroke && !isModifierOnlyKeystroke(keystroke, this.metaKeyName, this.altKeyName)) {
					this.onKeystroke(keystroke);
				}
				this.recognitionPhase = false;
			}
			this.pressedKeys.clear();
			this.pressedKeyTimestamps.clear();
			this.removePressedKey(keyName);
		}

		if (this.pressedKeys.size) {
			this.pressedKeystroke = getKeystrokeName([...this.pressedKeys], this.metaKeyName, this.altKeyName);
		} else {
			this.pressedKeystroke = null;
		}

		const matched = this.matchActiveHotkey();
		if (matched) {
			if (this.recognitionPhase) {
				this.emitHotkeyOn(matched);
			}
		} else if (this.pressedHotkey) {
			this.emitHotkeyOff(this.pressedHotkey);
		}

		if (readHotkeyPlatform() === 'darwin' && eventData.metaKey && eventName === 'keydown') {
			const skipInject = ['Ctrl', 'Shift', this.altKeyName, this.metaKeyName, 'Enter'].includes(keyName);
			if (!skipInject) {
				this.pushKeyEvent('keyup', nativeEvent);
			}
		}

		this.lastEventTimestamp = nativeEvent.timeStamp;
	}

	matchActiveHotkey(partial = false): string | null {
		if (!this.isEnabled() || !this.pressedKeystroke) {
			return null;
		}
		const matches: { id: string; sequence: string[] }[] = [];

		const currentSequence = this.getCurrentKeystrokes();
		const config = getHotkeysConfigRecursiveStatic(this.getHotkeysBranch());
		for (const id in config) {
			for (const sequence of config[id]) {
				if (currentSequence.length < sequence.length) {
					continue;
				}
				if (sequence[sequence.length - 1]?.toLowerCase() !== this.pressedKeystroke.toLowerCase()) {
					continue;
				}

				let lastIndex = 0;
				let matched = true;
				for (const item of sequence) {
					const nextOffset = currentSequence.slice(lastIndex).findIndex((x) => x.toLowerCase() === item.toLowerCase());
					if (nextOffset === -1) {
						matched = false;
						break;
					}
					lastIndex += nextOffset;
				}

				if (partial ? lastIndex > 0 : matched) {
					matches.push({ id, sequence });
				}
			}
		}

		matches.sort((a, b) => b.sequence.length - a.sequence.length);
		if (!matches.length) {
			return null;
		}
		if (matches[0].sequence.length > 1) {
			this.clearCurrentKeystrokes();
		}
		return matches[0].id;
	}

	clearCurrentKeystrokes(): void {
		this.lastKeystrokes = [];
		this.pressedKeys.clear();
		this.pressedKeyTimestamps.clear();
		this.pressedKeystroke = null;
		this.pressedHotkey = null;
	}

	private getCurrentKeystrokes(): Keystroke[] {
		if (!this.pressedKeystroke) {
			return [];
		}
		return [...this.lastKeystrokes.map((x) => x.keystroke), this.pressedKeystroke];
	}

	private updateModifiers(event: KeyEventData): void {
		for (const [prop, key] of Object.entries({
			ctrlKey: 'Ctrl',
			metaKey: this.metaKeyName,
			altKey: this.altKeyName,
			shiftKey: 'Shift',
		})) {
			const flag = (event as unknown as Record<string, boolean>)[prop];
			if (!flag && this.pressedKeys.has(key)) {
				this.removePressedKey(key);
			}
			if (flag && !this.pressedKeys.has(key)) {
				this.addPressedKey(key, event);
			}
		}
	}

	private addPressedKey(keyName: KeyName, eventData: KeyEventData): void {
		this.pressedKeys.add(keyName);
		this.pressedKeyTimestamps.set(keyName, eventData.registrationTime);
	}

	private removePressedKey(key: KeyName): void {
		this.pressedKeys.delete(key);
		this.pressedKeyTimestamps.delete(key);
	}

	private emitHotkeyOn(hotkey: string): void {
		if (this.pressedHotkey) {
			if (this.pressedHotkey !== hotkey) {
				this.emitHotkeyOff(this.pressedHotkey);
			}
		}
		this.onHotkey(hotkey);
		this.pressedHotkey = hotkey;
		this.recognitionPhase = false;
	}

	private emitHotkeyOff(hotkey: string): void {
		void hotkey;
		this.pressedHotkey = null;
	}
}

function isModifierOnlyKeystroke(stroke: string, metaName: string, altName: string): boolean {
	if (!stroke) {
		return true;
	}
	const mods = new Set<string>(['Ctrl', 'Shift', metaName, altName]);
	return stroke.split('-').every((part) => mods.has(part));
}

export function getHotkeysConfigRecursiveStatic(branch: Record<string, unknown>): Record<string, string[][]> {
	const keys: Record<string, string[][]> = {};
	for (const key of Object.keys(branch)) {
		let value: unknown = branch[key];
		if (value instanceof Object && !(value instanceof Array)) {
			const subkeys = getHotkeysConfigRecursiveStatic(value as Record<string, unknown>);
			for (const subkey of Object.keys(subkeys)) {
				keys[`${key}.${subkey}`] = subkeys[subkey];
			}
		} else {
			if (typeof value === 'string') {
				value = [value];
			}
			if (!(value instanceof Array)) {
				continue;
			}
			if (value.length > 0) {
				const mapped = (value as Array<string | string[]>).map((item) =>
					typeof item === 'string' ? [item] : item
				) as string[][];
				keys[key] = mapped;
			}
		}
	}
	return keys;
}
