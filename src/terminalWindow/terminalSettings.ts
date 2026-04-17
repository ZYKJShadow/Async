/** Universal Terminal 用户设置；纯前端，localStorage 持久化，不走 settings.json。 */

export type TerminalCursorStyle = 'bar' | 'block' | 'underline';
export type TerminalBellStyle = 'none' | 'visual';

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
	lineHeight: number;
	cursorStyle: TerminalCursorStyle;
	cursorBlink: boolean;
	scrollback: number;
	copyOnSelect: boolean;
	rightClickPaste: boolean;
	bell: TerminalBellStyle;
	/** 0.6–1.0；应用到终端内容面板背景色的不透明度（露出窗口的渐变背景）。 */
	opacity: number;
	profiles: TerminalProfile[];
	defaultProfileId: string;
};

export const DEFAULT_PROFILE_ID = 'default';
export const STORAGE_KEY = 'void-shell:terminal:settings';

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
		lineHeight: 1.25,
		cursorStyle: 'bar',
		cursorBlink: true,
		scrollback: 4000,
		copyOnSelect: false,
		rightClickPaste: true,
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

function normalizeSettings(raw: unknown): TerminalAppSettings {
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
	return {
		fontFamily: typeof obj.fontFamily === 'string' && obj.fontFamily.trim() ? obj.fontFamily : def.fontFamily,
		fontSize: clamp(toNumber(obj.fontSize, def.fontSize), 8, 32),
		lineHeight: clamp(toNumber(obj.lineHeight, def.lineHeight), 1, 2.4),
		cursorStyle: cursor === 'block' || cursor === 'underline' || cursor === 'bar' ? cursor : def.cursorStyle,
		cursorBlink: obj.cursorBlink !== false,
		scrollback: clamp(Math.floor(toNumber(obj.scrollback, def.scrollback)), 100, 100_000),
		copyOnSelect: Boolean(obj.copyOnSelect),
		rightClickPaste: obj.rightClickPaste !== false,
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
		return normalizeSettings(JSON.parse(raw));
	} catch {
		return defaultTerminalSettings();
	}
}

export function saveTerminalSettings(s: TerminalAppSettings): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
	} catch {
		/* ignore */
	}
}

export function newProfileId(existing: TerminalProfile[]): string {
	let n = existing.length + 1;
	const ids = new Set(existing.map((p) => p.id));
	while (ids.has(`profile-${n}`)) {
		n += 1;
	}
	return `profile-${n}`;
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
