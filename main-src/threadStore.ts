import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveAsyncDataDir } from './dataDir.js';
import { appendSuffixToStructuredAssistant, isStructuredAssistantMessage } from '../src/agentStructuredMessage.js';

export type ChatMessage = {
	role: 'user' | 'assistant' | 'system';
	content: string;
};

export type ThreadTokenUsage = {
	totalInput: number;
	totalOutput: number;
};

export type FileStateAction = 'created' | 'modified' | 'deleted';

export type FileState = {
	action: FileStateAction;
	firstTouchedAt: number;
	touchCount: number;
};

export type TeamSessionSnapshotTask = {
	id: string;
	expertId: string;
	expertAssignmentKey?: string;
	expertName: string;
	roleType: string;
	description: string;
	status: string;
	dependencies: string[];
	acceptanceCriteria: string[];
	result?: string;
};

export type TeamSessionSnapshot = {
	phase: 'researching' | 'planning' | 'executing' | 'reviewing' | 'delivering';
	tasks: TeamSessionSnapshotTask[];
	planSummary: string;
	leaderMessage: string;
	reviewSummary: string;
	reviewVerdict: 'approved' | 'revision_needed' | null;
};

export type ThreadRecord = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
	tokenUsage?: ThreadTokenUsage;
	fileStates?: Record<string, FileState>;
	summary?: string;
	summaryCoversMessageCount?: number;
	memoryExtractedMessageCount?: number;
/** Agent/Plan 对话中已完成的工具调用次数（用于记忆抽取阈值） */
	agentToolCallsCompleted?: number;
	/** 上次记忆抽取完成时的 `agentToolCallsCompleted`，用于计算间隔内工具调用数 */
	memoryExtractionToolBaseline?: number;
	plan?: ThreadPlan;
	executedPlanFileKeys?: string[];
	teamSession?: TeamSessionSnapshot;
};

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export type PlanStep = {
	id: string;
	title: string;
	description: string;
	targetFiles?: string[];
	status: PlanStepStatus;
};

export type ThreadPlan = {
	title: string;
	steps: PlanStep[];
	updatedAt: number;
	sourcePath?: string;
	sourceRelPath?: string;
};

type ThreadBucket = {
	currentThreadId: string | null;
	threads: Record<string, ThreadRecord>;
};

type StoreFile = {
	version: 2;
	buckets: Record<string, ThreadBucket>;
};

type LegacyStoreFile = {
	currentThreadId: string | null;
	threads: Record<string, ThreadRecord>;
};

const GLOBAL_BUCKET_KEY = '__global__';
const DEFAULT_THREAD_TITLE = '???';
const SYSTEM_PROMPT =
	'You are Async, a concise coding assistant. Use markdown for code. The user workspace is open in the app.';
const MAX_THREAD_TITLE_LEN = 200;

let storePath = '';
let data: StoreFile = { version: 2, buckets: {} };
let migrationWorkspaceRoot: string | null = null;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writeTail: Promise<void> = Promise.resolve();

function normalizeBucketKey(workspaceRoot: string | null | undefined): string {
	const raw = String(workspaceRoot ?? '').trim();
	if (!raw) {
		return GLOBAL_BUCKET_KEY;
	}
	return `ws:${path.resolve(raw).replace(/\\/g, '/').toLowerCase()}`;
}

function ensureBucket(workspaceRoot: string | null | undefined): ThreadBucket {
	const key = normalizeBucketKey(workspaceRoot);
	const existing = data.buckets[key];
	if (existing) {
		return existing;
	}
	const created: ThreadBucket = { currentThreadId: null, threads: {} };
	data.buckets[key] = created;
	return created;
}

function findBucketByThreadId(threadId: string): { bucketKey: string; bucket: ThreadBucket; thread: ThreadRecord } | null {
	for (const [bucketKey, bucket] of Object.entries(data.buckets)) {
		const thread = bucket.threads[threadId];
		if (thread) {
			return { bucketKey, bucket, thread };
		}
	}
	return null;
}

