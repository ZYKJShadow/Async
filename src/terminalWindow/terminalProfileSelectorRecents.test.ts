import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	clearRecentTerminalProfileIds,
	readRecentTerminalProfileIds,
	rememberTerminalProfileLaunch,
} from './terminalProfileSelectorRecents';

describe('terminalProfileSelectorRecents', () => {
	const store: Record<string, string> = {};

	beforeEach(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		const memory: Storage = {
			get length() {
				return Object.keys(store).length;
			},
			clear() {
				for (const key of Object.keys(store)) {
					delete store[key];
				}
			},
			getItem(key: string) {
				return Object.prototype.hasOwnProperty.call(store, key) ? store[key]! : null;
			},
			key(index: number) {
				return Object.keys(store)[index] ?? null;
			},
			removeItem(key: string) {
				delete store[key];
			},
			setItem(key: string, value: string) {
				store[key] = String(value);
			},
		};
		Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true });
	});

	afterEach(() => {
		clearRecentTerminalProfileIds();
	});

	it('remembers and reads profile ids in MRU order', () => {
		rememberTerminalProfileLaunch('a');
		rememberTerminalProfileLaunch('b');
		rememberTerminalProfileLaunch('a');
		expect(readRecentTerminalProfileIds()).toEqual(['a', 'b']);
	});

	it('clears stored ids', () => {
		rememberTerminalProfileLaunch('x');
		clearRecentTerminalProfileIds();
		expect(readRecentTerminalProfileIds()).toEqual([]);
	});
});
