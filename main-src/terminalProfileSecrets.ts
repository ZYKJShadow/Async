import { app, safeStorage } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

type SecretStoreShape = {
	passwords?: Record<string, string>;
};

const runtimePasswords = new Map<string, string>();

function getSecretsFilePath(): string {
	return path.join(app.getPath('userData'), 'async', 'terminal-profile-secrets.json');
}

function readSecretStore(): SecretStoreShape {
	const filePath = getSecretsFilePath();
	if (!existsSync(filePath)) {
		return {};
	}
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as SecretStoreShape;
	} catch {
		return {};
	}
}

function writeSecretStore(store: SecretStoreShape): void {
	const filePath = getSecretsFilePath();
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}

function encodeSecret(secret: string): string {
	try {
		if (safeStorage.isEncryptionAvailable()) {
			return `safe:${safeStorage.encryptString(secret).toString('base64')}`;
		}
	} catch {
		/* fall back */
	}
	return `plain:${Buffer.from(secret, 'utf8').toString('base64')}`;
}

function decodeSecret(encoded: string): string | null {
	try {
		if (encoded.startsWith('safe:')) {
			const buffer = Buffer.from(encoded.slice(5), 'base64');
			return safeStorage.decryptString(buffer);
		}
		if (encoded.startsWith('plain:')) {
			return Buffer.from(encoded.slice(6), 'base64').toString('utf8');
		}
		return Buffer.from(encoded, 'base64').toString('utf8');
	} catch {
		return null;
	}
}

export function hasTerminalProfilePassword(profileId: string): boolean {
	if (!profileId.trim()) {
		return false;
	}
	const store = readSecretStore();
	return Boolean(store.passwords?.[profileId]);
}

export function getTerminalProfilePassword(profileId: string): string | null {
	if (!profileId.trim()) {
		return null;
	}
	const runtime = runtimePasswords.get(profileId);
	if (runtime) {
		return runtime;
	}
	const encoded = readSecretStore().passwords?.[profileId];
	return encoded ? decodeSecret(encoded) : null;
}

export function setTerminalProfileRuntimePassword(profileId: string, password: string): boolean {
	if (!profileId.trim() || !password) {
		return false;
	}
	runtimePasswords.set(profileId, password);
	return true;
}

export function setTerminalProfilePassword(profileId: string, password: string): boolean {
	if (!profileId.trim() || !password) {
		return false;
	}
	runtimePasswords.set(profileId, password);
	const store = readSecretStore();
	store.passwords = {
		...(store.passwords || {}),
		[profileId]: encodeSecret(password),
	};
	writeSecretStore(store);
	return true;
}

export function clearTerminalProfilePassword(profileId: string): boolean {
	if (!profileId.trim()) {
		return false;
	}
	runtimePasswords.delete(profileId);
	const store = readSecretStore();
	if (!store.passwords?.[profileId]) {
		return false;
	}
	delete store.passwords[profileId];
	writeSecretStore(store);
	return true;
}
