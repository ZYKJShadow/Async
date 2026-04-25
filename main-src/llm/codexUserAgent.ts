// Mirrors codex-rs/login/src/auth/default_client.rs::get_codex_user_agent
// and codex-rs/terminal-detection/src/lib.rs::user_agent.
//
// Format: `<originator>/<version> (<os_type> <os_version>; <arch>) <terminal_token>`
//
// Goal: completely align with the upstream Codex CLI so requests we send under
// the Codex identity preset are byte-for-byte indistinguishable from a real
// `codex-rs` client running on the same OS/terminal. Anything we can't read
// from the runtime is replaced with `unknown`, which is what the Rust crate
// `os_info` does on platforms where it can't introspect.

import os from 'node:os';
import { execFileSync } from 'node:child_process';

import { CODEX_ORIGINATOR } from '../../src/providerIdentitySettings.js';

function osType(): string {
	switch (process.platform) {
		case 'darwin':
			return 'Mac OS';
		case 'linux':
			return 'Linux';
		case 'win32':
			return 'Windows';
		case 'freebsd':
			return 'FreeBSD';
		case 'openbsd':
			return 'OpenBSD';
		case 'netbsd':
			return 'NetBSD';
		case 'sunos':
			return 'Solaris';
		case 'aix':
			return 'AIX';
		default:
			return 'Unknown';
	}
}

function osVersion(): string {
	const release = os.release().trim();
	return release || 'Unknown';
}

function architecture(): string {
	switch (process.arch) {
		case 'x64':
			return 'x86_64';
		case 'ia32':
			return 'x86';
		case 'arm64':
			return 'aarch64';
		case 'arm':
			return 'arm';
		default:
			return process.arch || 'unknown';
	}
}

// --- Terminal detection (mirrors codex-rs/terminal-detection/src/lib.rs) ---

type TerminalName =
	| 'AppleTerminal'
	| 'Ghostty'
	| 'Iterm2'
	| 'WarpTerminal'
	| 'VsCode'
	| 'WezTerm'
	| 'Kitty'
	| 'Alacritty'
	| 'Konsole'
	| 'GnomeTerminal'
	| 'Vte'
	| 'WindowsTerminal'
	| 'Dumb'
	| 'Unknown';

type TerminalInfo = {
	name: TerminalName;
	termProgram?: string;
	version?: string;
	term?: string;
};

function envNonEmpty(name: string): string | undefined {
	const v = process.env[name];
	if (v === undefined) return undefined;
	return v.trim() ? v : undefined;
}

function envHas(name: string): boolean {
	return process.env[name] !== undefined;
}

function terminalNameFromTermProgram(value: string): TerminalName | undefined {
	const normalized = value
		.trim()
		.split('')
		.filter((c) => c !== ' ' && c !== '-' && c !== '_' && c !== '.')
		.join('')
		.toLowerCase();
	switch (normalized) {
		case 'appleterminal':
			return 'AppleTerminal';
		case 'ghostty':
			return 'Ghostty';
		case 'iterm':
		case 'iterm2':
		case 'itermapp':
			return 'Iterm2';
		case 'warp':
		case 'warpterminal':
			return 'WarpTerminal';
		case 'vscode':
			return 'VsCode';
		case 'wezterm':
			return 'WezTerm';
		case 'kitty':
			return 'Kitty';
		case 'alacritty':
			return 'Alacritty';
		case 'konsole':
			return 'Konsole';
		case 'gnometerminal':
			return 'GnomeTerminal';
		case 'vte':
			return 'Vte';
		case 'windowsterminal':
			return 'WindowsTerminal';
		case 'dumb':
			return 'Dumb';
		default:
			return undefined;
	}
}

function tmuxClientTermtype(): { termtype?: string; termname?: string } {
	const read = (fmt: string): string | undefined => {
		try {
			const out = execFileSync('tmux', ['display-message', '-p', fmt], {
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: 250,
			})
				.toString('utf8')
				.trim();
			return out || undefined;
		} catch {
			return undefined;
		}
	};
	return { termtype: read('#{client_termtype}'), termname: read('#{client_termname}') };
}

