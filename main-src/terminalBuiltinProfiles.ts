import { accessSync, constants, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export type BuiltinTerminalProfileDescriptor = {
	id: string;
	builtinKey?: string;
	name: string;
	group: string;
	icon: string;
	color: string;
	disableDynamicTitle: boolean;
	behaviorOnSessionEnd: 'auto' | 'keep' | 'reconnect' | 'close';
	clearServiceMessagesOnConnect: boolean;
	terminalColorSchemeId: string;
	loginScripts: Array<{ expect: string; send: string; isRegex: boolean; optional: boolean }>;
	inputBackspace: 'backspace' | 'ctrl-h' | 'ctrl-?' | 'delete';
	kind: 'local' | 'ssh';
	shell: string;
	args: string;
	sshHost: string;
	sshPort: number;
	sshUser: string;
	sshIdentityFile: string;
	sshIdentityFiles: string[];
	sshAuthMode: 'auto' | 'password' | 'publicKey' | 'agent' | 'keyboardInteractive';
	sshProxyCommand: string;
	sshJumpHost: string;
	sshRemoteCommand: string;
	sshExtraArgs: string;
	sshKeepAliveInterval: number;
	sshKeepAliveCountMax: number;
	sshReadyTimeout: number;
	sshSkipBanner: boolean;
	sshForwardedPorts: Array<{
		id: string;
		type: 'local' | 'remote' | 'dynamic';
		host: string;
		port: number;
		targetAddress: string;
		targetPort: number;
		description: string;
	}>;
	sshAlgorithms: {
		cipher: string[];
		kex: string[];
		hmac: string[];
		serverHostKey: string[];
		compression: string[];
	};
	cwd: string;
	env: string;
};

const BUILTIN_PREFIX = 'builtin:';
const WSL_ENV = 'TERM=xterm-color\nCOLORTERM=truecolor';

export async function listBuiltinTerminalProfiles(): Promise<BuiltinTerminalProfileDescriptor[]> {
	const profiles: BuiltinTerminalProfileDescriptor[] = [
		createBuiltinProfile('system-default', {
			builtinKey: 'systemDefault',
			name: 'System default',
		}),
	];

	if (process.platform === 'win32') {
		for (const profile of listWindowsBuiltinProfiles()) {
			addUniqueProfile(profiles, profile);
		}
	} else {
		for (const profile of listUnixBuiltinProfiles()) {
			addUniqueProfile(profiles, profile);
		}
	}

	addUniqueProfile(
		profiles,
		createBuiltinProfile('ssh-template', {
			builtinKey: 'sshConnection',
			name: 'SSH connection',
			kind: 'ssh',
			sshUser: 'root',
			sshPort: 22,
		})
	);

	return profiles;
}

function listWindowsBuiltinProfiles(): BuiltinTerminalProfileDescriptor[] {
	const profiles: BuiltinTerminalProfileDescriptor[] = [];

	addIfPresent(
		profiles,
		resolveComSpec(),
		(shell) =>
			createBuiltinProfile('cmd', {
				builtinKey: 'cmd',
				name: 'Command Prompt',
				shell,
				args: '/k chcp 65001>nul',
			})
	);

	addIfPresent(
		profiles,
		findWindowsPowerShellCore(),
		(shell) =>
			createBuiltinProfile('pwsh', {
				builtinKey: 'pwsh',
				name: 'PowerShell 7',
				shell,
				args: '-NoLogo',
			})
	);

	addIfPresent(
		profiles,
		findWindowsPowerShell(),
		(shell) =>
			createBuiltinProfile('powershell', {
				builtinKey: 'powershell',
				name: 'PowerShell',
				shell,
				args: '-NoLogo',
			})
	);

	addIfPresent(
		profiles,
		findGitBashOnWindows(),
		(shell) =>
			createBuiltinProfile('git-bash', {
				builtinKey: 'gitBash',
				name: 'Git Bash',
				shell,
				args: '--login -i',
			})
	);

	for (const profile of listWslProfilesOnWindows()) {
		profiles.push(profile);
	}

	return profiles;
}

function listUnixBuiltinProfiles(): BuiltinTerminalProfileDescriptor[] {
	const profiles: BuiltinTerminalProfileDescriptor[] = [];
	for (const shell of findUnixShellCandidates()) {
		const normalized = shell.replace(/\\/g, '/').toLowerCase();
		if (normalized.includes('/zsh')) {
			addUniqueProfile(
				profiles,
				createBuiltinProfile('zsh', {
					builtinKey: 'zsh',
					name: 'zsh',
					shell,
					args: '-l',
				})
			);
		} else if (normalized.includes('/bash')) {
			addUniqueProfile(
				profiles,
				createBuiltinProfile('bash', {
					builtinKey: 'bash',
					name: 'bash',
					shell,
					args: '-l',
				})
			);
		}
	}
	return profiles;
}

function createBuiltinProfile(
	idSuffix: string,
	partial: Partial<BuiltinTerminalProfileDescriptor>
): BuiltinTerminalProfileDescriptor {
	return {
		id: `${BUILTIN_PREFIX}${idSuffix}`,
		builtinKey: partial.builtinKey,
		name: partial.name || idSuffix,
		group: partial.group || '',
		icon: partial.icon || '',
		color: partial.color || '#000000',
		disableDynamicTitle: partial.disableDynamicTitle ?? false,
		behaviorOnSessionEnd: partial.behaviorOnSessionEnd || 'auto',
		clearServiceMessagesOnConnect: partial.clearServiceMessagesOnConnect ?? false,
		terminalColorSchemeId: partial.terminalColorSchemeId || '',
		loginScripts: partial.loginScripts || [],
		inputBackspace: partial.inputBackspace || 'backspace',
		kind: partial.kind === 'ssh' ? 'ssh' : 'local',
		shell: partial.shell || '',
		args: partial.args || '',
		sshHost: partial.sshHost || '',
		sshPort: partial.sshPort ?? 22,
		sshUser: partial.sshUser || '',
		sshIdentityFile: partial.sshIdentityFile || '',
		sshIdentityFiles: partial.sshIdentityFiles || [],
		sshAuthMode: partial.sshAuthMode || 'auto',
		sshProxyCommand: partial.sshProxyCommand || '',
		sshJumpHost: partial.sshJumpHost || '',
		sshRemoteCommand: partial.sshRemoteCommand || '',
		sshExtraArgs: partial.sshExtraArgs || '',
		sshKeepAliveInterval: partial.sshKeepAliveInterval ?? 0,
		sshKeepAliveCountMax: partial.sshKeepAliveCountMax ?? 3,
		sshReadyTimeout: partial.sshReadyTimeout ?? 20_000,
		sshSkipBanner: partial.sshSkipBanner ?? false,
		sshForwardedPorts: partial.sshForwardedPorts || [],
		sshAlgorithms: partial.sshAlgorithms || {
			cipher: [],
			kex: [],
			hmac: [],
			serverHostKey: [],
			compression: [],
		},
		cwd: partial.cwd || '',
		env: partial.env || '',
	};
}

function addUniqueProfile(profiles: BuiltinTerminalProfileDescriptor[], profile: BuiltinTerminalProfileDescriptor): void {
	const signature = getProfileSignature(profile);
	if (!profiles.some((item) => item.id === profile.id || getProfileSignature(item) === signature)) {
		profiles.push(profile);
	}
}

function getProfileSignature(profile: BuiltinTerminalProfileDescriptor): string {
	return [
		profile.kind,
		profile.shell.trim().toLowerCase(),
		profile.args.trim(),
		profile.sshHost.trim().toLowerCase(),
		profile.sshUser.trim().toLowerCase(),
		String(profile.sshPort),
		profile.sshRemoteCommand.trim(),
	].join('|');
}

function addIfPresent(
	profiles: BuiltinTerminalProfileDescriptor[],
	value: string | null,
	create: (resolved: string) => BuiltinTerminalProfileDescriptor
): void {
	if (!value) {
		return;
	}
	profiles.push(create(value));
}

function isExecutable(filePath: string): boolean {
	try {
		accessSync(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function resolveComSpec(): string {
	const env = process.env.ComSpec || process.env.COMSPEC;
	if (env && existsSync(env)) {
		return env;
	}
	const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
	const fallback = path.join(systemRoot, 'System32', 'cmd.exe');
	return existsSync(fallback) ? fallback : 'cmd.exe';
}

function findWindowsPowerShellCore(): string | null {
	return (
		readRegistryValue('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\pwsh.exe') ||
		readRegistryValue('HKCU', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\pwsh.exe') ||
		findCommandOnWindows('pwsh.exe') ||
		findExistingWindowsPath([
			path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
			path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7-preview', 'pwsh.exe'),
			path.join(process.env.LocalAppData || '', 'Microsoft', 'WindowsApps', 'pwsh.exe'),
		])
	);
}

function findWindowsPowerShell(): string | null {
	return (
		findCommandOnWindows('powershell.exe') ||
		findExistingWindowsPath([
			path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
			path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'powershell.exe'),
		])
	);
}

function findCommandOnWindows(command: string): string | null {
	const result = spawnSync('where.exe', [command], {
		windowsHide: true,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	});
	if (result.status !== 0 || typeof result.stdout !== 'string') {
		return null;
	}
	const first = result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean);
	return first || null;
}

function findExistingWindowsPath(candidates: string[]): string | null {
	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

function readRegistryValue(hive: 'HKLM' | 'HKCU', key: string, valueName = ''): string | null {
	const args = ['query', `${hive}\\${key}`, valueName ? '/v' : '/ve'];
	if (valueName) {
		args.push(valueName);
	}
	const result = spawnSync('reg.exe', args, {
		windowsHide: true,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	});
	if (result.status !== 0 || typeof result.stdout !== 'string') {
		return null;
	}
	for (const line of result.stdout.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || !trimmed.includes('REG_')) {
			continue;
		}
		const match = trimmed.match(/^(.*?)\s+REG_\w+\s+(.*)$/);
		if (match?.[2]) {
			return match[2].trim() || null;
		}
	}
	return null;
}

function findGitBashOnWindows(): string | null {
	const installRoots = new Set<string>();

	for (const value of [
		readRegistryValue('HKLM', 'Software\\GitForWindows', 'InstallPath'),
		readRegistryValue('HKCU', 'Software\\GitForWindows', 'InstallPath'),
	]) {
		if (value) {
			installRoots.add(value);
		}
	}

	for (const gitPath of [
		findCommandOnWindows('git.exe'),
		findExistingWindowsPath([
			'C:\\Program Files\\Git\\cmd\\git.exe',
			'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
			path.join(process.env.LocalAppData || '', 'Programs', 'Git', 'cmd', 'git.exe'),
		]),
	]) {
		if (!gitPath) {
			continue;
		}
		const gitDir = path.dirname(gitPath);
		installRoots.add(gitDir);
		installRoots.add(path.dirname(gitDir));
	}

	for (const candidate of [
		'C:\\Program Files\\Git',
		'C:\\Program Files (x86)\\Git',
		path.join(process.env.LocalAppData || '', 'Programs', 'Git'),
	]) {
		if (candidate) {
			installRoots.add(candidate);
		}
	}

	for (const root of installRoots) {
		for (const candidate of [
			path.join(root, 'bin', 'bash.exe'),
			path.join(root, 'usr', 'bin', 'bash.exe'),
			path.join(root, 'git-bash.exe'),
		]) {
			if (existsSync(candidate)) {
				return candidate;
			}
		}
	}

	return null;
}

function listWslProfilesOnWindows(): BuiltinTerminalProfileDescriptor[] {
	const wslPath = findCommandOnWindows('wsl.exe');
	if (!wslPath) {
		return [];
	}

	const profiles = [
		createBuiltinProfile('wsl', {
			builtinKey: 'wsl',
			name: 'WSL',
			shell: wslPath,
			env: WSL_ENV,
		}),
	];

	for (const distro of listWslDistributionNames(wslPath)) {
		profiles.push(
			createBuiltinProfile(`wsl-${slugifyBuiltinIdFragment(distro)}`, {
				name: `WSL / ${distro}`,
				shell: wslPath,
				args: `-d "${distro}"`,
				env: WSL_ENV,
			})
		);
	}

	return profiles;
}

function listWslDistributionNames(wslPath: string): string[] {
	const result = spawnSync(wslPath, ['--list', '--quiet'], {
		windowsHide: true,
		encoding: 'buffer',
		stdio: ['ignore', 'pipe', 'ignore'],
	});
	if (result.status !== 0 || !result.stdout) {
		return [];
	}
	const text = decodeCommandOutput(result.stdout as Buffer);
	return Array.from(
		new Set(
			text
				.split(/\r?\n/)
				.map((line) => line.replace(/\u0000/g, '').trim())
				.filter((line) => /^[\p{L}\p{N}._-]+$/u.test(line))
		)
	);
}

function decodeCommandOutput(output: Buffer): string {
	if (output.length >= 2 && output[0] === 0xff && output[1] === 0xfe) {
		return output.toString('utf16le');
	}
	let zeroBytes = 0;
	for (let i = 1; i < output.length; i += 2) {
		if (output[i] === 0) {
			zeroBytes += 1;
		}
	}
	if (output.length > 4 && zeroBytes >= Math.floor(output.length / 4)) {
		return output.toString('utf16le');
	}
	return output.toString('utf8');
}

function slugifyBuiltinIdFragment(input: string): string {
	const normalized = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return normalized || 'default';
}

function findUnixShellCandidates(): string[] {
	const candidates = new Set<string>();
	const envShell = process.env.SHELL?.trim();
	if (envShell && isExecutable(envShell)) {
		candidates.add(envShell);
	}
	for (const shellPath of [
		'/bin/bash',
		'/usr/bin/bash',
		'/usr/local/bin/bash',
		'/opt/homebrew/bin/bash',
		'/bin/zsh',
		'/usr/bin/zsh',
		'/usr/local/bin/zsh',
		'/opt/homebrew/bin/zsh',
	]) {
		if (existsSync(shellPath) && isExecutable(shellPath)) {
			candidates.add(shellPath);
		}
	}
	return Array.from(candidates);
}
