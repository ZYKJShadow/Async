import { exec } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import * as path from 'node:path';
import { app } from 'electron';

/**
 * SystemProxy — Toggle the user-level OS HTTP/HTTPS proxy so traffic from
 * non-browser apps flows through the local MITM proxy.
 *
 * Restoration state is persisted to disk so an unexpected app exit still
 * lets the user recover their original proxy settings on next launch.
 */

export type SystemProxyResult = { ok: true } | { ok: false; error: string };

type SavedState =
	| { platform: 'win32'; enable: string; server: string; override: string; capturedAt: number }
	| { platform: 'darwin'; service: string; capturedAt: number }
	| { platform: 'linux'; mode: string; httpHost: string; httpPort: string; httpsHost: string; httpsPort: string; capturedAt: number };

const STATE_FILENAME = 'browser-system-proxy-state.json';

function execPromise(cmd: string, timeoutMs = 10_000): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
			if (err) {
				const message = stderr?.toString().trim() || err.message;
				reject(new Error(message));
				return;
			}
			resolve((stdout ?? '').toString().trim());
		});
	});
}

function stateFilePath(): string {
	return path.join(app.getPath('userData'), STATE_FILENAME);
}

function readSavedState(): SavedState | null {
	try {
		const raw = readFileSync(stateFilePath(), 'utf-8');
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && typeof parsed.platform === 'string') {
			return parsed as SavedState;
		}
	} catch {
		/* ignore */
	}
	return null;
}

function writeSavedState(state: SavedState): void {
	try {
		const dir = path.dirname(stateFilePath());
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(stateFilePath(), JSON.stringify(state, null, 2), 'utf-8');
	} catch {
		/* ignore */
	}
}

function clearSavedState(): void {
	try {
		writeFileSync(stateFilePath(), '', 'utf-8');
	} catch {
		/* ignore */
	}
}

const WIN_REG_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

async function refreshWinInet(): Promise<void> {
	// Notify the system that proxy settings have changed.
	const psSig =
		"$sig='[DllImport(\\\"wininet.dll\\\")]public static extern bool InternetSetOption(IntPtr a,int b,IntPtr c,int d);';" +
		"$type=Add-Type -MemberDefinition $sig -Name AsyncWinInet -PassThru;" +
		"$type::InternetSetOption(0,39,0,0); $type::InternetSetOption(0,37,0,0)";
	await execPromise(`powershell -NoProfile -Command "${psSig}"`).catch(() => {
		/* notification failure is non-fatal */
	});
}

async function readWindowsValue(name: string): Promise<string> {
	try {
		const out = await execPromise(`reg query "${WIN_REG_PATH}" /v ${name}`);
		// Parse trailing value off "    ProxyEnable    REG_DWORD    0x1"
		const match = out.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith(name));
		if (!match) {
			return '';
		}
		const parts = match.split(/\s+/);
		return parts.slice(2).join(' ');
	} catch {
		return '';
	}
}

async function captureWindowsState(): Promise<void> {
	const enable = await readWindowsValue('ProxyEnable');
	const server = await readWindowsValue('ProxyServer');
	const override = await readWindowsValue('ProxyOverride');
	writeSavedState({ platform: 'win32', enable, server, override, capturedAt: Date.now() });
}

async function enableWindows(host: string, port: number): Promise<void> {
	await captureWindowsState();
	const target = `${host}:${port}`;
	await execPromise(`reg add "${WIN_REG_PATH}" /v ProxyEnable /t REG_DWORD /d 1 /f`);
	await execPromise(`reg add "${WIN_REG_PATH}" /v ProxyServer /t REG_SZ /d "${target}" /f`);
	await execPromise(
		`reg add "${WIN_REG_PATH}" /v ProxyOverride /t REG_SZ /d "localhost;127.0.0.1;<local>" /f`
	);
	await refreshWinInet();
}

async function disableWindows(): Promise<void> {
	const saved = readSavedState();
	if (saved && saved.platform === 'win32') {
		const enableValue = saved.enable.toLowerCase().includes('0x1') ? 1 : 0;
		await execPromise(`reg add "${WIN_REG_PATH}" /v ProxyEnable /t REG_DWORD /d ${enableValue} /f`);
		if (saved.server) {
			await execPromise(`reg add "${WIN_REG_PATH}" /v ProxyServer /t REG_SZ /d "${saved.server}" /f`);
		} else {
			await execPromise(`reg delete "${WIN_REG_PATH}" /v ProxyServer /f`).catch(() => {});
		}
		if (saved.override) {
			await execPromise(`reg add "${WIN_REG_PATH}" /v ProxyOverride /t REG_SZ /d "${saved.override}" /f`);
		} else {
			await execPromise(`reg delete "${WIN_REG_PATH}" /v ProxyOverride /f`).catch(() => {});
		}
	} else {
		await execPromise(`reg add "${WIN_REG_PATH}" /v ProxyEnable /t REG_DWORD /d 0 /f`);
	}
	await refreshWinInet();
	clearSavedState();
}

async function isEnabledWindows(host: string, port: number): Promise<boolean> {
	const enable = await readWindowsValue('ProxyEnable');
	const server = await readWindowsValue('ProxyServer');
	if (!enable.toLowerCase().includes('0x1')) {
		return false;
	}
	return server.includes(`${host}:${port}`) || server.includes(`localhost:${port}`) || server.includes(`127.0.0.1:${port}`);
}

