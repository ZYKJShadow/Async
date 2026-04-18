import {
	buildSshExecArgs,
	buildTermSessionCreatePayload,
	buildTerminalProfileTarget,
	getBuiltinTerminalProfiles,
	resolveTerminalProfile,
	type TerminalAppSettings,
	type TerminalProfile,
	type TerminalRuntimePlatform,
} from '../src/terminalWindow/terminalSettings.js';
import type { TerminalSessionCreateOpts } from './terminalSessionService.js';
import { getTerminalProfilePassword, hasTerminalProfilePassword } from './terminalProfileSecrets.js';

export type TerminalToolProfileSummary = {
	id: string;
	name: string;
	kind: 'local' | 'ssh';
	source: 'user' | 'builtin';
	target: string;
	authMode?: string;
	hasStoredPassword: boolean;
	defaultProfile: boolean;
	hasRemoteCommand: boolean;
};

let cachedSettings: TerminalAppSettings | null = null;

function runtimePlatform(): TerminalRuntimePlatform {
	if (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux') {
		return process.platform;
	}
	return 'unknown';
}

function currentSettings(): Pick<TerminalAppSettings, 'profiles' | 'defaultProfileId'> {
	if (
		cachedSettings &&
		Array.isArray(cachedSettings.profiles) &&
		typeof cachedSettings.defaultProfileId === 'string'
	) {
		return cachedSettings;
	}
	return {
		profiles: [],
		defaultProfileId: '',
	};
}

function profileSource(
	profile: TerminalProfile,
	customProfiles: TerminalProfile[]
): 'user' | 'builtin' {
	return customProfiles.some((item) => item.id === profile.id) ? 'user' : 'builtin';
}

function profileMatchesNeedle(profile: TerminalProfile, needle: string): boolean {
	const trimmed = needle.trim();
	if (!trimmed) {
		return false;
	}
	const lower = trimmed.toLowerCase();
	return profile.id === trimmed || profile.name.trim().toLowerCase() === lower;
}

function resolveStoredProfile(profileNeedle?: string | null): {
	profile: TerminalProfile;
	source: 'user' | 'builtin';
	defaultProfileId: string;
} | null {
	const settings = currentSettings();
	const builtins = getBuiltinTerminalProfiles(runtimePlatform());
	const customProfiles = settings.profiles ?? [];
	if (profileNeedle?.trim()) {
		const explicit =
			customProfiles.find((profile) => profileMatchesNeedle(profile, profileNeedle)) ??
			builtins.find((profile) => profileMatchesNeedle(profile, profileNeedle)) ??
			null;
		if (!explicit) {
			return null;
		}
		return {
			profile: explicit,
			source: profileSource(explicit, customProfiles),
			defaultProfileId: settings.defaultProfileId ?? '',
		};
	}
	const fallback = resolveTerminalProfile(customProfiles, settings.defaultProfileId, builtins);
	if (!fallback) {
		return null;
	}
	return {
		profile: fallback,
		source: profileSource(fallback, customProfiles),
		defaultProfileId: settings.defaultProfileId ?? '',
	};
}

function toCreateOptsFromPayload(payload: Record<string, unknown>): TerminalSessionCreateOpts {
	let args: string[] | undefined;
	if (Array.isArray(payload.args)) {
		const next = payload.args.filter((value): value is string => typeof value === 'string');
		if (next.length > 0) {
			args = next;
		}
	}

	let env: Record<string, string> | undefined;
	if (payload.env && typeof payload.env === 'object') {
		const entries = Object.entries(payload.env as Record<string, unknown>).filter(
			([key, value]) => typeof key === 'string' && typeof value === 'string'
		) as [string, string][];
		if (entries.length > 0) {
			env = Object.fromEntries(entries);
		}
	}

	return {
		cwd: typeof payload.cwd === 'string' && payload.cwd.trim() ? payload.cwd.trim() : undefined,
		shell: typeof payload.shell === 'string' && payload.shell.trim() ? payload.shell.trim() : undefined,
		args,
		env,
		title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : undefined,
		passwordAutofill:
			typeof payload.profileId === 'string' &&
			(typeof payload.sshAuthMode !== 'string' ||
				payload.sshAuthMode === 'auto' ||
				payload.sshAuthMode === 'password')
				? getTerminalProfilePassword(payload.profileId) || undefined
				: undefined,
	};
}

