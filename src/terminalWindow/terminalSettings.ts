/** Universal Terminal 用户设置；纯前端，localStorage 持久化，不走 settings.json。 */

export type TerminalCursorStyle = 'bar' | 'block' | 'underline';
export type TerminalBellStyle = 'none' | 'visual';
export type TerminalRightClickAction = 'off' | 'paste' | 'clipboard';
export type TerminalDisplayPresetId = 'compact' | 'balanced' | 'presentation';

/** 本地 Shell 或通过 SSH 的远程会话（由 ssh 作为 pty 子进程）。 */
export type TerminalProfileKind = 'local' | 'ssh';

export type TerminalProfile = {
	id: string;
	name: string;
	kind: TerminalProfileKind;
	/** SSH：主机名或 IP。 */
	sshHost: string;
	/** SSH：端口，默认 22。 */
	sshPort: number;
	/** SSH：登录用户名。 */
	sshUser: string;
	/** SSH：私钥路径，可选。 */
	sshIdentityFile: string;
	/** SSH：登录后在远端执行的命令（可选，空格分词，支持引号）。 */
	sshRemoteCommand: string;
	/** SSH：附加到 ssh 命令行的参数（在 -tt 之后、-i 之前插入，如 -o ServerAliveInterval=30）。 */
	sshExtraArgs: string;
	/** 为空 = 平台默认 shell。 */
	shell: string;
	/** 以空格分隔（支持 "..."/'...' 引号），为空 = 平台默认参数。 */
	args: string;
	/** 为空 = 工作区根 / 进程 cwd。支持相对路径（相对工作区根）或绝对路径。 */
	cwd: string;
	/** 每行一个 KEY=VAL。 */
	env: string;
};

export type TerminalAppSettings = {
	fontFamily: string;
	fontSize: number;
	fontWeight: number;
	fontWeightBold: number;
	lineHeight: number;
	cursorStyle: TerminalCursorStyle;
	cursorBlink: boolean;
	scrollback: number;
	minimumContrastRatio: number;
	drawBoldTextInBrightColors: boolean;
	scrollOnInput: boolean;
	wordSeparator: string;
	copyOnSelect: boolean;
	rightClickAction: TerminalRightClickAction;
	bell: TerminalBellStyle;
	/** 0.6–1.0；应用到终端内容面板背景色的不透明度（露出窗口的渐变背景）。 */
	opacity: number;
	profiles: TerminalProfile[];
	defaultProfileId: string;
};

export const DEFAULT_PROFILE_ID = 'default';
export const STORAGE_KEY = 'void-shell:terminal:settings';
export const TERMINAL_SETTINGS_CHANGED_EVENT = 'async:terminal-settings-changed';
export const DEFAULT_TERMINAL_WORD_SEPARATOR = ` ()[]{}'",`;

export const FONT_FAMILY_CHOICES: { label: string; value: string }[] = [
	{ label: 'JetBrains Mono', value: 'JetBrains Mono, Consolas, monospace' },
	{ label: 'Cascadia Code', value: '"Cascadia Code", Consolas, monospace' },
	{ label: 'Fira Code', value: '"Fira Code", Consolas, monospace' },
	{ label: 'Consolas', value: 'Consolas, monospace' },
	{ label: 'SF Mono', value: '"SF Mono", Menlo, monospace' },
	{ label: 'Menlo', value: 'Menlo, Monaco, monospace' },
	{ label: 'Courier New', value: '"Courier New", monospace' },
];

export function defaultTerminalSettings(): TerminalAppSettings {
	return {
		fontFamily: FONT_FAMILY_CHOICES[0].value,
		fontSize: 13,
		fontWeight: 400,
		fontWeightBold: 700,
		lineHeight: 1.25,
		cursorStyle: 'bar',
		cursorBlink: true,
		scrollback: 4000,
		minimumContrastRatio: 1,
		drawBoldTextInBrightColors: true,
		scrollOnInput: true,
		wordSeparator: DEFAULT_TERMINAL_WORD_SEPARATOR,
		copyOnSelect: false,
		rightClickAction: 'paste',
		bell: 'none',
		opacity: 1,
		profiles: [
			{
				id: DEFAULT_PROFILE_ID,
				name: 'Default',
				kind: 'local',
				sshHost: '',
				sshPort: 22,
				sshUser: '',
				sshIdentityFile: '',
				sshRemoteCommand: '',
				sshExtraArgs: '',
				shell: '',
				args: '',
				cwd: '',
				env: '',
			},
		],
		defaultProfileId: DEFAULT_PROFILE_ID,
	};
}

