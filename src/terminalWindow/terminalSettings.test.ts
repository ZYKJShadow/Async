import { describe, expect, it } from 'vitest';
import {
	applyTerminalDisplayPreset,
	buildTerminalProfileLaunchPreview,
	cloneTerminalProfile,
	countTerminalProfileEnvEntries,
	defaultTerminalSettings,
	getBuiltinTerminalProfiles,
	normalizeTerminalSettings,
	resolveTerminalProfile,
} from './terminalSettings';

describe('terminalSettings', () => {
	it('migrates legacy right-click settings and clamps new numeric fields', () => {
		const settings = normalizeTerminalSettings({
			rightClickPaste: false,
			fontWeight: 937,
			fontWeightBold: 33,
			minimumContrastRatio: 30,
		});

		expect(settings.rightClickAction).toBe('off');
		expect(settings.fontWeight).toBe(900);
		expect(settings.fontWeightBold).toBe(100);
		expect(settings.minimumContrastRatio).toBe(21);
	});

	it('builds an ssh launch preview from profile fields', () => {
		const profile = {
			...defaultTerminalSettings().profiles[0],
			kind: 'ssh' as const,
			sshHost: 'example.com',
			sshPort: 2222,
			sshUser: 'deploy',
			sshIdentityFile: '~/.ssh/id_ed25519',
			sshIdentityFiles: ['~/.ssh/id_ed25519'],
			sshExtraArgs: '-o ServerAliveInterval=30',
			sshRemoteCommand: '"cd /srv/app && ./start.sh"',
		};

		expect(buildTerminalProfileLaunchPreview(profile)).toBe(
			'ssh -tt -o ServerAliveInterval=30 -i ~/.ssh/id_ed25519 -p 2222 deploy@example.com cd /srv/app && ./start.sh'
		);
	});

	it('applies display presets without disturbing profile state', () => {
		const base = defaultTerminalSettings();
		const next = applyTerminalDisplayPreset(base, 'presentation');

		expect(next.fontSize).toBe(15);
		expect(next.fontWeight).toBe(500);
		expect(next.fontWeightBold).toBe(800);
		expect(next.minimumContrastRatio).toBe(7);
		expect(next.profiles).toEqual(base.profiles);
		expect(next.defaultProfileId).toBe(base.defaultProfileId);
	});

	it('counts env entries from multiline profile env text', () => {
		const profile = {
			...defaultTerminalSettings().profiles[0],
			env: 'NODE_ENV=dev\nEMPTY=\nINVALID\nAPI_URL=https://example.com',
		};

		expect(countTerminalProfileEnvEntries(profile)).toBe(3);
	});

	it('normalizes the extended terminal interaction settings', () => {
		const settings = normalizeTerminalSettings({
			rightClickAction: 'menu',
			pasteOnMiddleClick: true,
			bracketedPaste: false,
			warnOnMultilinePaste: false,
			trimWhitespaceOnPaste: false,
			bell: 'audible',
			autoOpen: false,
			restoreTabs: false,
		});

		expect(settings.rightClickAction).toBe('menu');
		expect(settings.pasteOnMiddleClick).toBe(true);
		expect(settings.bracketedPaste).toBe(false);
		expect(settings.warnOnMultilinePaste).toBe(false);
		expect(settings.trimWhitespaceOnPaste).toBe(false);
		expect(settings.bell).toBe('audible');
		expect(settings.autoOpen).toBe(false);
		expect(settings.restoreTabs).toBe(false);
	});

	it('uses Windows-style interaction defaults when the renderer platform is win32', () => {
		const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
		Object.defineProperty(globalThis, 'navigator', {
			value: {
				platform: 'Win32',
				userAgent: 'Windows',
			},
			configurable: true,
		});

		try {
			const settings = defaultTerminalSettings();
			expect(settings.rightClickAction).toBe('clipboard');
			expect(settings.copyOnSelect).toBe(true);
			expect(settings.pasteOnMiddleClick).toBe(false);
		} finally {
			if (previousNavigator) {
				Object.defineProperty(globalThis, 'navigator', previousNavigator);
			} else {
				delete (globalThis as { navigator?: unknown }).navigator;
			}
		}
	});

	it('keeps builtin default profile ids when normalizing settings', () => {
		const builtin = getBuiltinTerminalProfiles()[0];
		const settings = normalizeTerminalSettings({
			defaultProfileId: builtin.id,
		});

		expect(settings.defaultProfileId).toBe(builtin.id);
	});

	it('keeps dynamically detected builtin default profile ids when normalizing settings', () => {
		const settings = normalizeTerminalSettings({
			defaultProfileId: 'builtin:wsl-ubuntu-22-04',
		});

		expect(settings.defaultProfileId).toBe('builtin:wsl-ubuntu-22-04');
	});

	it('migrates a legacy single ssh identity file into the new list field', () => {
		const settings = normalizeTerminalSettings({
			profiles: [
				{
					...defaultTerminalSettings().profiles[0],
					id: 'profile-2',
					kind: 'ssh',
					sshIdentityFile: 'C:/Users/test/.ssh/id_ed25519',
				},
			],
		});

		expect(settings.profiles[0].sshIdentityFiles).toEqual(['C:/Users/test/.ssh/id_ed25519']);
	});

	it('duplicates builtin profiles into editable custom profiles', () => {
		const base = defaultTerminalSettings();
		const builtin = getBuiltinTerminalProfiles().find((profile) => profile.builtinKey === 'sshConnection');
		expect(builtin).toBeTruthy();

		const next = cloneTerminalProfile(base.profiles, builtin!);
		expect(next.id).not.toBe(builtin!.id);
		expect(next.builtinKey).toBeUndefined();
		expect(next.kind).toBe('ssh');
	});

	it('resolves builtin profiles alongside saved custom profiles', () => {
		const builtin = getBuiltinTerminalProfiles()[0];
		const resolved = resolveTerminalProfile(defaultTerminalSettings().profiles, builtin.id);
		expect(resolved?.id).toBe(builtin.id);
	});
});