export function syncTerminalSettings(raw: unknown): { profileCount: number } {
	if (
		raw &&
		typeof raw === 'object' &&
		Array.isArray((raw as { profiles?: unknown[] }).profiles)
	) {
		cachedSettings = raw as TerminalAppSettings;
		return { profileCount: cachedSettings.profiles.length };
	}
	cachedSettings = null;
	return { profileCount: 0 };
}

export function listTerminalToolProfiles(): TerminalToolProfileSummary[] {
	const settings = currentSettings();
	const customProfiles = settings.profiles ?? [];
	const builtins = getBuiltinTerminalProfiles(runtimePlatform());
	const merged = [...customProfiles];
	for (const builtin of builtins) {
		if (!merged.some((profile) => profile.id === builtin.id)) {
			merged.push(builtin);
		}
	}
	return merged.map((profile) => ({
		id: profile.id,
		name: profile.name.trim() || profile.id,
		kind: profile.kind,
		source: profileSource(profile, customProfiles),
		target: buildTerminalProfileTarget(profile),
		authMode: profile.kind === 'ssh' ? profile.sshAuthMode : undefined,
		hasStoredPassword: hasTerminalProfilePassword(profile.id),
		defaultProfile: profile.id === settings.defaultProfileId,
		hasRemoteCommand: profile.kind === 'ssh' && profile.sshRemoteCommand.trim().length > 0,
	}));
}

export function resolveTerminalToolCreateOpts(profileNeedle?: string | null): {
	createOpts: TerminalSessionCreateOpts;
	profile: TerminalToolProfileSummary;
} | null {
	const resolved = resolveStoredProfile(profileNeedle);
	if (!resolved) {
		return null;
	}
	const payload = buildTermSessionCreatePayload(resolved.profile, runtimePlatform());
	return {
		createOpts: toCreateOptsFromPayload(payload),
		profile: {
			id: resolved.profile.id,
			name: resolved.profile.name.trim() || resolved.profile.id,
			kind: resolved.profile.kind,
			source: resolved.source,
			target: buildTerminalProfileTarget(resolved.profile),
			authMode: resolved.profile.kind === 'ssh' ? resolved.profile.sshAuthMode : undefined,
			hasStoredPassword: hasTerminalProfilePassword(resolved.profile.id),
			defaultProfile: resolved.profile.id === resolved.defaultProfileId,
			hasRemoteCommand: resolved.profile.kind === 'ssh' && resolved.profile.sshRemoteCommand.trim().length > 0,
		},
	};
}

export function resolveTerminalToolExecCreateOpts(
	profileNeedle: string | null | undefined,
	command: string
):
	| {
			createOpts: TerminalSessionCreateOpts;
			profile: TerminalToolProfileSummary;
	  }
	| {
			error: string;
	  }
	| null {
	const resolved = resolveStoredProfile(profileNeedle);
	if (!resolved) {
		return null;
	}
	const summary: TerminalToolProfileSummary = {
		id: resolved.profile.id,
		name: resolved.profile.name.trim() || resolved.profile.id,
		kind: resolved.profile.kind,
		source: resolved.source,
		target: buildTerminalProfileTarget(resolved.profile),
		authMode: resolved.profile.kind === 'ssh' ? resolved.profile.sshAuthMode : undefined,
		hasStoredPassword: hasTerminalProfilePassword(resolved.profile.id),
		defaultProfile: resolved.profile.id === resolved.defaultProfileId,
		hasRemoteCommand: resolved.profile.kind === 'ssh' && resolved.profile.sshRemoteCommand.trim().length > 0,
	};
	if (resolved.profile.kind !== 'ssh') {
		return {
			error: `Terminal exec only supports SSH profiles. Use run for local shells, or open + write/read for a persistent interactive session.`,
		};
	}
	if (summary.hasRemoteCommand) {
		return {
			error: `Terminal exec does not support SSH profiles with a preset remote command. Clear the profile's remote command or use open + write/read.`,
		};
	}
	const payload = buildTermSessionCreatePayload(resolved.profile, runtimePlatform());
	return {
		createOpts: {
			...toCreateOptsFromPayload(payload),
			shell: runtimePlatform() === 'win32' ? 'ssh.exe' : 'ssh',
			args: buildSshExecArgs(resolved.profile, command),
		},
		profile: summary,
	};
}