export function normalizeTerminalSettings(raw: unknown): TerminalAppSettings {
	const def = defaultTerminalSettings();
	if (!raw || typeof raw !== 'object') {
		return def;
	}
	const obj = raw as Record<string, unknown>;
	const profilesRaw = Array.isArray(obj.profiles) ? (obj.profiles as unknown[]) : def.profiles;
	const profiles: TerminalProfile[] = profilesRaw
		.map((p, i) => {
			if (!p || typeof p !== 'object') {
				return null;
			}
			const po = p as Record<string, unknown>;
			const id = typeof po.id === 'string' && po.id.trim() ? po.id.trim() : `profile-${i}`;
			const kindRaw = po.kind;
			const kind: TerminalProfileKind = kindRaw === 'ssh' ? 'ssh' : 'local';
			return {
				id,
				name: typeof po.name === 'string' && po.name.trim() ? po.name : `Profile ${i + 1}`,
				kind,
				sshHost: typeof po.sshHost === 'string' ? po.sshHost : '',
				sshPort: clamp(Math.floor(toNumber(po.sshPort, 22)), 1, 65535),
				sshUser: typeof po.sshUser === 'string' ? po.sshUser : '',
				sshIdentityFile: typeof po.sshIdentityFile === 'string' ? po.sshIdentityFile : '',
				sshRemoteCommand: typeof po.sshRemoteCommand === 'string' ? po.sshRemoteCommand : '',
				sshExtraArgs: typeof po.sshExtraArgs === 'string' ? po.sshExtraArgs : '',
				shell: typeof po.shell === 'string' ? po.shell : '',
				args: typeof po.args === 'string' ? po.args : '',
				cwd: typeof po.cwd === 'string' ? po.cwd : '',
				env: typeof po.env === 'string' ? po.env : '',
			};
		})
		.filter((v): v is TerminalProfile => Boolean(v));
	const effectiveProfiles = profiles.length ? profiles : def.profiles;
	const defaultProfileId =
		typeof obj.defaultProfileId === 'string' && effectiveProfiles.some((p) => p.id === obj.defaultProfileId)
			? obj.defaultProfileId
			: effectiveProfiles[0].id;
	const cursor = obj.cursorStyle;
	const bell = obj.bell;
	const legacyRightClickPaste = obj.rightClickPaste;
	const rawRightClickAction = obj.rightClickAction;
	return {
		fontFamily: typeof obj.fontFamily === 'string' && obj.fontFamily.trim() ? obj.fontFamily : def.fontFamily,
		fontSize: clamp(toNumber(obj.fontSize, def.fontSize), 8, 32),
		fontWeight: snapFontWeight(toNumber(obj.fontWeight, def.fontWeight)),
		fontWeightBold: snapFontWeight(toNumber(obj.fontWeightBold, def.fontWeightBold)),
		lineHeight: clamp(toNumber(obj.lineHeight, def.lineHeight), 1, 2.4),
		cursorStyle: cursor === 'block' || cursor === 'underline' || cursor === 'bar' ? cursor : def.cursorStyle,
		cursorBlink: obj.cursorBlink !== false,
		scrollback: clamp(Math.floor(toNumber(obj.scrollback, def.scrollback)), 100, 100_000),
		minimumContrastRatio: clamp(toNumber(obj.minimumContrastRatio, def.minimumContrastRatio), 1, 21),
		drawBoldTextInBrightColors: obj.drawBoldTextInBrightColors !== false,
		scrollOnInput: obj.scrollOnInput !== false,
		wordSeparator:
			typeof obj.wordSeparator === 'string' && obj.wordSeparator.length > 0
				? obj.wordSeparator
				: def.wordSeparator,
		copyOnSelect: Boolean(obj.copyOnSelect),
		rightClickAction:
			rawRightClickAction === 'off' || rawRightClickAction === 'paste' || rawRightClickAction === 'clipboard'
				? rawRightClickAction
				: legacyRightClickPaste === false
					? 'off'
					: 'paste',
		bell: bell === 'visual' ? 'visual' : 'none',
		opacity: clamp(toNumber(obj.opacity, def.opacity), 0.5, 1),
		profiles: effectiveProfiles,
		defaultProfileId,
	};
}