function detectTerminalInfo(): TerminalInfo {
	const termProgram = envNonEmpty('TERM_PROGRAM');

	if (termProgram) {
		const isTmux = termProgram.toLowerCase() === 'tmux';
		if (isTmux && (envNonEmpty('TMUX') || envNonEmpty('TMUX_PANE'))) {
			const { termtype, termname } = tmuxClientTermtype();
			if (termtype) {
				const [program, version] = termtype.split(/\s+/, 2);
				const name = terminalNameFromTermProgram(program) ?? 'Unknown';
				return { name, termProgram: program, version, term: termname };
			}
			if (termname) {
				return { name: termname === 'dumb' ? 'Dumb' : 'Unknown', term: termname };
			}
		}
		const version = envNonEmpty('TERM_PROGRAM_VERSION');
		const name = terminalNameFromTermProgram(termProgram) ?? 'Unknown';
		return { name, termProgram, version };
	}

	if (envHas('WEZTERM_VERSION')) {
		return { name: 'WezTerm', version: envNonEmpty('WEZTERM_VERSION') };
	}
	if (envHas('ITERM_SESSION_ID') || envHas('ITERM_PROFILE') || envHas('ITERM_PROFILE_NAME')) {
		return { name: 'Iterm2' };
	}
	if (envHas('TERM_SESSION_ID')) {
		return { name: 'AppleTerminal' };
	}
	const term = envNonEmpty('TERM');
	if (envHas('KITTY_WINDOW_ID') || (term && term.includes('kitty'))) {
		return { name: 'Kitty' };
	}
	if (envHas('ALACRITTY_SOCKET') || term === 'alacritty') {
		return { name: 'Alacritty' };
	}
	if (envHas('KONSOLE_VERSION')) {
		return { name: 'Konsole', version: envNonEmpty('KONSOLE_VERSION') };
	}
	if (envHas('GNOME_TERMINAL_SCREEN')) {
		return { name: 'GnomeTerminal' };
	}
	if (envHas('VTE_VERSION')) {
		return { name: 'Vte', version: envNonEmpty('VTE_VERSION') };
	}
	if (envHas('WT_SESSION')) {
		return { name: 'WindowsTerminal' };
	}
	if (term) {
		return { name: term === 'dumb' ? 'Dumb' : 'Unknown', term };
	}
	return { name: 'Unknown' };
}

function formatTerminalVersion(name: string, version?: string): string {
	return version && version.length > 0 ? `${name}/${version}` : name;
}

function isValidHeaderValueChar(c: string): boolean {
	return /[A-Za-z0-9\-_./]/.test(c);
}

function sanitizeHeaderValue(value: string): string {
	let out = '';
	for (const c of value) {
		out += isValidHeaderValueChar(c) ? c : '_';
	}
	return out;
}

function terminalUserAgentToken(info: TerminalInfo): string {
	let raw: string;
	if (info.termProgram) {
		raw = info.version && info.version.length > 0
			? `${info.termProgram}/${info.version}`
			: info.termProgram;
	} else if (info.term && info.term.length > 0) {
		raw = info.term;
	} else {
		switch (info.name) {
			case 'AppleTerminal':
				raw = formatTerminalVersion('Apple_Terminal', info.version);
				break;
			case 'Ghostty':
				raw = formatTerminalVersion('Ghostty', info.version);
				break;
			case 'Iterm2':
				raw = formatTerminalVersion('iTerm.app', info.version);
				break;
			case 'WarpTerminal':
				raw = formatTerminalVersion('WarpTerminal', info.version);
				break;
			case 'VsCode':
				raw = formatTerminalVersion('vscode', info.version);
				break;
			case 'WezTerm':
				raw = formatTerminalVersion('WezTerm', info.version);
				break;
			case 'Kitty':
				raw = 'kitty';
				break;
			case 'Alacritty':
				raw = 'Alacritty';
				break;
			case 'Konsole':
				raw = formatTerminalVersion('Konsole', info.version);
				break;
			case 'GnomeTerminal':
				raw = 'gnome-terminal';
				break;
			case 'Vte':
				raw = formatTerminalVersion('VTE', info.version);
				break;
			case 'WindowsTerminal':
				raw = 'WindowsTerminal';
				break;
			case 'Dumb':
				raw = 'dumb';
				break;
			default:
				raw = 'unknown';
		}
	}
	return sanitizeHeaderValue(raw);
}

let cachedTerminalToken: string | null = null;
function terminalUserAgentTokenCached(): string {
	if (cachedTerminalToken === null) {
		cachedTerminalToken = terminalUserAgentToken(detectTerminalInfo());
	}
	return cachedTerminalToken;
}

/**
 * Build the Codex User-Agent string using the same recipe as
 * `codex-rs/login/src/auth/default_client.rs::get_codex_user_agent`.
 *
 * The `originator` token is `CODEX_ORIGINATOR` (mirrors `DEFAULT_ORIGINATOR`).
 */
export function buildCodexUserAgent(buildVersion: string): string {
	const candidate = `${CODEX_ORIGINATOR}/${buildVersion} (${osType()} ${osVersion()}; ${architecture()}) ${terminalUserAgentTokenCached()}`;
	// reqwest validates header value bytes; sanitize the same way the upstream does
	// before falling back to the bare originator on failure.
	const sanitized = candidate
		.split('')
		.map((c) => (c >= ' ' && c <= '~' ? c : '_'))
		.join('');
	return sanitized;
}