function migrateLegacyStore(legacy: LegacyStoreFile): StoreFile {
	const bucketKey = normalizeBucketKey(migrationWorkspaceRoot);
	return {
		version: 2,
		buckets: {
			[bucketKey]: {
				currentThreadId: legacy.currentThreadId ?? null,
				threads: legacy.threads ?? {},
			},
		},
	};
}

export function initThreadStore(userData: string, initialWorkspaceRoot: string | null = null): void {
	const dir = resolveAsyncDataDir(userData);
	fs.mkdirSync(dir, { recursive: true });
	storePath = path.join(dir, 'threads.json');
	migrationWorkspaceRoot = initialWorkspaceRoot;
	load();
}

function load(): void {
	if (!fs.existsSync(storePath)) {
		data = { version: 2, buckets: {} };
		saveImmediate();
		return;
	}
	try {
		const raw = fs.readFileSync(storePath, 'utf8');
		const parsed = JSON.parse(raw) as StoreFile | LegacyStoreFile;
		if (parsed && typeof parsed === 'object' && 'buckets' in parsed && parsed.buckets) {
			data = {
				version: 2,
				buckets: Object.fromEntries(
					Object.entries(parsed.buckets).map(([key, bucket]) => [
						key,
						{
							currentThreadId: bucket?.currentThreadId ?? null,
							threads: bucket?.threads ?? {},
						},
					])
				),
			};
			return;
		}
		const legacy = parsed as LegacyStoreFile;
		data = migrateLegacyStore({
			currentThreadId: legacy?.currentThreadId ?? null,
			threads: legacy?.threads ?? {},
		});
		saveImmediate();
	} catch {
		data = { version: 2, buckets: {} };
	}
}

function saveImmediate(): void {
	if (!storePath) {
		return;
	}
	if (saveTimer) {
		clearTimeout(saveTimer);
		saveTimer = null;
	}
	writeTail = Promise.resolve();
	fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
}

function save(): void {
	if (!storePath) {
		return;
	}
	if (saveTimer) {
		clearTimeout(saveTimer);
	}
	saveTimer = setTimeout(() => {
		saveTimer = null;
		const json = JSON.stringify(data, null, 2);
		writeTail = writeTail.then(() =>
			fs.promises.writeFile(storePath, json, 'utf8').catch((err) => console.error('[threadStore] save error:', err))
		);
	}, 100);
}

/** 退出前等待挂起的异步写入落盘（配合 `before-quit` 使用）。 */
export async function flushPendingSave(): Promise<void> {
	if (!storePath) {
		return;
	}
	if (saveTimer) {
		clearTimeout(saveTimer);
		saveTimer = null;
	}
	const json = JSON.stringify(data, null, 2);
	writeTail = writeTail.then(() =>
		fs.promises.writeFile(storePath, json, 'utf8').catch((err) => console.error('[threadStore] flush error:', err))
	);
	await writeTail;
}

export function ensureDefaultThread(workspaceRoot: string | null | undefined = null): void {
	const bucket = ensureBucket(workspaceRoot);
	if (Object.keys(bucket.threads).length === 0) {
		createThread(workspaceRoot);
		return;
	}
	if (!bucket.currentThreadId || !bucket.threads[bucket.currentThreadId]) {
		bucket.currentThreadId = Object.keys(bucket.threads)[0] ?? null;
		save();
	}
}

