import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BotSessionState } from './botRuntime.js';

let sessionsPath: string | null = null;
let inMemory: Record<string, BotSessionState> = {};
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

type PersistedBotSessionState = Omit<BotSessionState, 'leaderMessages'> & {
	leaderMessages: BotSessionState['leaderMessages'];
	leaderSummary?: string;
	leaderSummaryCoversCount?: number;
};

export type BotSessionPersistenceKey = {
	integrationId: string;
	conversationKey: string;
};

function keyFor({ integrationId, conversationKey }: BotSessionPersistenceKey): string {
	return `${integrationId}::${conversationKey}`;
}

export function initBotSessionStore(userData: string): void {
	const dir = path.join(userData, 'async');
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch {
		/* ignore */
	}
	sessionsPath = path.join(dir, 'botSessions.json');
	if (fs.existsSync(sessionsPath)) {
		try {
			const raw = fs.readFileSync(sessionsPath, 'utf8');
			const parsed = JSON.parse(raw) as Record<string, PersistedBotSessionState>;
			inMemory = parsed && typeof parsed === 'object' ? parsed : {};
		} catch {
			inMemory = {};
		}
	} else {
		inMemory = {};
	}
}

export function readBotSession(key: BotSessionPersistenceKey): BotSessionState | null {
	const persisted = inMemory[keyFor(key)];
	return persisted ? { ...persisted, leaderMessages: [...(persisted.leaderMessages ?? [])] } : null;
}

export function writeBotSession(key: BotSessionPersistenceKey, session: BotSessionState): void {
	inMemory[keyFor(key)] = {
		...session,
		leaderMessages: [...(session.leaderMessages ?? [])],
	};
	scheduleFlush();
}

export function deleteBotSession(key: BotSessionPersistenceKey): void {
	delete inMemory[keyFor(key)];
	scheduleFlush();
}

export function deleteIntegrationSessions(integrationId: string): void {
	const prefix = `${integrationId}::`;
	let changed = false;
	for (const key of Object.keys(inMemory)) {
		if (key.startsWith(prefix)) {
			delete inMemory[key];
			changed = true;
		}
	}
	if (changed) {
		scheduleFlush();
	}
}

function scheduleFlush(): void {
	dirty = true;
	if (flushTimer) {
		return;
	}
	flushTimer = setTimeout(() => {
		flushTimer = null;
		flushNow();
	}, 200);
}

export function flushBotSessionStore(): void {
	if (!dirty) {
		return;
	}
	flushNow();
}

function flushNow(): void {
	if (!sessionsPath) {
		return;
	}
	try {
		const tmp = `${sessionsPath}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(inMemory, null, 2), 'utf8');
		fs.renameSync(tmp, sessionsPath);
		dirty = false;
	} catch (error) {
		console.warn('[bots] session persist failed', error instanceof Error ? error.message : error);
	}
}
