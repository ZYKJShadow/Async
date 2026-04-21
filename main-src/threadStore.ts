import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveAsyncDataDir } from './dataDir.js';
import { appendSuffixToStructuredAssistant, isStructuredAssistantMessage } from '../src/agentStructuredMessage.js';
import type { AgentSessionSnapshot } from '../src/agentSessionTypes.js';
import type { ToolResultReplacementState } from './agent/toolResultBudget.js';
import {
	THREAD_SCHEMA_VERSION_CURRENT,
	THREAD_SCHEMA_VERSION_LEGACY,
	deriveContentFromParts,
	type ThreadSchemaVersion,
	type UserMessagePart,
} from '../src/messageParts.js';

export type { UserMessagePart } from '../src/messageParts.js';

export type ChatMessage = {
	role: 'user' | 'assistant' | 'system';
	content: string;
	/**
	 * Structured body for `role: 'user'` messages (v2 threads). When present,
	 * `parts` is the single source of truth for send/estimate/render; `content`
	 * is a derived display/fallback cache that must not be edited independently.
	 */
	parts?: UserMessagePart[];
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
	phase: 'researching' | 'planning' | 'executing' | 'reviewing' | 'synthesizing' | 'delivering';
	tasks: TeamSessionSnapshotTask[];
	planSummary: string;
	leaderMessage: string;
	reviewSummary: string;
	reviewVerdict: 'approved' | 'revision_needed' | null;
	finalSummary?: string;
};

export type DeferredToolState = {
	discoveredToolNames: string[];
	providerLoadedToolNames?: {
		anthropic?: string[];
		openai?: string[];
	};
};

export type ThreadRecord = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	/**
	 * Thread-level schema version. Missing or `1` = legacy, string-only user messages.
	 * `2` = structured `parts` on user messages. New threads start at `2`; legacy
	 * threads promote on first write after a `parts`-bearing message is appended.
	 */
	schemaVersion?: ThreadSchemaVersion;
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
	/** 线程中已通过 ToolSearch 加载过的延迟工具状态（兼容旧字段懒升级）。 */
	deferredToolState?: DeferredToolState;
	discoveredDeferredToolNames?: string[];
	toolResultReplacementState?: ToolResultReplacementState;
	plan?: ThreadPlan;
	executedPlanFileKeys?: string[];
	teamSession?: TeamSessionSnapshot;
	agentSession?: AgentSessionSnapshot;
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

function inferThreadSchemaVersion(thread: ThreadRecord): ThreadSchemaVersion {
	if (thread.schemaVersion === THREAD_SCHEMA_VERSION_CURRENT) {
		return THREAD_SCHEMA_VERSION_CURRENT;
	}
	return thread.messages.some((message) => message.role === 'user' && !!message.parts?.length)
		? THREAD_SCHEMA_VERSION_CURRENT
		: THREAD_SCHEMA_VERSION_LEGACY;
}