export function loadTerminalSettings(): TerminalAppSettings {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return defaultTerminalSettings();
		}
		return normalizeTerminalSettings(JSON.parse(raw));
	} catch {
		return defaultTerminalSettings();
	}
}

export function saveTerminalSettings(s: TerminalAppSettings): void {
	try {
		const next = normalizeTerminalSettings(s);
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		emitTerminalSettingsChanged(next);
	} catch {
		/* ignore */
	}
}

export function subscribeTerminalSettings(listener: () => void): () => void {
	if (typeof window === 'undefined') {
		return () => {};
	}
	const onStorage = (event: StorageEvent) => {
		if (!event.key || event.key === STORAGE_KEY) {
			listener();
		}
	};
	const onChanged = () => listener();
	window.addEventListener('storage', onStorage);
	window.addEventListener(TERMINAL_SETTINGS_CHANGED_EVENT, onChanged);
	return () => {
		window.removeEventListener('storage', onStorage);
		window.removeEventListener(TERMINAL_SETTINGS_CHANGED_EVENT, onChanged);
	};
}

export function newProfileId(existing: TerminalProfile[]): string {
	let n = existing.length + 1;
	const ids = new Set(existing.map((p) => p.id));
	while (ids.has(`profile-${n}`)) {
		n += 1;
	}
	return `profile-${n}`;
}

export function cloneTerminalProfile(existing: TerminalProfile[], profile: TerminalProfile): TerminalProfile {
	return {
		...profile,
		id: newProfileId(existing),
		name: `${profile.name.trim() || 'Profile'} Copy`,
	};
}

export function resetTerminalProfile(profile: TerminalProfile): TerminalProfile {
	return {
		...defaultTerminalSettings().profiles[0],
		id: profile.id,
		name: profile.name,
		kind: profile.kind,
	};
}

export function countTerminalProfileEnvEntries(profile: TerminalProfile): number {
	return Object.keys(parseEnvString(profile.env) ?? {}).length;
}

export function buildTerminalProfileTarget(profile: TerminalProfile): string {
	if (profile.kind === 'ssh') {
		const user = profile.sshUser.trim();
		const host = profile.sshHost.trim();
		if (!user && !host) {
			return 'SSH';
		}
		const target = [user, host].filter(Boolean).join('@');
		return profile.sshPort && profile.sshPort !== 22 ? `${target}:${profile.sshPort}` : target;
	}
	return profile.shell.trim();
}

export function buildTerminalProfileLaunchPreview(profile: TerminalProfile): string {
	if (profile.kind === 'ssh') {
		const args: string[] = ['ssh', '-tt'];
		const extraArgs = parseArgsString(profile.sshExtraArgs);
		if (extraArgs.length) {
			args.push(...extraArgs);
		}
		const identity = profile.sshIdentityFile.trim();
		if (identity) {
			args.push('-i', identity);
		}
		if (profile.sshPort && profile.sshPort !== 22) {
			args.push('-p', String(profile.sshPort));
		}
		const target = [profile.sshUser.trim(), profile.sshHost.trim()].filter(Boolean).join('@');
		if (target) {
			args.push(target);
		}
		const remoteCommand = parseArgsString(profile.sshRemoteCommand);
		if (remoteCommand.length) {
			args.push(...remoteCommand);
		}
		return args.join(' ').trim() || 'ssh';
	}
	const shell = profile.shell.trim() || 'system shell';
	const args = parseArgsString(profile.args);
	return [shell, ...args].join(' ').trim();
}

