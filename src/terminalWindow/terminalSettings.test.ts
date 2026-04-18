import { describe, expect, it } from 'vitest';
import {
	applyTerminalDisplayPreset,
	buildTerminalProfileLaunchPreview,
	countTerminalProfileEnvEntries,
	defaultTerminalSettings,
	normalizeTerminalSettings,
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
});
