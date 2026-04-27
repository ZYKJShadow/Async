/**
 * captureSessionStore — SQLite-backed persistence for browser capture sessions.
 *
 * The active in-memory session lives in browserCapture.ts and is volatile.
 * This module lets the user "save" the current snapshot into a named record,
 * and "load" a previously-saved record back into memory. We deliberately use
 * a separate database file from the agent session store so the schemas can
 * evolve independently.
 */

import Database from 'better-sqlite3';
import * as path from 'node:path';
import { getCachedAsyncDataDir } from './dataDir.js';
import type {
	BrowserCaptureHookEvent,
	BrowserCaptureRequestDetail,
	BrowserCaptureStorageSnapshot,
} from './browser/browserCapture.js';

let db: Database.Database | null = null;

export type CaptureSessionSummary = {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	requestCount: number;
	hookEventCount: number;
	storageHostCount: number;
	note: string | null;
};

export type CaptureSessionDetail = CaptureSessionSummary & {
	requests: BrowserCaptureRequestDetail[];
	hookEvents: BrowserCaptureHookEvent[];
	storageSnapshots: BrowserCaptureStorageSnapshot[];
};

function getDbPath(): string {
	return path.join(getCachedAsyncDataDir(), 'browser-capture-sessions.db');
}

function init(): Database.Database {
	if (db) {
		return db;
	}
	const instance = new Database(getDbPath());
	instance.pragma('journal_mode = WAL');
	instance.exec(`
		CREATE TABLE IF NOT EXISTS capture_sessions (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			request_count INTEGER DEFAULT 0,
			hook_event_count INTEGER DEFAULT 0,
			storage_host_count INTEGER DEFAULT 0,
			note TEXT,
			requests_json TEXT NOT NULL,
			hooks_json TEXT NOT NULL,
			storage_json TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_capture_sessions_updated ON capture_sessions(updated_at DESC);
	`);
	db = instance;
	return instance;
}

function toSummary(row: Record<string, unknown>): CaptureSessionSummary {
	return {
		id: String(row.id),
		name: String(row.name),
		createdAt: Number(row.created_at),
		updatedAt: Number(row.updated_at),
		requestCount: Number(row.request_count) || 0,
		hookEventCount: Number(row.hook_event_count) || 0,
		storageHostCount: Number(row.storage_host_count) || 0,
		note: row.note == null ? null : String(row.note),
	};
}

export function listCaptureSessions(): CaptureSessionSummary[] {
	const stmt = init().prepare(
		`SELECT id, name, created_at, updated_at, request_count, hook_event_count, storage_host_count, note
		 FROM capture_sessions
		 ORDER BY updated_at DESC`
	);
	const rows = stmt.all() as Record<string, unknown>[];
	return rows.map(toSummary);
}

export function getCaptureSession(id: string): CaptureSessionDetail | null {
	const stmt = init().prepare(
		`SELECT id, name, created_at, updated_at, request_count, hook_event_count, storage_host_count, note,
		        requests_json, hooks_json, storage_json
		 FROM capture_sessions WHERE id = ?`
	);
	const row = stmt.get(id) as Record<string, unknown> | undefined;
	if (!row) {
		return null;
	}
	const summary = toSummary(row);
	return {
		...summary,
		requests: safeParseArray<BrowserCaptureRequestDetail>(row.requests_json),
		hookEvents: safeParseArray<BrowserCaptureHookEvent>(row.hooks_json),
		storageSnapshots: safeParseArray<BrowserCaptureStorageSnapshot>(row.storage_json),
	};
}

export function saveCaptureSession(input: {
	id?: string;
	name: string;
	note?: string | null;
	requests: BrowserCaptureRequestDetail[];
	hookEvents: BrowserCaptureHookEvent[];
	storageSnapshots: BrowserCaptureStorageSnapshot[];
}): CaptureSessionSummary {
	const now = Date.now();
	const id = input.id ?? `cap-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const requestsJson = JSON.stringify(input.requests ?? []);
	const hooksJson = JSON.stringify(input.hookEvents ?? []);
	const storageJson = JSON.stringify(input.storageSnapshots ?? []);
	const requestCount = input.requests?.length ?? 0;
	const hookEventCount = input.hookEvents?.length ?? 0;
	const storageHostCount = input.storageSnapshots?.length ?? 0;
	const note = input.note ?? null;
	const existing = init().prepare('SELECT id, created_at FROM capture_sessions WHERE id = ?').get(id) as
		| { id: string; created_at: number }
		| undefined;
	const createdAt = existing?.created_at ?? now;
	init()
		.prepare(
			`INSERT OR REPLACE INTO capture_sessions
				(id, name, created_at, updated_at, request_count, hook_event_count, storage_host_count, note,
				 requests_json, hooks_json, storage_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			input.name,
			createdAt,
			now,
			requestCount,
			hookEventCount,
			storageHostCount,
			note,
			requestsJson,
			hooksJson,
			storageJson
		);
	return {
		id,
		name: input.name,
		createdAt,
		updatedAt: now,
		requestCount,
		hookEventCount,
		storageHostCount,
		note,
	};
}

export function renameCaptureSession(id: string, name: string, note?: string | null): boolean {
	const stmt = init().prepare(
		`UPDATE capture_sessions SET name = ?, note = ?, updated_at = ? WHERE id = ?`
	);
	const result = stmt.run(name, note ?? null, Date.now(), id);
	return result.changes > 0;
}

export function deleteCaptureSession(id: string): boolean {
	const result = init().prepare('DELETE FROM capture_sessions WHERE id = ?').run(id);
	return result.changes > 0;
}

function safeParseArray<T>(raw: unknown): T[] {
	if (typeof raw !== 'string' || !raw) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as T[]) : [];
	} catch {
		return [];
	}
}
