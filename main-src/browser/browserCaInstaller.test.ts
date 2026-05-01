import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	exec: vi.fn(),
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	platform: vi.fn(),
}));

vi.mock('node:child_process', () => ({
	exec: mocks.exec,
}));

vi.mock('node:fs', () => ({
	existsSync: mocks.existsSync,
	readFileSync: mocks.readFileSync,
}));

vi.mock('node:os', () => ({
	platform: mocks.platform,
}));

import { CaInstaller } from './browserCaInstaller.js';

type ExecCallback = (error: NodeJS.ErrnoException | null, stdout?: string | Buffer, stderr?: string | Buffer) => void;

const certPath = 'C:\\Users\\Tester\\AppData\\Roaming\\Async\\capture-certificates\\async-capture-ca.pem';
const certDer = Buffer.from('async-local-capture-ca');
const certPem = `-----BEGIN CERTIFICATE-----\n${certDer.toString('base64')}\n-----END CERTIFICATE-----\n`;
const certThumbprint = createHash('sha1').update(certDer).digest('hex').toUpperCase();

function notFoundError(): NodeJS.ErrnoException {
	const err = new Error('Cannot find object or property.') as NodeJS.ErrnoException;
	err.code = '1';
	return err;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.platform.mockReturnValue('win32');
	mocks.existsSync.mockReturnValue(false);
	mocks.readFileSync.mockReturnValue(certPem);
});

describe('CaInstaller on Windows', () => {
	it('does not invoke addstore when the current CA certificate is already trusted', async () => {
		mocks.exec.mockImplementation((cmd: string, _options: unknown, cb: ExecCallback) => {
			if (cmd === `certutil -user -store Root ${certThumbprint}`) {
				cb(null, `Cert Hash(sha1): ${certThumbprint}`, '');
				return {};
			}
			cb(notFoundError(), '', 'not found');
			return {};
		});

		const result = await CaInstaller.install(certPath, 'user');

		expect(result).toEqual({ ok: true });
		expect(mocks.exec).toHaveBeenCalledTimes(1);
		expect(mocks.exec.mock.calls.some(([cmd]) => String(cmd).includes('-addstore'))).toBe(false);
	});

	it('checks both user and machine root stores by the current certificate thumbprint', async () => {
		mocks.exec.mockImplementation((cmd: string, _options: unknown, cb: ExecCallback) => {
			if (cmd === `certutil -store Root ${certThumbprint}`) {
				cb(null, `Cert Hash(sha1): ${certThumbprint.match(/../g)?.join(' ') ?? certThumbprint}`, '');
				return {};
			}
			cb(notFoundError(), '', 'not found');
			return {};
		});

		const installed = await CaInstaller.isInstalled(certPath);

		expect(installed).toBe(true);
		expect(mocks.exec.mock.calls.map(([cmd]) => cmd)).toEqual([
			`certutil -user -store Root ${certThumbprint}`,
			`certutil -store Root ${certThumbprint}`,
		]);
	});

	it('falls back to a correctly ordered friendly-name query when the CA file is unavailable', async () => {
		mocks.readFileSync.mockImplementation(() => {
			throw new Error('missing file');
		});
		mocks.exec.mockImplementation((cmd: string, _options: unknown, cb: ExecCallback) => {
			if (cmd === 'certutil -user -store Root "Async IDE Local Capture Root"') {
				cb(null, 'Subject: CN=Async IDE Local Capture Root', '');
				return {};
			}
			cb(notFoundError(), '', 'not found');
			return {};
		});

		const installed = await CaInstaller.isInstalled(certPath);

		expect(installed).toBe(true);
		expect(mocks.exec.mock.calls.map(([cmd]) => cmd)).toEqual([
			'certutil -user -store Root "Async IDE Local Capture Root"',
		]);
	});

	it('runs the Windows trust prompt only when the exact CA certificate is not installed', async () => {
		mocks.exec.mockImplementation((cmd: string, _options: unknown, cb: ExecCallback) => {
			if (String(cmd).includes('-addstore')) {
				cb(null, 'CertUtil: -addstore command completed successfully.', '');
				return {};
			}
			cb(notFoundError(), '', 'not found');
			return {};
		});

		const result = await CaInstaller.install(certPath, 'user');

		expect(result).toEqual({ ok: true });
		expect(mocks.exec.mock.calls.map(([cmd]) => cmd)).toContain(`certutil -user -addstore Root "${certPath}"`);
	});
});
