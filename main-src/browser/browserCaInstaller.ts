import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { platform } from 'node:os';

export type CaInstallResult = { ok: true } | { ok: false; error: string };
export type CaInstallScope = 'user' | 'machine';

const ASYNC_CA_FRIENDLY_NAME = 'Async IDE Local Capture Root';
const ASYNC_LINUX_DEST = '/usr/local/share/ca-certificates/async-ide-capture-ca.crt';

type ExecResult = { stdout: string; stderr: string; code: number | null };

function execPromise(cmd: string, timeoutMs = 30_000): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
			if (err) {
				const msg = stderr?.toString().trim() || err.message;
				reject(new Error(msg));
				return;
			}
			resolve((stdout ?? '').toString());
		});
	});
}

function execCapture(cmd: string, timeoutMs = 30_000): Promise<ExecResult> {
	return new Promise((resolve) => {
		exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
			resolve({
				stdout: (stdout ?? '').toString(),
				stderr: (stderr ?? '').toString(),
				code: err && typeof (err as NodeJS.ErrnoException).code === 'number' ? ((err as NodeJS.ErrnoException).code as unknown as number) : err ? 1 : 0,
			});
		});
	});
}

function quoteCmdArg(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

function normalizeSha1(raw: string): string {
	return raw.replace(/[^0-9a-f]/gi, '').toUpperCase();
}

function readPemSha1(certPath: string | undefined): string | null {
	if (!certPath) {
		return null;
	}
	try {
		const raw = readFileSync(certPath);
		const text = raw.toString('utf8');
		const match = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(text);
		const body = (match?.[1] ?? text).replace(/[^A-Za-z0-9+/=]/g, '');
		if (!body) {
			return null;
		}
		return createHash('sha1').update(Buffer.from(body, 'base64')).digest('hex').toUpperCase();
	} catch {
		return null;
	}
}

async function sudoExec(cmd: string): Promise<void> {
	const sudo = (await import('@vscode/sudo-prompt')) as typeof import('@vscode/sudo-prompt');
	await new Promise<void>((resolve, reject) => {
		sudo.exec(cmd, { name: 'Async IDE' }, (err?: Error, _stdout?: string | Buffer, stderr?: string | Buffer) => {
			if (err) {
				const message = (stderr ? stderr.toString().trim() : '') || err.message;
				reject(new Error(message));
				return;
			}
			resolve();
		});
	});
}

async function isWindowsCertIdInStore(scope: CaInstallScope, certId: string): Promise<boolean> {
	const flag = scope === 'user' ? '-user ' : '';
	const result = await execCapture(`certutil ${flag}-store Root ${certId}`.replace(/\s+/g, ' '));
	return result.code === 0;
}

async function isWindowsThumbprintInStore(scope: CaInstallScope, thumbprint: string): Promise<boolean> {
	const result = await execCapture(`certutil ${scope === 'user' ? '-user ' : ''}-store Root ${thumbprint}`.replace(/\s+/g, ' '));
	return result.code === 0 && normalizeSha1(result.stdout).includes(thumbprint);
}

async function isNamedWindowsCertInStore(scope: CaInstallScope): Promise<boolean> {
	const result = await execCapture(
		`certutil ${scope === 'user' ? '-user ' : ''}-store Root ${quoteCmdArg(ASYNC_CA_FRIENDLY_NAME)}`.replace(/\s+/g, ' ')
	);
	return result.stdout.includes(ASYNC_CA_FRIENDLY_NAME);
}

async function isInstalledWindows(certPath?: string): Promise<boolean> {
	const thumbprint = readPemSha1(certPath);
	if (thumbprint) {
		if (await isWindowsThumbprintInStore('user', thumbprint)) {
			return true;
		}
		return await isWindowsThumbprintInStore('machine', thumbprint);
	}
	if (await isNamedWindowsCertInStore('user')) {
		return true;
	}
	return await isNamedWindowsCertInStore('machine');
}

async function installWindows(certPath: string, scope: CaInstallScope): Promise<void> {
	if (await isInstalledWindows(certPath)) {
		return;
	}
	if (scope === 'user') {
		// User-store install. Windows will show the standard "do you want to trust this CA?" dialog.
		// If the user declines or the command otherwise fails, surface the error — do NOT silently
		// escalate to a UAC machine-store install (that produces the surprise double-prompt).
		await execPromise(`certutil -user -addstore Root ${quoteCmdArg(certPath)}`);
		return;
	}
	await sudoExec(`certutil -addstore Root ${quoteCmdArg(certPath)}`);
}

async function uninstallWindows(certPath: string | undefined, scope: CaInstallScope): Promise<void> {
	const certId = readPemSha1(certPath) ?? quoteCmdArg(ASYNC_CA_FRIENDLY_NAME);
	if (scope === 'user') {
		if (!(await isWindowsCertIdInStore('user', certId))) {
			return;
		}
		await execPromise(`certutil -user -delstore Root ${certId}`);
		return;
	}
	if (!(await isWindowsCertIdInStore('machine', certId))) {
		return;
	}
	await sudoExec(`certutil -delstore Root ${certId}`);
}

async function isInstalledMacOS(): Promise<boolean> {
	try {
		const out = await execPromise(
			`security find-certificate -c "${ASYNC_CA_FRIENDLY_NAME}" /Library/Keychains/System.keychain`
		);
		return out.includes(ASYNC_CA_FRIENDLY_NAME);
	} catch {
		// Fallback to user keychain.
		try {
			const out = await execPromise(`security find-certificate -c "${ASYNC_CA_FRIENDLY_NAME}"`);
			return out.includes(ASYNC_CA_FRIENDLY_NAME);
		} catch {
			return false;
		}
	}
}

async function installMacOS(certPath: string, scope: CaInstallScope): Promise<void> {
	if (scope === 'user') {
		// Add to login keychain without sudo. Trust settings still require user approval via
		// the security UI, but we never silently elevate.
		await execPromise(
			`security add-trusted-cert -r trustRoot -k "$HOME/Library/Keychains/login.keychain-db" "${certPath}"`
		);
		return;
	}
	await sudoExec(
		`security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`
	);
}

async function uninstallMacOS(certPath: string, scope: CaInstallScope): Promise<void> {
	if (scope === 'user') {
		await execPromise(`security remove-trusted-cert "${certPath}"`).catch(() => {
			/* missing cert is not an error */
		});
		return;
	}
	await sudoExec(`security remove-trusted-cert -d "${certPath}"`);
}

async function isInstalledLinux(): Promise<boolean> {
	return existsSync(ASYNC_LINUX_DEST);
}

async function installLinux(certPath: string, _scope: CaInstallScope): Promise<void> {
	// Linux only supports system-wide CA trust; ignore scope here.
	await sudoExec(`cp "${certPath}" "${ASYNC_LINUX_DEST}" && update-ca-certificates`);
}

async function uninstallLinux(_scope: CaInstallScope): Promise<void> {
	if (!existsSync(ASYNC_LINUX_DEST)) {
		return;
	}
	await sudoExec(`rm -f "${ASYNC_LINUX_DEST}" && update-ca-certificates --fresh`);
}

export const CaInstaller = {
	async isInstalled(certPath?: string): Promise<boolean> {
		const os = platform();
		if (os === 'win32') {
			return await isInstalledWindows(certPath);
		}
		if (os === 'darwin') {
			return await isInstalledMacOS();
		}
		return await isInstalledLinux();
	},

	async install(certPath: string, scope: CaInstallScope = 'user'): Promise<CaInstallResult> {
		try {
			const os = platform();
			if (os === 'win32') {
				await installWindows(certPath, scope);
			} else if (os === 'darwin') {
				await installMacOS(certPath, scope);
			} else {
				await installLinux(certPath, scope);
			}
			return { ok: true };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	},

	async uninstall(certPath: string, scope: CaInstallScope = 'user'): Promise<CaInstallResult> {
		try {
			const os = platform();
			if (os === 'win32') {
				await uninstallWindows(certPath, scope);
			} else if (os === 'darwin') {
				await uninstallMacOS(certPath, scope);
			} else {
				await uninstallLinux(scope);
			}
			return { ok: true };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	},
};