export function listThreads(workspaceRoot: string | null | undefined = null): ThreadRecord[] {
	const bucket = ensureBucket(workspaceRoot);
	return Object.values(bucket.threads).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function threadHasUserMessages(thread: ThreadRecord): boolean {
	return thread.messages.some((message) => message.role === 'user' && message.content.trim().length > 0);
}

export function getCurrentThreadId(workspaceRoot: string | null | undefined = null): string | null {
	return ensureBucket(workspaceRoot).currentThreadId;
}

export function getThread(id: string): ThreadRecord | undefined {
	return findBucketByThreadId(id)?.thread;
}

export function createThread(
	workspaceRoot: string | null | undefined = null,
	options?: { select?: boolean }
): ThreadRecord {
	const bucket = ensureBucket(workspaceRoot);
	const id = randomUUID();
	const now = Date.now();
	const thread: ThreadRecord = {
		id,
		title: DEFAULT_THREAD_TITLE,
		createdAt: now,
		updatedAt: now,
		messages: [{ role: 'system', content: SYSTEM_PROMPT }],
	};
	bucket.threads[id] = thread;
	if (options?.select !== false) {
		bucket.currentThreadId = id;
	}
	save();
	return thread;
}

export function selectThread(workspaceRoot: string | null | undefined, id: string): ThreadRecord | null {
	const bucket = ensureBucket(workspaceRoot);
	if (!bucket.threads[id]) {
		return null;
	}
	bucket.currentThreadId = id;
	save();
	return bucket.threads[id];
}

export function deleteThread(workspaceRoot: string | null | undefined, id: string): void {
	const bucket = ensureBucket(workspaceRoot);
	delete bucket.threads[id];
	if (bucket.currentThreadId === id) {
		const ids = Object.keys(bucket.threads);
		bucket.currentThreadId = ids[0] ?? null;
	}
	save();
}

export function setThreadTitle(workspaceRoot: string | null | undefined, id: string, title: string): boolean {
	const bucket = ensureBucket(workspaceRoot);
	const thread = bucket.threads[id];
	if (!thread) {
		return false;
	}
	const trimmed = title.trim().slice(0, MAX_THREAD_TITLE_LEN);
	if (!trimmed) {
		return false;
	}
	thread.title = trimmed;
	thread.updatedAt = Date.now();
	save();
	return true;
}

export function appendMessage(threadId: string, msg: ChatMessage): ThreadRecord {
	const located = findBucketByThreadId(threadId);
	if (!located) {
		throw new Error('Thread not found');
	}
	const thread = located.thread;
	thread.messages.push(msg);
	thread.updatedAt = Date.now();
	if (msg.role === 'user' && thread.messages.filter((m) => m.role === 'user').length === 1) {
		thread.title = msg.content.slice(0, 48) + (msg.content.length > 48 ? '?' : '');
	}
	save();
	return thread;
}

export function updateLastAssistant(threadId: string, fullContent: string): void {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	const last = thread.messages[thread.messages.length - 1];
	if (last && last.role === 'assistant') {
		last.content = fullContent;
	} else {
		thread.messages.push({ role: 'assistant', content: fullContent });
	}
	thread.updatedAt = Date.now();
	save();
}

export function saveTeamSession(threadId: string, snapshot: TeamSessionSnapshot): void {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	thread.teamSession = snapshot;
	thread.updatedAt = Date.now();
	save();
}

export function getTeamSession(threadId: string): TeamSessionSnapshot | null {
	const thread = getThread(threadId);
	return thread?.teamSession ?? null;
}

export function appendToLastAssistant(threadId: string, suffix: string): void {
	const thread = getThread(threadId);
	if (!thread || !suffix) {
		return;
	}
	const last = thread.messages[thread.messages.length - 1];
	if (last?.role === 'assistant') {
		last.content = isStructuredAssistantMessage(last.content)
			? appendSuffixToStructuredAssistant(last.content, suffix)
			: last.content + suffix;
		thread.updatedAt = Date.now();
		save();
	}
}

export function accumulateTokenUsage(threadId: string, input: number | undefined, output: number | undefined): void {
	const thread = getThread(threadId);
	if (!thread || (!input && !output)) {
		return;
	}
	const prev = thread.tokenUsage ?? { totalInput: 0, totalOutput: 0 };
	thread.tokenUsage = {
		totalInput: prev.totalInput + (input ?? 0),
		totalOutput: prev.totalOutput + (output ?? 0),
	};
	thread.updatedAt = Date.now();
	save();
}

export function replaceFromUserVisibleIndex(threadId: string, visibleIndex: number, newUserContent: string): ThreadRecord {
	const thread = getThread(threadId);
	if (!thread) {
		throw new Error('Thread not found');
	}
	const system = thread.messages.filter((m) => m.role === 'system');
	const rest = thread.messages.filter((m) => m.role !== 'system');
	if (
		visibleIndex < 0 ||
		visibleIndex >= rest.length ||
		rest[visibleIndex]?.role !== 'user'
	) {
		throw new Error('Invalid user message index');
	}
	const kept = rest.slice(0, visibleIndex);
	thread.messages = [...system, ...kept, { role: 'user', content: newUserContent }];
	thread.updatedAt = Date.now();
	if (visibleIndex === 0) {
		thread.title = newUserContent.slice(0, 48) + (newUserContent.length > 48 ? '?' : '');
	}
	save();
	return thread;
}

export function savePlan(threadId: string, plan: ThreadPlan): void {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	thread.plan = plan;
	save();
}

export function updatePlanStepStatus(threadId: string, stepId: string, status: PlanStepStatus): void {
	const thread = getThread(threadId);
	if (!thread?.plan) {
		return;
	}
	const step = thread.plan.steps.find((item) => item.id === stepId);
	if (step) {
		step.status = status;
		thread.plan.updatedAt = Date.now();
		save();
	}
}

export function getExecutedPlanFileKeys(threadId: string): string[] {
	const thread = getThread(threadId);
	return Array.isArray(thread?.executedPlanFileKeys) ? [...thread.executedPlanFileKeys] : [];
}

export function markPlanFileExecuted(threadId: string, pathKey: string): void {
	const normalized = String(pathKey ?? '').trim().toLowerCase();
	if (!normalized) {
		return;
	}
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	const set = new Set((thread.executedPlanFileKeys ?? []).map((item) => String(item).toLowerCase()));
	set.add(normalized);
	thread.executedPlanFileKeys = [...set];
	thread.updatedAt = Date.now();
	save();
}

export function saveSummary(threadId: string, summary: string, coversCount: number): void {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	thread.summary = summary;
	thread.summaryCoversMessageCount = coversCount;
	save();
}

export function getMemoryExtractedMessageCount(threadId: string): number {
	const thread = getThread(threadId);
	return Math.max(0, Number(thread?.memoryExtractedMessageCount ?? 0) || 0);
}

export function saveMemoryExtractionToolBaseline(threadId: string): void {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	thread.memoryExtractionToolBaseline = thread.agentToolCallsCompleted ?? 0;
	thread.updatedAt = Date.now();
	save();
}

export function getAgentToolCallsSinceMemoryBaseline(threadId: string): number {
	const thread = getThread(threadId);
	if (!thread) {
		return 0;
	}
	const cur = thread.agentToolCallsCompleted ?? 0;
	const base = thread.memoryExtractionToolBaseline ?? 0;
	return Math.max(0, cur - base);
}

export function incrementThreadAgentToolCallCount(threadId: string): void {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	thread.agentToolCallsCompleted = (thread.agentToolCallsCompleted ?? 0) + 1;
	thread.updatedAt = Date.now();
	save();
}

export function saveMemoryExtractedMessageCount(threadId: string, count: number): void {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	thread.memoryExtractedMessageCount = Math.max(0, Math.floor(count));
	thread.updatedAt = Date.now();
	save();
}

export function touchFileInThread(threadId: string, relPath: string, action: FileStateAction, isNew: boolean): void {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	if (!thread.fileStates) {
		thread.fileStates = {};
	}
	const prev = thread.fileStates[relPath];
	if (prev) {
		thread.fileStates[relPath] = {
			action,
			firstTouchedAt: prev.firstTouchedAt,
			touchCount: prev.touchCount + 1,
		};
	} else {
		thread.fileStates[relPath] = {
			action: isNew ? 'created' : action,
			firstTouchedAt: Date.now(),
			touchCount: 1,
		};
	}
	save();
}

function sanitizeTranscriptFilePart(input: string): string {
	return input.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 120);
}

export function appendSubagentTranscript(threadId: string, parentToolCallId: string, chunk: string): void {
	if (!chunk || !storePath) {
		return;
	}
	try {
		const root = path.dirname(storePath);
		const dir = path.join(root, 'subagent_transcripts', sanitizeTranscriptFilePart(threadId));
		fs.mkdirSync(dir, { recursive: true });
		const file = path.join(dir, `${sanitizeTranscriptFilePart(parentToolCallId)}.md`);
		fs.appendFileSync(file, chunk, 'utf8');
	} catch (error) {
		console.warn('[threadStore] appendSubagentTranscript:', error instanceof Error ? error.message : error);
	}
}
