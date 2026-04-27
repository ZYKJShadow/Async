import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';

export type CaInstallResult = { ok: true } | { ok: false; error: string };

const ASYNC_CA_FRIENDLY_NAME = 'Async IDE Local Capture Root';
const ASYNC_LINUX_DEST = '/usr/local/share/ca-certificates/async-ide-capture-ca.crt';

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

async function isInstalledWindows(): Promise<boolean> {
	try {
		const out = await execPromise(`certutil -store -user Root "${ASYNC_CA_FRIENDLY_NAME}"`).catch(async () => {
			return await execPromise(`certutil -store Root "${ASYNC_CA_FRIENDLY_NAME}"`);
		});
		return out.includes(ASYNC_CA_FRIENDLY_NAME);
	} catch {
		return false;
	}
}

async function installWindows(certPath: string): Promise<void> {
	// Try the user store first (no UAC needed). Fall back to elevated machine root.
	try {
		await execPromise(`certutil -user -addstore Root "${certPath}"`);
		return;
	} catch {
		/* fall through to elevated install */
	}
	await sudoExec(`certutil -addstore Root "${certPath}"`);
}

async function uninstallWindows(): Promise<void> {
	try {
		await execPromise(`certutil -user -delstore Root "${ASYNC_CA_FRIENDLY_NAME}"`);
		return;
	} catch {
		/* fall through to elevated remove */
	}
	await sudoExec(`certutil -delstore Root "${ASYNC_CA_FRIENDLY_NAME}"`);
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

async function installMacOS(certPath: string): Promise<void> {
	await sudoExec(
		`security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`
	);
}

async function uninstallMacOS(certPath: string): Promise<void> {
	await sudoExec(`security remove-trusted-cert -d "${certPath}"`);
}

async function isInstalledLinux(): Promise<boolean> {
	return existsSync(ASYNC_LINUX_DEST);
}

async function installLinux(certPath: string): Promise<void> {
	await sudoExec(`cp "${certPath}" "${ASYNC_LINUX_DEST}" && update-ca-certificates`);
}

async function uninstallLinux(): Promise<void> {
	await sudoExec(`rm -f "${ASYNC_LINUX_DEST}" && update-ca-certificates --fresh`);
}

export const CaInstaller = {
	async isInstalled(): Promise<boolean> {
		const os = platform();
		if (os === 'win32') {
			return await isInstalledWindows();
		}
		if (os === 'darwin') {
			return await isInstalledMacOS();
		}
		return await isInstalledLinux();
	},

	async install(certPath: string): Promise<CaInstallResult> {
		try {
			const os = platform();
			if (os === 'win32') {
				await installWindows(certPath);
			} else if (os === 'darwin') {
				await installMacOS(certPath);
			} else {
				await installLinux(certPath);
			}
			return { ok: true };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	},

	async uninstall(certPath: string): Promise<CaInstallResult> {
		try {
			const os = platform();
			if (os === 'win32') {
				await uninstallWindows();
			} else if (os === 'darwin') {
				await uninstallMacOS(certPath);
			} else {
				await uninstallLinux();
			}
			return { ok: true };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	},
};
