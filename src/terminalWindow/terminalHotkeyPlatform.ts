import type { TerminalRuntimePlatform } from './terminalSettings';

export function readHotkeyPlatform(): TerminalRuntimePlatform {
	if (typeof document !== 'undefined') {
		const platform = document.documentElement.getAttribute('data-platform');
		if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
			return platform;
		}
	}
	if (typeof navigator !== 'undefined') {
		const raw = `${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
		if (raw.includes('mac')) {
			return 'darwin';
		}
		if (raw.includes('win')) {
			return 'win32';
		}
		if (raw.includes('linux')) {
			return 'linux';
		}
	}
	return 'unknown';
}

export function metaKeyNameForPlatform(platform: TerminalRuntimePlatform): string {
	return (
		{
			darwin: '⌘',
			win32: 'Win',
			linux: 'Super',
			unknown: 'Win',
		} as const
	)[platform === 'darwin' || platform === 'win32' || platform === 'linux' ? platform : 'unknown'];
}

export function altKeyNameForPlatform(platform: TerminalRuntimePlatform): string {
	return (
		{
			darwin: '⌥',
			win32: 'Alt',
			linux: 'Alt',
			unknown: 'Alt',
		} as const
	)[platform === 'darwin' || platform === 'win32' || platform === 'linux' ? platform : 'unknown'];
}