async function getActiveMacService(): Promise<string> {
	const services = await execPromise('networksetup -listallnetworkservices').catch(() => '');
	const lines = services.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.includes('asterisk denotes'));
	for (const candidate of ['Wi-Fi', 'Ethernet']) {
		if (lines.includes(candidate)) {
			return candidate;
		}
	}
	return lines[0] ?? 'Wi-Fi';
}

async function enableMacOS(host: string, port: number): Promise<void> {
	const service = await getActiveMacService();
	writeSavedState({ platform: 'darwin', service, capturedAt: Date.now() });
	await execPromise(`networksetup -setwebproxy "${service}" ${host} ${port}`);
	await execPromise(`networksetup -setsecurewebproxy "${service}" ${host} ${port}`);
	await execPromise(`networksetup -setproxybypassdomains "${service}" localhost 127.0.0.1`);
}

async function disableMacOS(): Promise<void> {
	const saved = readSavedState();
	const service = saved && saved.platform === 'darwin' ? saved.service : await getActiveMacService();
	await execPromise(`networksetup -setwebproxystate "${service}" off`).catch(() => {});
	await execPromise(`networksetup -setsecurewebproxystate "${service}" off`).catch(() => {});
	clearSavedState();
}

async function isEnabledMacOS(host: string, port: number): Promise<boolean> {
	const service = await getActiveMacService();
	const out = await execPromise(`networksetup -getwebproxy "${service}"`).catch(() => '');
	return out.includes('Enabled: Yes') && out.includes(`Port: ${port}`) && (out.includes(`Server: ${host}`) || out.includes('Server: localhost') || out.includes('Server: 127.0.0.1'));
}

async function gsettingsGet(key: string): Promise<string> {
	return execPromise(`gsettings get ${key}`).catch(() => '');
}

async function enableLinux(host: string, port: number): Promise<void> {
	const mode = await gsettingsGet('org.gnome.system.proxy mode');
	const httpHost = await gsettingsGet('org.gnome.system.proxy.http host');
	const httpPort = await gsettingsGet('org.gnome.system.proxy.http port');
	const httpsHost = await gsettingsGet('org.gnome.system.proxy.https host');
	const httpsPort = await gsettingsGet('org.gnome.system.proxy.https port');
	writeSavedState({ platform: 'linux', mode, httpHost, httpPort, httpsHost, httpsPort, capturedAt: Date.now() });
	await execPromise(`gsettings set org.gnome.system.proxy mode 'manual'`);
	await execPromise(`gsettings set org.gnome.system.proxy.http host '${host}'`);
	await execPromise(`gsettings set org.gnome.system.proxy.http port ${port}`);
	await execPromise(`gsettings set org.gnome.system.proxy.https host '${host}'`);
	await execPromise(`gsettings set org.gnome.system.proxy.https port ${port}`);
	await execPromise(
		`gsettings set org.gnome.system.proxy ignore-hosts "['localhost', '127.0.0.1', '::1']"`
	);
}

async function disableLinux(): Promise<void> {
	const saved = readSavedState();
	if (saved && saved.platform === 'linux') {
		await execPromise(`gsettings set org.gnome.system.proxy mode ${saved.mode || "'none'"}`).catch(() => {});
		if (saved.httpHost) {
			await execPromise(`gsettings set org.gnome.system.proxy.http host ${saved.httpHost}`).catch(() => {});
		}
		if (saved.httpPort) {
			await execPromise(`gsettings set org.gnome.system.proxy.http port ${saved.httpPort}`).catch(() => {});
		}
		if (saved.httpsHost) {
			await execPromise(`gsettings set org.gnome.system.proxy.https host ${saved.httpsHost}`).catch(() => {});
		}
		if (saved.httpsPort) {
			await execPromise(`gsettings set org.gnome.system.proxy.https port ${saved.httpsPort}`).catch(() => {});
		}
	} else {
		await execPromise(`gsettings set org.gnome.system.proxy mode 'none'`).catch(() => {});
	}
	clearSavedState();
}

async function isEnabledLinux(host: string, _port: number): Promise<boolean> {
	const mode = await gsettingsGet('org.gnome.system.proxy mode');
	const httpHost = await gsettingsGet('org.gnome.system.proxy.http host');
	return mode.includes('manual') && httpHost.includes(host);
}

export const SystemProxy = {
	async enable(host: string, port: number): Promise<SystemProxyResult> {
		try {
			const os = platform();
			if (os === 'win32') {
				await enableWindows(host, port);
			} else if (os === 'darwin') {
				await enableMacOS(host, port);
			} else {
				await enableLinux(host, port);
			}
			return { ok: true };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	},

	async disable(): Promise<SystemProxyResult> {
		try {
			const os = platform();
			if (os === 'win32') {
				await disableWindows();
			} else if (os === 'darwin') {
				await disableMacOS();
			} else {
				await disableLinux();
			}
			return { ok: true };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	},

	async isEnabled(host: string, port: number): Promise<boolean> {
		try {
			const os = platform();
			if (os === 'win32') {
				return await isEnabledWindows(host, port);
			}
			if (os === 'darwin') {
				return await isEnabledMacOS(host, port);
			}
			return await isEnabledLinux(host, port);
		} catch {
			return false;
		}
	},

	hasSavedState(): boolean {
		return readSavedState() !== null;
	},
};