function normalizeLoadedThread(thread: ThreadRecord): ThreadRecord {
	return {
		...thread,
		schemaVersion: inferThreadSchemaVersion(thread),
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
							threads: Object.fromEntries(
								Object.entries(bucket?.threads ?? {}).map(([threadId, thread]) => [
									threadId,
									normalizeLoadedThread(thread),
								])
							),
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
		schemaVersion: THREAD_SCHEMA_VERSION_CURRENT,
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
	const normalized = normalizeUserMessageForWrite(msg);
	thread.messages.push(normalized);
	thread.updatedAt = Date.now();
	if (normalized.parts && normalized.parts.length > 0) {
		thread.schemaVersion = THREAD_SCHEMA_VERSION_CURRENT;
	}
	if (normalized.role === 'user' && thread.messages.filter((m) => m.role === 'user').length === 1) {
		thread.title = normalized.content.slice(0, 48) + (normalized.content.length > 48 ? '?' : '');
	}
	save();
	return thread;
}

/**
 * Ensure `content` is a faithful derivation of `parts` at write time.
 * The renderer/estimator/send paths all consume `parts` first when present;
 * `content` stays as a one-shot display/fallback string that callers must not
 * mutate after write.
 */
function normalizeUserMessageForWrite(msg: ChatMessage): ChatMessage {
	if (msg.role !== 'user' || !msg.parts || msg.parts.length === 0) {
		return msg;
	}
	const derived = deriveContentFromParts(msg.parts);
	return { ...msg, content: derived };
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

export function saveAgentSession(threadId: string, snapshot: AgentSessionSnapshot): void {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	thread.agentSession = snapshot;
	thread.updatedAt = Date.now();
	save();
}

export function getAgentSession(threadId: string): AgentSessionSnapshot | null {
	const thread = getThread(threadId);
	return thread?.agentSession ?? null;
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

export function replaceFromUserVisibleIndex(
	threadId: string,
	visibleIndex: number,
	newUserContent: string,
	newUserParts?: UserMessagePart[]
): ThreadRecord {
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
	const base: ChatMessage =
		newUserParts && newUserParts.length > 0
			? { role: 'user', content: newUserContent, parts: newUserParts }
			: { role: 'user', content: newUserContent };
	const replacement = normalizeUserMessageForWrite(base);
	thread.messages = [...system, ...kept, replacement];
	thread.updatedAt = Date.now();
	if (replacement.parts && replacement.parts.length > 0) {
		thread.schemaVersion = THREAD_SCHEMA_VERSION_CURRENT;
	}
	if (visibleIndex === 0) {
		thread.title = replacement.content.slice(0, 48) + (replacement.content.length > 48 ? '?' : '');
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

function normalizeToolNameList(values: Iterable<string>): string[] {
	return [...new Set(Array.from(values).map((item) => String(item).trim()).filter(Boolean))].sort((a, b) =>
		a.localeCompare(b)
	);
}

function normalizeDeferredToolState(
	state?: DeferredToolState | null,
	legacyNames?: string[] | null
): DeferredToolState {
	const discovered = normalizeToolNameList([
		...(state?.discoveredToolNames ?? []),
		...(legacyNames ?? []),
	]);
	const providerLoadedToolNames =
		state?.providerLoadedToolNames
			? {
					...(state.providerLoadedToolNames.anthropic?.length
						? { anthropic: normalizeToolNameList(state.providerLoadedToolNames.anthropic) }
						: {}),
					...(state.providerLoadedToolNames.openai?.length
						? { openai: normalizeToolNameList(state.providerLoadedToolNames.openai) }
						: {}),
				}
			: undefined;
	return {
		discoveredToolNames: discovered,
		...(providerLoadedToolNames && Object.keys(providerLoadedToolNames).length > 0
			? { providerLoadedToolNames }
			: {}),
	};
}

function upgradeThreadDeferredState(thread: ThreadRecord): DeferredToolState {
	const normalized = normalizeDeferredToolState(
		thread.deferredToolState,
		thread.discoveredDeferredToolNames
	);
	thread.deferredToolState = normalized;
	if (thread.discoveredDeferredToolNames) {
		delete thread.discoveredDeferredToolNames;
	}
	return normalized;
}

export function getDeferredToolState(threadId: string): DeferredToolState {
	const thread = getThread(threadId);
	if (!thread) {
		return { discoveredToolNames: [] };
	}
	return upgradeThreadDeferredState(thread);
}

export function saveDeferredToolState(threadId: string, state: DeferredToolState): void {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	thread.deferredToolState = normalizeDeferredToolState(state);
	if (thread.discoveredDeferredToolNames) {
		delete thread.discoveredDeferredToolNames;
	}
	thread.updatedAt = Date.now();
	save();
}

export function getDiscoveredDeferredToolNames(threadId: string): string[] {
	return getDeferredToolState(threadId).discoveredToolNames;
}

export function saveDiscoveredDeferredToolNames(threadId: string, names: string[]): void {
	const current = getDeferredToolState(threadId);
	saveDeferredToolState(threadId, {
		...current,
		discoveredToolNames: names,
	});
}

export function getToolResultReplacementState(threadId: string): ToolResultReplacementState {
	const thread = getThread(threadId);
	if (!thread?.toolResultReplacementState) {
		return { seenToolUseIds: [], replacements: [] };
	}
	return {
		seenToolUseIds: normalizeToolNameList(thread.toolResultReplacementState.seenToolUseIds ?? []),
		replacements: [...(thread.toolResultReplacementState.replacements ?? [])]
			.map((record) => ({
				toolUseId: String(record.toolUseId ?? '').trim(),
				toolName: String(record.toolName ?? '').trim(),
				replacement: String(record.replacement ?? ''),
				originalSize: Math.max(0, Math.floor(Number(record.originalSize ?? 0) || 0)),
			}))
			.filter((record) => record.toolUseId.length > 0)
			.sort((a, b) => a.toolUseId.localeCompare(b.toolUseId)),
	};
}

export function saveToolResultReplacementState(
	threadId: string,
	state: ToolResultReplacementState
): void {
	const thread = getThread(threadId);
	if (!thread) {
		return;
	}
	thread.toolResultReplacementState = getToolResultReplacementStateFromInput(state);
	thread.updatedAt = Date.now();
	save();
}

function getToolResultReplacementStateFromInput(
	state: ToolResultReplacementState
): ToolResultReplacementState {
	return {
		seenToolUseIds: normalizeToolNameList(state.seenToolUseIds ?? []),
		replacements: [...(state.replacements ?? [])]
			.map((record) => ({
				toolUseId: String(record.toolUseId ?? '').trim(),
				toolName: String(record.toolName ?? '').trim(),
				replacement: String(record.replacement ?? ''),
				originalSize: Math.max(0, Math.floor(Number(record.originalSize ?? 0) || 0)),
			}))
			.filter((record) => record.toolUseId.length > 0)
			.sort((a, b) => a.toolUseId.localeCompare(b.toolUseId)),
	};
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

function transcriptRootDir(): string | null {
	if (!storePath) {
		return null;
	}
	return path.join(path.dirname(storePath), 'subagent_transcripts');
}

export function getAgentTranscriptPath(threadId: string, agentId: string): string | null {
	const root = transcriptRootDir();
	if (!root) {
		return null;
	}
	return path.join(
		root,
		sanitizeTranscriptFilePart(threadId),
		`${sanitizeTranscriptFilePart(agentId)}.md`
	);
}

export function appendAgentTranscript(threadId: string, agentId: string, chunk: string): void {
	if (!chunk) {
		return;
	}
	const file = getAgentTranscriptPath(threadId, agentId);
	if (!file) {
		return;
	}
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, chunk, 'utf8');
	} catch (error) {
		console.warn('[threadStore] appendAgentTranscript:', error instanceof Error ? error.message : error);
	}
}

export function appendSubagentTranscript(threadId: string, parentToolCallId: string, chunk: string): void {
	appendAgentTranscript(threadId, parentToolCallId, chunk);
}