export function applyTerminalDisplayPreset(
	settings: TerminalAppSettings,
	presetId: TerminalDisplayPresetId
): TerminalAppSettings {
	switch (presetId) {
		case 'compact':
			return normalizeTerminalSettings({
				...settings,
				fontSize: 12,
				fontWeight: 400,
				fontWeightBold: 700,
				lineHeight: 1.12,
				minimumContrastRatio: 4,
				scrollback: 3000,
				opacity: 1,
			});
		case 'presentation':
			return normalizeTerminalSettings({
				...settings,
				fontSize: 15,
				fontWeight: 500,
				fontWeightBold: 800,
				lineHeight: 1.35,
				minimumContrastRatio: 7,
				scrollback: 8000,
				opacity: 0.96,
			});
		case 'balanced':
		default:
			return normalizeTerminalSettings({
				...settings,
				fontSize: 13,
				fontWeight: 400,
				fontWeightBold: 700,
				lineHeight: 1.25,
				minimumContrastRatio: 5,
				scrollback: 4000,
				opacity: 1,
			});
	}
}

/** 将 args 字符串按 shell 风格切分（支持 "..." / '...' 引号）。 */
export function parseArgsString(s: string): string[] {
	const trimmed = s.trim();
	if (!trimmed) {
		return [];
	}
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(trimmed))) {
		out.push(m[1] ?? m[2] ?? m[3] ?? '');
	}
	return out;
}

function isWindowsRenderer(): boolean {
	if (typeof document !== 'undefined') {
		const p = document.documentElement.getAttribute('data-platform');
		if (p === 'win32' || p === 'darwin' || p === 'linux') {
			return p === 'win32';
		}
	}
	return typeof navigator !== 'undefined' && /win/i.test(navigator.platform || navigator.userAgent || '');
}

/**
 * 根据配置档生成 `term:sessionCreate` 的选项（本地 Shell 或 ssh）。SSH 缺少必填项时退回本地逻辑。
 */
export function buildTermSessionCreatePayload(profile: TerminalProfile): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	if (profile.name.trim()) {
		payload.title = profile.name.trim();
	}
	const env = parseEnvString(profile.env);
	if (env) {
		payload.env = env;
	}
	if (profile.cwd.trim()) {
		payload.cwd = profile.cwd.trim();
	}

	const sshReady =
		profile.kind === 'ssh' && profile.sshHost.trim().length > 0 && profile.sshUser.trim().length > 0;

	if (sshReady) {
		const args: string[] = ['-tt'];
		args.push(...parseArgsString(profile.sshExtraArgs));
		const ident = profile.sshIdentityFile.trim();
		if (ident) {
			args.push('-i', ident);
		}
		const port = Math.floor(Number(profile.sshPort) || 22);
		if (port !== 22) {
			args.push('-p', String(port));
		}
		args.push(`${profile.sshUser.trim()}@${profile.sshHost.trim()}`);
		args.push(...parseArgsString(profile.sshRemoteCommand));
		payload.shell = isWindowsRenderer() ? 'ssh.exe' : 'ssh';
		payload.args = args;
		return payload;
	}

	if (profile.shell.trim()) {
		payload.shell = profile.shell.trim();
	}
	const a = parseArgsString(profile.args);
	if (a.length) {
		payload.args = a;
	}
	return payload;
}

/** 每行 KEY=VAL；返回 undefined 表示没有自定义项。 */
export function parseEnvString(s: string): Record<string, string> | undefined {
	const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (lines.length === 0) {
		return undefined;
	}
	const env: Record<string, string> = {};
	for (const line of lines) {
		const eq = line.indexOf('=');
		if (eq <= 0) {
			continue;
		}
		const key = line.slice(0, eq).trim();
		if (!key) {
			continue;
		}
		env[key] = line.slice(eq + 1);
	}
	return Object.keys(env).length ? env : undefined;
}

function clamp(n: number, min: number, max: number): number {
	if (!Number.isFinite(n)) {
		return min;
	}
	return Math.min(Math.max(n, min), max);
}

function snapFontWeight(v: number): number {
	return Math.round(clamp(v, 100, 900) / 100) * 100;
}

function toNumber(v: unknown, fallback: number): number {
	if (typeof v === 'number' && Number.isFinite(v)) {
		return v;
	}
	if (typeof v === 'string') {
		const n = Number(v);
		return Number.isFinite(n) ? n : fallback;
	}
	return fallback;
}

function emitTerminalSettingsChanged(settings: TerminalAppSettings): void {
	if (typeof window === 'undefined') {
		return;
	}
	try {
		window.dispatchEvent(
			new CustomEvent(TERMINAL_SETTINGS_CHANGED_EVENT, {
				detail: settings,
			})
		);
	} catch {
		/* ignore */
	}
}
