import { app, BrowserWindow, ipcMain, dialog, type WebContents } from 'electron';
import { applyThemeChromeToWindow, type NativeChromeOverride, type ThemeChromeScheme } from '../themeChrome.js';
import { applyPatch, formatPatch, parsePatch, reversePatch } from 'diff';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import sharp from 'sharp';
import {
	imageMimeFromExt,
	isImagePath,
	type UserMessagePart,
} from '../../src/messageParts.js';
import {
	resolveWorkspacePath,
	isPathInsideRoot,
} from '../workspace.js';
import {
	ensureWorkspaceFileIndex,
	setWorkspaceFileIndexReadyBroadcaster,
	registerKnownWorkspaceRelPath,
	setWorkspaceFsTouchNotifier,
} from '../workspaceFileIndex.js';

setWorkspaceFileIndexReadyBroadcaster((rootNorm) => {
	for (const w of BrowserWindow.getAllWindows()) {
		if (w.isDestroyed()) {
			continue;
		}
		try {
			w.webContents.send('async-shell:workspaceFileIndexReady', rootNorm);
		} catch {
			/* ignore */
		}
	}
});

import {
	getSettings,
} from '../settingsStore.js';
import {
	mergeAgentWithPluginRuntime,
} from '../plugins/pluginRuntimeService.js';
import {
	appendMessage,
	createThread,
	deleteThread,
	ensureDefaultThread,
	getCurrentThreadId,
	getThread,
	listThreads,
	replaceFromUserVisibleIndex,
	selectThread,
	setThreadTitle,
	appendToLastAssistant,
	savePlan,
	getExecutedPlanFileKeys,
	markPlanFileExecuted,
	getContextCompactState,
	getDeferredToolState,
	saveDeferredToolState,
	getToolResultReplacementState,
	saveContextCompactState,
	saveToolResultReplacementState,
	getAgentSession,
	type ThreadRecord,
} from '../threadStore.js';
import { parseComposerMode, type ComposerMode } from '../llm/composerMode.js';
import {
	modeExpandsWorkspaceFileContext,
} from '../llm/workspaceContextExpand.js';
import {
	applyAgentDiffChunk,
	applyAgentPatchItems,
	formatAgentApplyFooter,
	formatAgentApplyIncremental,
} from '../agent/applyAgentDiffs.js';
import { countDiffLinesInChunk } from '../diffLineCount.js';
import { recordAgentLineDelta } from '../workspaceUsageStats.js';
import {
	resolveMistakeLimitRecovery,
	type MistakeLimitDecision,
} from '../agent/mistakeLimitGate.js';
import { resolveToolApproval } from '../agent/toolApprovalGate.js';
import {
	abortPlanQuestionWaitersForThread,
	resolvePlanQuestionTool,
} from '../agent/planQuestionTool.js';
import {
	abortRequestUserInputWaitersForThread,
	resolveRequestUserInput,
} from '../agent/requestUserInputTool.js';
import {
	abortTeamPlanApprovalForThread,
	resolveTeamPlanApproval,
} from '../agent/teamPlanApprovalTool.js';
import {
	buildThreadTitleRuleAppend,
	loadClaudeWorkspaceSkills,
	loadGlobalSkills,
	prepareUserTurnForChat,
} from '../llm/agentMessagePrep.js';
import {
	buildSkillCreatorSystemAppend,
	formatSkillCreatorUserBubble,
	type SkillCreatorScope,
} from '../skillCreatorPrompt.js';
import {
	buildRuleCreatorSystemAppend,
	formatRuleCreatorUserBubble,
	appendRuleCreatorPathLock,
} from '../ruleCreatorPrompt.js';
import {
	buildSubagentCreatorSystemAppend,
	formatSubagentCreatorUserBubble,
	type SubagentCreatorScope,
} from '../subagentCreatorPrompt.js';
import type { AgentRuleScope } from '../agentSettingsTypes.js';
import {
	mergeAgentWithProjectSlice,
	readWorkspaceAgentProjectSlice,
	writeWorkspaceAgentProjectSlice,
	type WorkspaceAgentProjectSlice,
} from '../workspaceAgentStore.js';
import {
	summarizeThreadForSidebarWithMeta,
	isTimestampToday,
	pruneSummaryCache,
	type ThreadRowSummary,
} from '../threadListSummary.js';
import { registerTerminalSessionIpc } from '../terminalSessionIpc.js';

import {
	getWorkspaceLspManagerForWebContents,
} from '../lspSessionsByWebContents.js';
import { registerClipboardHandlers } from './handlers/clipboardHandlers.js';
import { registerAutoUpdateHandlers } from './handlers/autoUpdateHandlers.js';
import { registerUsageStatsHandlers } from './handlers/usageStatsHandlers.js';
import { registerLspHandlers } from './handlers/lspHandlers.js';
import { registerAppHandlers } from './handlers/appHandlers.js';
import { registerWorkspaceHandlers } from './handlers/workspaceHandlers.js';
import { registerFsHandlers } from './handlers/fsHandlers.js';
import { registerShellHandlers } from './handlers/shellHandlers.js';
import { registerGitHandlers } from './handlers/gitHandlers.js';
import { registerBrowserHandlers } from './handlers/browserHandlers.js';
import { registerMcpHandlers } from './handlers/mcpHandlers.js';
import { registerPluginsHandlers } from './handlers/pluginsHandlers.js';
import { registerSettingsHandlers } from './handlers/settingsHandlers.js';
import { registerTerminalExecHandlers } from './handlers/terminalExecHandlers.js';
import { senderWorkspaceRoot, workspaceRootsEqual } from './agentRuntime.js';
import {
	abortByThread,
	preflightAbortByThread,
	agentRevertSnapshotsByThread,
	toolApprovalWaiters,
	mistakeLimitWaiters,
	activeUsageStatsDir,
	queueThreadTitleGeneration,
	resolveManagedAgentLoopOptions,
	runChatStream,
} from './chatRuntime.js';
import {
	attachManagedAgentEmitter,
	closeManagedAgent,
	getManagedAgentSession,
	resumeManagedAgent,
	sendInputToManagedAgent,
	waitForManagedAgents,
} from '../agent/managedSubagents.js';
import { getGitContextBlock } from '../gitContext.js';
import { ensureMemoryDirExists, loadMemoryPrompt } from '../memdir/memdir.js';
import { scanMemoryFiles } from '../memdir/memoryScan.js';
import { getAutoMemEntrypoint } from '../memdir/paths.js';
import { buildMemoryEntrypoint } from '../services/extractMemories/extractMemories.js';


/** 可选覆盖工作区根路径（须为已存在目录），否则使用当前窗口绑定的工作区 */
function resolveWorkspaceScopeForThreads(
	event: { sender: WebContents },
	workspaceRootOverride?: unknown
): string | null {
	if (typeof workspaceRootOverride === 'string' && workspaceRootOverride.trim()) {
		try {
			const resolved = path.resolve(workspaceRootOverride.trim());
			if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
				return resolved;
			}
		} catch {
			/* ignore */
		}
	}
	return senderWorkspaceRoot(event);
}

function appendSystemBlock(base: string | undefined, block: string): string {
	const trimmed = block.trim();
	if (!trimmed) {
		return base ?? '';
	}
	return base && base.trim() ? `${base}\n\n---\n${trimmed}` : trimmed;
}

function logChatPipelineLatency(
	_channel: string,
	_threadId: string,
	_epochMs: number,
	_phase: string,
	_extra?: Record<string, string | number | boolean | null | undefined>
): void {
	/* intentionally quiet — was used for main-process chat pipeline latency tracing */
}

function throwIfAbortRequested(signal: AbortSignal | undefined, _threadId: string, _phase: string): void {
	if (!signal?.aborted) {
		return;
	}
	throw new DOMException('Aborted', 'AbortError');
}

async function appendMemoryAndRetrievalContext(params: {
	base: string | undefined;
	mode: ComposerMode;
	settings: ReturnType<typeof getSettings>;
	root: string | null;
	signal?: AbortSignal;
}): Promise<string> {
	let next = params.base ?? '';
	if (params.signal?.aborted) {
		return next;
	}

	if ((params.mode === 'agent' || params.mode === 'debug') && params.root) {
		const memoryPrompt = await loadMemoryPrompt(params.root);
		if (memoryPrompt) {
			next = appendSystemBlock(next, memoryPrompt);
		}
	}

	if (modeExpandsWorkspaceFileContext(params.mode) && params.root) {
		const gitBlock = await getGitContextBlock(params.root);
		if (gitBlock) {
			next = appendSystemBlock(next, gitBlock);
		}
	}

	return next;
}


function readWorkspaceTextFileIfExists(relPath: string, workspaceRoot: string | null): string | null {
	if (!workspaceRoot) {
		return null;
	}
	try {
		const full = resolveWorkspacePath(relPath, workspaceRoot);
		if (!fs.existsSync(full)) {
			return null;
		}
		return fs.readFileSync(full, 'utf8');
	} catch {
		return null;
	}
}

function contentsEqual(a: string | null, b: string | null): boolean {
	return (a ?? null) === (b ?? null);
}

function normalizePatchChunk(chunk: string): string {
	return String(chunk ?? '').replace(/\r\n/g, '\n').trim();
}

function reverseUnifiedPatch(chunk: string): string | null {
	const normalized = normalizePatchChunk(chunk);
	if (!normalized) {
		return null;
	}
	try {
		const patches = parsePatch(normalized);
		const first = patches[0];
		if (!first) {
			return null;
		}
		return formatPatch(reversePatch(first)).trim();
	} catch {
		return null;
	}
}


const MAX_PLAN_EXECUTE_INJECT_CHARS = 200_000;

function readPlanFileForExecute(absPath: string, windowWorkspaceRoot: string | null): string | null {
	let resolved: string;
	try {
		resolved = path.resolve(absPath);
	} catch {
		return null;
	}
	const userPlansDir = path.join(app.getPath('userData'), '.async', 'plans');
	const root = windowWorkspaceRoot;
	const wsPlansDir = root ? path.join(root, '.async', 'plans') : null;
	const allowed =
		isPathInsideRoot(resolved, userPlansDir) ||
		(wsPlansDir != null && isPathInsideRoot(resolved, wsPlansDir));
	if (!allowed) {
		return null;
	}
	try {
		if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
			return null;
		}
		let t = fs.readFileSync(resolved, 'utf8');
		if (t.length > MAX_PLAN_EXECUTE_INJECT_CHARS) {
			t = `${t.slice(0, MAX_PLAN_EXECUTE_INJECT_CHARS)}\n\n… (truncated)`;
		}
		return t;
	} catch {
		return null;
	}
}

function appendPlanExecuteToSystem(
	base: string | undefined,
	exec: { fromAbsPath?: string; inlineMarkdown?: string; planTitle?: string } | undefined,
	windowWorkspaceRoot: string | null
): string {
	if (!exec) {
		return base ?? '';
	}
	let body: string | null = null;
	if (exec.fromAbsPath) {
		body = readPlanFileForExecute(exec.fromAbsPath, windowWorkspaceRoot);
	}
	const inline = typeof exec.inlineMarkdown === 'string' ? exec.inlineMarkdown.trim() : '';
	if ((body == null || !body.trim()) && inline) {
		body =
			inline.length > MAX_PLAN_EXECUTE_INJECT_CHARS
				? `${inline.slice(0, MAX_PLAN_EXECUTE_INJECT_CHARS)}\n\n… (truncated)`
				: inline;
	}
	if (body == null || !body.trim()) {
		return base ?? '';
	}
	const title = String(exec.planTitle ?? 'Plan').trim() || 'Plan';
	const block = [
		'## Saved plan document (execute strictly; the visible user message is only a trigger)',
		`Plan title: ${title}`,
		'',
		body,
	].join('\n');
	const trimmedBase = base?.trim() ?? '';
	return trimmedBase ? `${trimmedBase}\n\n---\n${block}` : block;
}

export function registerIpc(): void {
	registerTerminalSessionIpc();

	setWorkspaceFsTouchNotifier(() => {
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) {
				win.webContents.send('async-shell:workspaceFsTouched');
			}
		}
	});

	registerAppHandlers();
	registerWorkspaceHandlers();
	registerFsHandlers();
	registerShellHandlers();
	registerGitHandlers();
	registerBrowserHandlers();
	registerSettingsHandlers();
	registerPluginsHandlers();
	registerMcpHandlers();
	registerTerminalExecHandlers();
	registerLspHandlers();
	registerClipboardHandlers();
	registerUsageStatsHandlers();
	registerAutoUpdateHandlers();


	const COMPOSER_ATTACH_MAX_BYTES = 8 * 1024 * 1024;

	async function probeImageMeta(
		buf: Buffer,
		relPath: string
	): Promise<
		| { mimeType: string; sizeBytes: number; width: number; height: number; sha256: string }
		| null
	> {
		if (!isImagePath(relPath)) {
			return null;
		}
		try {
			const meta = await sharp(buf).metadata();
			if (!meta.width || !meta.height) {
				return null;
			}
			const ext = (path.extname(relPath).slice(1) || '').toLowerCase();
			const mimeType = imageMimeFromExt(ext) ?? 'application/octet-stream';
			const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
			return {
				mimeType,
				sizeBytes: buf.length,
				width: meta.width,
				height: meta.height,
				sha256,
			};
		} catch {
			return null;
		}
	}

	type ComposerImageMetaDto = {
		mimeType: string;
		sizeBytes: number;
		width: number;
		height: number;
		sha256: string;
	};

	type ComposerAttachmentResult =
		| { ok: true; relPath: string; imageMeta?: ComposerImageMetaDto }
		| { ok: false; error: 'no-workspace' | 'empty' | 'too-large' | 'write-failed' };

	function sanitizeComposerAttachmentName(rawName: string | undefined): string {
		const baseName =
			typeof rawName === 'string' && rawName.trim() ? path.basename(rawName) : 'attachment';
		return (
			baseName
				.replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
				.replace(/[. ]+$/g, '')
				.slice(0, 120) || 'attachment'
		);
	}

	async function persistComposerAttachmentBuffer(
		root: string | null,
		buf: Buffer,
		rawName: string | undefined
	): Promise<ComposerAttachmentResult> {
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		if (buf.length === 0) {
			return { ok: false as const, error: 'empty' as const };
		}
		if (buf.length > COMPOSER_ATTACH_MAX_BYTES) {
			return { ok: false as const, error: 'too-large' as const };
		}
		const safeName = sanitizeComposerAttachmentName(rawName);
		const dirRel = '.async/composer-drops';
		const dirAbs = path.join(root, dirRel);
		try {
			fs.mkdirSync(dirAbs, { recursive: true });
			const parsed = path.parse(safeName);
			const baseName = parsed.name || 'attachment';
			const ext = parsed.ext || '';
			let finalName = `${baseName}${ext}`;
			let seq = 2;
			while (true) {
				const candidateAbs = path.join(dirAbs, finalName);
				if (!fs.existsSync(candidateAbs)) {
					break;
				}
				try {
					const existingBuf = fs.readFileSync(candidateAbs);
					if (Buffer.compare(existingBuf, buf) === 0) {
						const relPath = `${dirRel}/${finalName}`;
						registerKnownWorkspaceRelPath(relPath, root);
						const imageMeta = await probeImageMeta(buf, relPath);
						return imageMeta
							? { ok: true as const, relPath, imageMeta }
							: { ok: true as const, relPath };
					}
				} catch {
					/* 读取失败时继续找下一个可用名称 */
				}
				finalName = `${baseName} (${seq})${ext}`;
				seq += 1;
			}
			const relPath = `${dirRel}/${finalName}`;
			fs.writeFileSync(path.join(root, relPath), buf);
			registerKnownWorkspaceRelPath(relPath, root);
			const imageMeta = await probeImageMeta(buf, relPath);
			return imageMeta
				? { ok: true as const, relPath, imageMeta }
				: { ok: true as const, relPath };
		} catch {
			return { ok: false as const, error: 'write-failed' as const };
		}
	}

	ipcMain.handle(
		'workspace:saveComposerAttachment',
		async (
			event,
			payload: { base64?: string; fileName?: string }
		): Promise<ComposerAttachmentResult> => {
			const root = senderWorkspaceRoot(event);
			let buf: Buffer;
			try {
				buf = Buffer.from(String(payload?.base64 ?? ''), 'base64');
			} catch {
				return { ok: false as const, error: 'empty' as const };
			}
			return persistComposerAttachmentBuffer(root, buf, payload?.fileName);
		}
	);

	ipcMain.handle(
		'workspace:pickComposerImages',
		async (
			event
		): Promise<
			| { ok: true; attachments: Array<{ relPath: string; imageMeta?: ComposerImageMetaDto }> }
			| { ok: false; error: 'no-workspace'; attachments: [] }
			| { ok: false; canceled: true; attachments: [] }
		> => {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'no-workspace' as const, attachments: [] };
			}
			const win = BrowserWindow.fromWebContents(event.sender);
			const r = await dialog.showOpenDialog(win ?? undefined, {
				properties: ['openFile', 'multiSelections'],
				defaultPath: root,
				filters: [
					{
						name: 'Images',
						extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'],
					},
				],
			});
			if (r.canceled || r.filePaths.length === 0) {
				return { ok: false as const, canceled: true as const, attachments: [] };
			}
			const attachments: Array<{ relPath: string; imageMeta?: ComposerImageMetaDto }> = [];
			for (const rawPath of r.filePaths) {
				const abs = path.resolve(rawPath);
				try {
					if (!fs.statSync(abs).isFile()) {
						continue;
					}
				} catch {
					continue;
				}
				if (isPathInsideRoot(abs, root)) {
					const relPath = path.relative(root, abs).replace(/\\/g, '/');
					registerKnownWorkspaceRelPath(relPath, root);
					try {
						const imageMeta = await probeImageMeta(fs.readFileSync(abs), relPath);
						attachments.push(imageMeta ? { relPath, imageMeta } : { relPath });
					} catch {
						attachments.push({ relPath });
					}
					continue;
				}
				try {
					const saveResult = await persistComposerAttachmentBuffer(
						root,
						fs.readFileSync(abs),
						path.basename(abs)
					);
					if (saveResult.ok) {
						attachments.push(
							saveResult.imageMeta
								? { relPath: saveResult.relPath, imageMeta: saveResult.imageMeta }
								: { relPath: saveResult.relPath }
						);
					}
				} catch {
					/* skip unreadable selections */
				}
			}
			return { ok: true as const, attachments };
		}
	);

	ipcMain.handle(
		'workspace:resolveDroppedFilePath',
		async (
			event,
			payload: { fullPath?: string }
		): Promise<
			| { ok: true; relPath: string; imageMeta?: ComposerImageMetaDto }
			| { ok: false; error: 'no-workspace' | 'outside-workspace' | 'not-file' }
		> => {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'no-workspace' as const };
			}
			const raw = typeof payload?.fullPath === 'string' ? payload.fullPath.trim() : '';
			if (!raw) {
				return { ok: false as const, error: 'not-file' as const };
			}
			const abs = path.resolve(raw);
			if (!isPathInsideRoot(abs, root)) {
				return { ok: false as const, error: 'outside-workspace' as const };
			}
			try {
				if (!fs.statSync(abs).isFile()) {
					return { ok: false as const, error: 'not-file' as const };
				}
			} catch {
				return { ok: false as const, error: 'not-file' as const };
			}
			const relPath = path.relative(root, abs).replace(/\\/g, '/');
			registerKnownWorkspaceRelPath(relPath, root);
			try {
				const imageMeta = await probeImageMeta(fs.readFileSync(abs), relPath);
				return imageMeta
					? { ok: true as const, relPath, imageMeta }
					: { ok: true as const, relPath };
			} catch {
				return { ok: true as const, relPath };
			}
		}
	);


	ipcMain.handle(
		'theme:applyChrome',
		(
			e,
			payload: {
				scheme?: string;
				backgroundColor?: string;
				titleBarColor?: string;
				symbolColor?: string;
			}
		) => {
			const s = payload?.scheme;
			if (s !== 'light' && s !== 'dark') {
				return { ok: false as const, error: 'bad-scheme' as const };
			}
			const win = BrowserWindow.fromWebContents(e.sender);
			if (!win) {
				return { ok: false as const, error: 'no-window' as const };
			}
			const hex = /^#[0-9a-fA-F]{6}$/;
			const hasCustom =
				typeof payload?.backgroundColor === 'string' &&
				typeof payload?.titleBarColor === 'string' &&
				typeof payload?.symbolColor === 'string' &&
				hex.test(payload.backgroundColor.trim()) &&
				hex.test(payload.titleBarColor.trim()) &&
				hex.test(payload.symbolColor.trim());
			const override: NativeChromeOverride | null = hasCustom
				? {
						backgroundColor: payload!.backgroundColor!.trim(),
						titleBarColor: payload!.titleBarColor!.trim(),
						symbolColor: payload!.symbolColor!.trim(),
					}
				: null;
			applyThemeChromeToWindow(win, s as ThemeChromeScheme, override);
			return { ok: true as const };
		}
	);

	ipcMain.handle('workspaceAgent:get', (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: true as const, slice: { rules: [], skills: [], subagents: [] } satisfies WorkspaceAgentProjectSlice };
		}
		return { ok: true as const, slice: readWorkspaceAgentProjectSlice(root) };
	});

	ipcMain.handle('workspaceAgent:set', (event, slice: WorkspaceAgentProjectSlice) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		writeWorkspaceAgentProjectSlice(root, slice);
		return { ok: true as const };
	});

	ipcMain.handle('workspace:listDiskSkills', (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: true as const, skills: [] };
		}
		const globalSkills = loadGlobalSkills();
			return { ok: true as const, skills: [...globalSkills, ...loadClaudeWorkspaceSkills(root)] };
	});

	/** 删除工作区内技能目录（`.cursor|claude|async/skills/<slug>/` 整夹），参数为其中 `SKILL.md` 的相对路径 */
	ipcMain.handle('workspace:deleteSkillFromDisk', (event, skillMdRel: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const norm = String(skillMdRel ?? '').trim().replace(/\\/g, '/');
		if (!norm.endsWith('/SKILL.md')) {
			return { ok: false as const, error: 'not-skill-file' as const };
		}
		const dirRel = norm.slice(0, -'/SKILL.md'.length).replace(/\/$/, '');
		const parts = dirRel.split('/').filter(Boolean);
		const rootSeg = parts[0];
		if (
			parts.length !== 3 ||
			parts[1] !== 'skills' ||
			!rootSeg ||
			!['.cursor', '.claude', '.async'].includes(rootSeg) ||
			!parts[2] ||
			parts[2].includes('..')
		) {
			return { ok: false as const, error: 'invalid-path' as const };
		}
		try {
			const dirFull = resolveWorkspacePath(dirRel, root);
			if (fs.existsSync(dirFull)) {
				fs.rmSync(dirFull, { recursive: true, force: true });
			}
			return { ok: true as const };
		} catch {
			return { ok: false as const, error: 'io-failed' as const };
		}
	});

	ipcMain.handle('workspace:memory:stats', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const memoryDir = await ensureMemoryDirExists(root);
		const entrypointPath = getAutoMemEntrypoint(root);
		const headers = memoryDir ? await scanMemoryFiles(memoryDir) : [];
		let entryCount = 0;
		let entrypointExists = false;
		if (entrypointPath && fs.existsSync(entrypointPath) && fs.statSync(entrypointPath).isFile()) {
			entrypointExists = true;
			try {
				const raw = fs.readFileSync(entrypointPath, 'utf8');
				entryCount = raw
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean).length;
			} catch {
				entryCount = 0;
			}
		}
		return {
			ok: true as const,
			workspaceRoot: root,
			memoryDir,
			entrypointPath,
			entrypointExists,
			topicFiles: headers.length,
			entryCount,
		};
	});

	ipcMain.handle('workspace:memory:rebuild', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const memoryDir = await ensureMemoryDirExists(root);
		const entrypointPath = getAutoMemEntrypoint(root);
		if (!memoryDir || !entrypointPath) {
			return { ok: false as const, error: 'memory-unavailable' as const };
		}
		const headers = await scanMemoryFiles(memoryDir);
		await fs.promises.writeFile(entrypointPath, buildMemoryEntrypoint(headers), 'utf8');
		return {
			ok: true as const,
			memoryDir,
			entrypointPath,
			topicFiles: headers.length,
		};
	});

	// 每处理 BATCH_SIZE 条 thread 后通过 setImmediate 让出一次主进程事件循环，
	// 防止 summarizeThreadForSidebar 对大量/长消息的 thread 进行批量 diff 扫描时
	// 阻塞主进程，导致 Electron 窗口拖动等原生事件无法响应。
	const THREAD_SUMMARIZE_BATCH = 8;
	const THREAD_CACHED_ROW_BATCH = 64;
	function yieldToEventLoop(): Promise<void> {
		return new Promise((resolve) => setImmediate(resolve));
	}

	type ThreadListVersion = {
		id: string;
		updatedAt: number;
	};

	type ThreadSidebarLightRow = {
		id: string;
		title: string;
		updatedAt: number;
		createdAt: number;
		previewCount: number;
		hasUserMessages: boolean;
		isToday: boolean;
		tokenUsage: ThreadRecord['tokenUsage'];
		fileStateCount: number;
	};

	type ThreadSidebarRow = {
		id: string;
		title: string;
		updatedAt: number;
		createdAt: number;
		isToday: boolean;
		tokenUsage: ThreadRecord['tokenUsage'];
		fileStateCount: number;
	} & ThreadRowSummary;

	function collectThreadLightStats(t: ThreadRecord): { previewCount: number; hasUserMessages: boolean } {
		let previewCount = 0;
		let hasUserMessages = false;
		for (const message of t.messages) {
			if (message.role === 'system') {
				continue;
			}
			previewCount += 1;
			if (message.role === 'user' && !hasUserMessages && /\S/.test(message.content)) {
				hasUserMessages = true;
			}
		}
		return { previewCount, hasUserMessages };
	}

	function buildThreadSidebarLightRow(t: ThreadRecord, now: number): ThreadSidebarLightRow {
		const stats = collectThreadLightStats(t);
		return {
			id: t.id,
			title: t.title,
			updatedAt: t.updatedAt,
			createdAt: t.createdAt,
			previewCount: stats.previewCount,
			hasUserMessages: stats.hasUserMessages,
			isToday: isTimestampToday(t.updatedAt, now),
			tokenUsage: t.tokenUsage,
			fileStateCount: t.fileStates ? Object.keys(t.fileStates).length : 0,
		};
	}

	function buildThreadSidebarRow(
		t: ThreadRecord,
		now: number,
		workspaceRoot: string | null | undefined
	): { row: ThreadSidebarRow; cacheHit: boolean } {
		const { summary, cacheHit } = summarizeThreadForSidebarWithMeta(t, workspaceRoot);
		return {
			cacheHit,
			row: {
				id: t.id,
				title: t.title,
				updatedAt: t.updatedAt,
				createdAt: t.createdAt,
				isToday: isTimestampToday(t.updatedAt, now),
				tokenUsage: t.tokenUsage,
				fileStateCount: t.fileStates ? Object.keys(t.fileStates).length : 0,
				...summary,
			},
		};
	}

	function parseRequestedThreadVersions(rawVersions: unknown): Map<string, number> | null {
		if (!Array.isArray(rawVersions) || rawVersions.length === 0) {
			return null;
		}
		const versions = new Map<string, number>();
		for (const item of rawVersions) {
			if (!item || typeof item !== 'object') {
				continue;
			}
			const rec = item as Partial<ThreadListVersion>;
			const id = typeof rec.id === 'string' ? rec.id : '';
			const updatedAt = typeof rec.updatedAt === 'number' ? rec.updatedAt : Number.NaN;
			if (id && Number.isFinite(updatedAt)) {
				versions.set(id, updatedAt);
			}
		}
		return versions.size > 0 ? versions : null;
	}

	ipcMain.handle('threads:listLight', async (event) => {
		const t0 = performance.now();
		const scope = senderWorkspaceRoot(event);
		ensureDefaultThread(scope);
		const now = Date.now();
		const raw = listThreads(scope);
		const threads = raw.map((t) => buildThreadSidebarLightRow(t, now));
		console.log(`[perf][main] threads:listLight total=${(performance.now() - t0).toFixed(1)}ms count=${threads.length}`);
		return { threads, currentId: getCurrentThreadId(scope) };
	});

	ipcMain.handle('threads:listDetails', async (event, rawVersions: unknown) => {
		const t0 = performance.now();
		const scope = senderWorkspaceRoot(event);
		ensureDefaultThread(scope);
		const now = Date.now();
		const raw = listThreads(scope);
		const requestedVersions = parseRequestedThreadVersions(rawVersions);
		console.log(`[perf][main] threads:listDetails listThreads=${(performance.now() - t0).toFixed(1)}ms count=${raw.length}`);
		const threads = [];
		let cacheHits = 0;
		let cacheMissesSinceYield = 0;
		let rowsSinceYield = 0;
		for (let i = 0; i < raw.length; i++) {
			const t = raw[i]!;
			if (requestedVersions && requestedVersions.get(t.id) !== t.updatedAt) {
				continue;
			}
			const { row, cacheHit } = buildThreadSidebarRow(t, now, scope);
			threads.push(row);
			cacheHits += cacheHit ? 1 : 0;
			cacheMissesSinceYield += cacheHit ? 0 : 1;
			rowsSinceYield += 1;
			if (cacheMissesSinceYield >= THREAD_SUMMARIZE_BATCH || rowsSinceYield >= THREAD_CACHED_ROW_BATCH) {
				cacheMissesSinceYield = 0;
				rowsSinceYield = 0;
				await yieldToEventLoop();
			}
		}
		console.log(`[perf][main] threads:listDetails total=${(performance.now() - t0).toFixed(1)}ms summarized=${threads.length} cacheHits=${cacheHits}`);
		// Prune cached summaries for threads that no longer exist in this workspace.
		pruneSummaryCache(new Set(raw.map((t) => t.id)), scope);
		return { threads, currentId: getCurrentThreadId(scope) };
	});

	ipcMain.handle('threads:list', async (event) => {
		const t0 = performance.now();
		const scope = senderWorkspaceRoot(event);
		ensureDefaultThread(scope);
		const now = Date.now();
		const raw = listThreads(scope);
		console.log(`[perf][main] threads:list listThreads=${(performance.now() - t0).toFixed(1)}ms count=${raw.length}`);
		const threads = [];
		let cacheHits = 0;
		let cacheMissesSinceYield = 0;
		let rowsSinceYield = 0;
		for (let i = 0; i < raw.length; i++) {
			const t = raw[i]!;
			const { row, cacheHit } = buildThreadSidebarRow(t, now, scope);
			threads.push(row);
			cacheHits += cacheHit ? 1 : 0;
			cacheMissesSinceYield += cacheHit ? 0 : 1;
			rowsSinceYield += 1;
			if (cacheMissesSinceYield >= THREAD_SUMMARIZE_BATCH || rowsSinceYield >= THREAD_CACHED_ROW_BATCH) {
				cacheMissesSinceYield = 0;
				rowsSinceYield = 0;
				await yieldToEventLoop();
			}
		}
		console.log(`[perf][main] threads:list total=${(performance.now() - t0).toFixed(1)}ms summarized=${threads.length} cacheHits=${cacheHits}`);
		pruneSummaryCache(new Set(raw.map((t) => t.id)), scope);
		return { threads, currentId: getCurrentThreadId(scope) };
	});

	ipcMain.handle('threads:listAgentSidebar', async (event, rawPaths: unknown) => {
		const activeRoot = senderWorkspaceRoot(event);
		const paths = Array.isArray(rawPaths)
			? rawPaths.map((p) => String(p ?? '').trim()).filter((p) => p.length > 0)
			: [];
		const now = Date.now();
		const workspaces = [];
		for (const dirPath of paths) {
			let resolved: string;
			try {
				resolved = path.resolve(dirPath);
				if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
					workspaces.push({ requestedPath: dirPath, resolvedPath: null as string | null, threads: [], currentId: null as string | null });
					continue;
				}
			} catch {
				workspaces.push({ requestedPath: dirPath, resolvedPath: null, threads: [], currentId: null });
				continue;
			}
			if (activeRoot && workspaceRootsEqual(resolved, activeRoot)) {
				ensureDefaultThread(activeRoot);
			}
			const raw = listThreads(resolved);
			const threads = [];
			let cacheMissesSinceYield = 0;
			let rowsSinceYield = 0;
			for (let i = 0; i < raw.length; i++) {
				const t = raw[i]!;
				const { row, cacheHit } = buildThreadSidebarRow(t, now, resolved);
				threads.push(row);
				cacheMissesSinceYield += cacheHit ? 0 : 1;
				rowsSinceYield += 1;
				if (cacheMissesSinceYield >= THREAD_SUMMARIZE_BATCH || rowsSinceYield >= THREAD_CACHED_ROW_BATCH) {
					cacheMissesSinceYield = 0;
					rowsSinceYield = 0;
					await yieldToEventLoop();
				}
			}
			pruneSummaryCache(new Set(raw.map((t) => t.id)), resolved);
			workspaces.push({ requestedPath: dirPath, resolvedPath: resolved, threads, currentId: getCurrentThreadId(resolved) });
		}
		return { workspaces };
	});

	ipcMain.handle('threads:fileStates', (_e, threadId: string) => {
		const t = getThread(threadId);
		if (!t) {
			return { ok: false as const };
		}
		return { ok: true as const, fileStates: t.fileStates ?? {} };
	});


	ipcMain.handle('threads:messages', (_e, threadId: string) => {
		const t = getThread(threadId);
		if (!t) {
			return { ok: false as const };
		}
		return {
			ok: true as const,
			messages: t.messages.filter((m) => m.role !== 'system'),
			schemaVersion: t.schemaVersion,
			teamSession: t.teamSession ?? null,
			agentSession: getManagedAgentSession(threadId) ?? getAgentSession(threadId),
		};
	});

	ipcMain.handle('threads:create', (event) => {
		const t = createThread(senderWorkspaceRoot(event));
		return { id: t.id };
	});

	ipcMain.handle('threads:select', (event, id: string, workspaceRootOverride?: unknown) => {
		const scope = resolveWorkspaceScopeForThreads(event, workspaceRootOverride);
		const t = selectThread(scope, id);
		return { ok: !!t };
	});

	ipcMain.handle('threads:delete', (event, id: string, workspaceRootOverride?: unknown) => {
		const scope = resolveWorkspaceScopeForThreads(event, workspaceRootOverride);
		deleteThread(scope, id);
		ensureDefaultThread(scope);
		return { ok: true as const, currentId: getCurrentThreadId(scope) };
	});

	ipcMain.handle('threads:rename', (event, id: string, title: string, workspaceRootOverride?: unknown) => {
		const scope = resolveWorkspaceScopeForThreads(event, workspaceRootOverride);
		const ok = setThreadTitle(scope, String(id ?? ''), String(title ?? ''));
		return { ok };
	});

	ipcMain.handle('threads:getExecutedPlanKeys', (_e, threadId: string) => {
		const id = String(threadId ?? '');
		if (!id) {
			return { ok: false as const };
		}
		return { ok: true as const, keys: getExecutedPlanFileKeys(id) };
	});

	ipcMain.handle(
		'threads:markPlanExecuted',
		(_e, payload: { threadId?: string; pathKey?: string }) => {
			const threadId = String(payload?.threadId ?? '');
			const pathKey = String(payload?.pathKey ?? '');
			if (!threadId || !pathKey) {
				return { ok: false as const };
			}
			markPlanFileExecuted(threadId, pathKey);
			return { ok: true as const };
		}
	);

	ipcMain.handle('agent:applyDiffChunk', (event, payload: { threadId?: string; chunk?: string }) => {
		const threadId = String(payload?.threadId ?? '');
		const chunk = typeof payload?.chunk === 'string' ? payload.chunk : '';
		if (!threadId || !chunk) {
			return { applied: [] as string[], failed: [{ path: '(invalid)', reason: '参数无效' }] };
		}
		const ar = applyAgentDiffChunk(chunk, senderWorkspaceRoot(event));
		const statsDir = activeUsageStatsDir();
		if (statsDir && ar.applied.length > 0) {
			const { add, del } = countDiffLinesInChunk(chunk);
			recordAgentLineDelta(statsDir, { add, del });
		}
		const inc = formatAgentApplyIncremental(ar);
		if (inc) {
			appendToLastAssistant(threadId, inc);
		}
		return ar;
	});

	ipcMain.handle(
		'agent:applyDiffChunks',
		(event, payload: { threadId?: string; items?: { id?: string; chunk?: string }[] }) => {
			const threadId = String(payload?.threadId ?? '');
			const raw = Array.isArray(payload?.items) ? payload!.items : [];
			const items = raw
				.map((x) => ({
					id: typeof x?.id === 'string' ? x.id : '',
					chunk: typeof x?.chunk === 'string' ? x.chunk : '',
				}))
				.filter((x) => x.id && x.chunk);
			if (!threadId || items.length === 0) {
				return {
					applied: [] as string[],
					failed: [{ path: '(invalid)', reason: '参数无效' }],
					succeededIds: [] as string[],
				};
			}
			const ar = applyAgentPatchItems(items, senderWorkspaceRoot(event));
			const statsDir = activeUsageStatsDir();
			if (statsDir && ar.succeededIds.length > 0) {
				const ok = new Set(ar.succeededIds);
				for (const it of items) {
					if (ok.has(it.id)) {
						const { add, del } = countDiffLinesInChunk(it.chunk);
						recordAgentLineDelta(statsDir, { add, del });
					}
				}
			}
			const { succeededIds, ...rest } = ar;
			const foot = formatAgentApplyFooter(rest);
			if (foot) {
				appendToLastAssistant(threadId, foot);
			}
			return ar;
		}
	);

	function sanitizeUserMessagePartsPayload(raw: unknown): UserMessagePart[] | undefined {
		if (!Array.isArray(raw) || raw.length === 0) {
			return undefined;
		}
		const out: UserMessagePart[] = [];
		for (const item of raw) {
			if (!item || typeof item !== 'object') continue;
			const r = item as Record<string, unknown>;
			const kind = r.kind;
			if (kind === 'text') {
				const text = typeof r.text === 'string' ? r.text : '';
				if (text.length > 0) out.push({ kind: 'text', text });
			} else if (kind === 'command') {
				const cmd = typeof r.command === 'string' ? r.command : '';
				if (cmd.length > 0) out.push({ kind: 'command', command: cmd });
			} else if (kind === 'file_ref') {
				const rel = typeof r.relPath === 'string' ? r.relPath.trim() : '';
				if (rel.length > 0) out.push({ kind: 'file_ref', relPath: rel });
			} else if (kind === 'image_ref') {
				const rel = typeof r.relPath === 'string' ? r.relPath.trim() : '';
				const mimeType = typeof r.mimeType === 'string' ? r.mimeType : '';
				if (rel.length === 0) continue;
				out.push({
					kind: 'image_ref',
					relPath: rel,
					mimeType: mimeType || 'application/octet-stream',
					sizeBytes: typeof r.sizeBytes === 'number' ? r.sizeBytes : 0,
					width: typeof r.width === 'number' ? r.width : 0,
					height: typeof r.height === 'number' ? r.height : 0,
					sha256: typeof r.sha256 === 'string' ? r.sha256 : '',
				});
			} else if (kind === 'skill_invoke') {
				const rawSlug = typeof r.slug === 'string' ? r.slug.trim().replace(/^\.\//, '') : '';
				const name = typeof r.name === 'string' ? r.name.trim() : '';
				if (rawSlug.length === 0) continue;
				out.push({
					kind: 'skill_invoke',
					slug: rawSlug,
					name: name.length > 0 ? name : rawSlug,
				});
			}
		}
		return out.length > 0 ? out : undefined;
	}

	ipcMain.handle(
		'chat:send',
		async (
			event,
			payload: {
				threadId: string;
				text: string;
				parts?: unknown;
				mode?: string;
				modelId?: string;
				streamNonce?: number;
				skillCreator?: { userNote: string; scope: SkillCreatorScope };
				ruleCreator?: { userNote: string; ruleScope: AgentRuleScope; globPattern?: string };
				subagentCreator?: { userNote: string; scope: SubagentCreatorScope };
				/** Plan Build：完整计划写入系统上下文，可见用户气泡仅短触发语 */
				planExecute?: { fromAbsPath?: string; inlineMarkdown?: string; planTitle?: string };
			}
		) => {
			const { threadId, text } = payload;
			const streamNonce = typeof payload.streamNonce === 'number' ? payload.streamNonce : undefined;
			const mode = parseComposerMode(payload.mode);
			const rawMid = payload.modelId;
			const modelSelection = typeof rawMid === 'string' ? rawMid.trim() : '';
			const win = BrowserWindow.fromWebContents(event.sender);
			if (!win) {
				return { ok: false as const, error: 'no-window' as const };
			}
			if (!modelSelection || modelSelection.toLowerCase() === 'auto') {
				return { ok: false as const, error: 'no-model' as const };
			}

			const chatSendLatencyT0 = Date.now();
			logChatPipelineLatency('chat:ipc', threadId, chatSendLatencyT0, 'chat:send entered', {
				mode: String(mode),
				streamNonce: typeof streamNonce === 'number' ? streamNonce : -1,
			});
			const preflightAc = new AbortController();
			preflightAbortByThread.get(threadId)?.abort();
			preflightAbortByThread.set(threadId, preflightAc);

			try {
				const settings = getSettings();
				const root = senderWorkspaceRoot(event);
				let workspaceFiles: string[] = [];
				if (root) {
					try {
						workspaceFiles = await ensureWorkspaceFileIndex(root, preflightAc.signal);
					} catch {
						workspaceFiles = [];
					}
				}
				throwIfAbortRequested(preflightAc.signal, threadId, 'ensureWorkspaceFileIndex');
				logChatPipelineLatency('chat:ipc', threadId, chatSendLatencyT0, 'after ensureWorkspaceFileIndex', {
					fileCount: workspaceFiles.length,
					hasRoot: Boolean(root),
				});
				const projectAgent = readWorkspaceAgentProjectSlice(root);
				const agentForTurn = mergeAgentWithPluginRuntime(
					mergeAgentWithProjectSlice(settings.agent, projectAgent),
					root
				);
				const lang = settings.language === 'en' ? 'en' : 'zh-CN';
				const threadTitleRuleContext = buildThreadTitleRuleAppend({
					agent: agentForTurn,
					workspaceRoot: root,
					uiLanguage: lang,
				});

			const skillIn = payload.skillCreator;
			if (skillIn && typeof skillIn.userNote === 'string') {
				/** Slash /create-skill：固定 Agent，否则 Plan 无写盘工具、Ask 无工具 */
				const creatorAgentMode: ComposerMode = 'agent';
				const scope: SkillCreatorScope = skillIn.scope === 'project' ? 'project' : 'user';
				if (scope === 'project' && !root) {
					return { ok: false as const, error: 'no-workspace' as const };
				}
				const prepared = prepareUserTurnForChat(skillIn.userNote, agentForTurn, root, workspaceFiles, lang);
				const visible = formatSkillCreatorUserBubble(scope, lang, skillIn.userNote);
				const skillBlock = buildSkillCreatorSystemAppend(scope, lang, root);
				let finalSystemAppend = prepared.agentSystemAppend
					? `${prepared.agentSystemAppend}\n\n---\n\n${skillBlock}`
					: skillBlock;
				finalSystemAppend = await appendMemoryAndRetrievalContext({
					base: finalSystemAppend,
					mode: creatorAgentMode,
					settings,
					root,
					signal: preflightAc.signal,
				});
				throwIfAbortRequested(preflightAc.signal, threadId, 'skillCreator preflight');
				finalSystemAppend = appendPlanExecuteToSystem(finalSystemAppend, payload.planExecute, root);
				const t = appendMessage(threadId, { role: 'user', content: visible });
				if (t.titleSource !== 'manual' && t.messages.filter((message) => message.role === 'user').length === 1) {
					queueThreadTitleGeneration({
						sender: event.sender,
						threadId,
						description: visible,
						settings,
						modelSelection,
						ruleContext: threadTitleRuleContext,
					});
				}
				runChatStream(win, threadId, t.messages, creatorAgentMode, modelSelection, finalSystemAppend, streamNonce);
				return { ok: true as const };
			}

			const ruleIn = payload.ruleCreator;
			if (ruleIn && typeof ruleIn.userNote === 'string') {
				const creatorAgentMode: ComposerMode = 'agent';
				const ruleScope: AgentRuleScope =
					ruleIn.ruleScope === 'glob' || ruleIn.ruleScope === 'manual' ? ruleIn.ruleScope : 'always';
				const prepared = prepareUserTurnForChat(ruleIn.userNote, agentForTurn, root, workspaceFiles, lang);
				const visible = formatRuleCreatorUserBubble(ruleScope, ruleIn.globPattern, lang, ruleIn.userNote);
				const ruleBlock = buildRuleCreatorSystemAppend(ruleScope, ruleIn.globPattern, lang, root);
				let finalSystemAppend = prepared.agentSystemAppend
					? `${prepared.agentSystemAppend}\n\n---\n\n${ruleBlock}`
					: ruleBlock;
				finalSystemAppend = await appendMemoryAndRetrievalContext({
					base: finalSystemAppend,
					mode: creatorAgentMode,
					settings,
					root,
					signal: preflightAc.signal,
				});
				throwIfAbortRequested(preflightAc.signal, threadId, 'ruleCreator preflight');
				finalSystemAppend = appendPlanExecuteToSystem(finalSystemAppend, payload.planExecute, root);
				finalSystemAppend = appendRuleCreatorPathLock(
					finalSystemAppend,
					settings.language === 'en' ? 'en' : 'zh-CN',
					Boolean(root)
				);
				const t = appendMessage(threadId, { role: 'user', content: visible });
				if (t.titleSource !== 'manual' && t.messages.filter((message) => message.role === 'user').length === 1) {
					queueThreadTitleGeneration({
						sender: event.sender,
						threadId,
						description: visible,
						settings,
						modelSelection,
						ruleContext: threadTitleRuleContext,
					});
				}
				runChatStream(win, threadId, t.messages, creatorAgentMode, modelSelection, finalSystemAppend, streamNonce);
				return { ok: true as const };
			}

			const subIn = payload.subagentCreator;
			if (subIn && typeof subIn.userNote === 'string') {
				const creatorAgentMode: ComposerMode = 'agent';
				const scope: SubagentCreatorScope = subIn.scope === 'project' ? 'project' : 'user';
				if (scope === 'project' && !root) {
					return { ok: false as const, error: 'no-workspace' as const };
				}
				const prepared = prepareUserTurnForChat(subIn.userNote, agentForTurn, root, workspaceFiles, lang);
				const visible = formatSubagentCreatorUserBubble(scope, lang, subIn.userNote);
				const subBlock = buildSubagentCreatorSystemAppend(scope, lang, root);
				let finalSystemAppend = prepared.agentSystemAppend
					? `${prepared.agentSystemAppend}\n\n---\n\n${subBlock}`
					: subBlock;
				finalSystemAppend = await appendMemoryAndRetrievalContext({
					base: finalSystemAppend,
					mode: creatorAgentMode,
					settings,
					root,
					signal: preflightAc.signal,
				});
				throwIfAbortRequested(preflightAc.signal, threadId, 'subagentCreator preflight');
				finalSystemAppend = appendPlanExecuteToSystem(finalSystemAppend, payload.planExecute, root);
				const t = appendMessage(threadId, { role: 'user', content: visible });
				if (t.titleSource !== 'manual' && t.messages.filter((message) => message.role === 'user').length === 1) {
					queueThreadTitleGeneration({
						sender: event.sender,
						threadId,
						description: visible,
						settings,
						modelSelection,
						ruleContext: threadTitleRuleContext,
					});
				}
				runChatStream(win, threadId, t.messages, creatorAgentMode, modelSelection, finalSystemAppend, streamNonce);
				return { ok: true as const };
			}

			const { userText, agentSystemAppend } = prepareUserTurnForChat(
				text,
				agentForTurn,
				root,
				workspaceFiles,
				lang
			);

			let finalSystemAppend = agentSystemAppend;
			finalSystemAppend = await appendMemoryAndRetrievalContext({
				base: finalSystemAppend,
				mode,
				settings,
				root,
				signal: preflightAc.signal,
			});
			throwIfAbortRequested(preflightAc.signal, threadId, 'chat preflight');
			logChatPipelineLatency('chat:ipc', threadId, chatSendLatencyT0, 'after appendMemoryAndRetrievalContext', {
				mode: String(mode),
			});

			finalSystemAppend = appendPlanExecuteToSystem(finalSystemAppend, payload.planExecute, root);

			const userParts = sanitizeUserMessagePartsPayload(payload.parts);
			const t = appendMessage(
				threadId,
				userParts
					? { role: 'user', content: userText, parts: userParts }
					: { role: 'user', content: userText }
			);
			if (t.titleSource !== 'manual' && t.messages.filter((message) => message.role === 'user').length === 1) {
				queueThreadTitleGeneration({
					sender: event.sender,
					threadId,
					description: userText,
					settings,
					modelSelection,
					ruleContext: threadTitleRuleContext,
				});
			}
			logChatPipelineLatency('chat:ipc', threadId, chatSendLatencyT0, 'before runChatStream (IPC returns soon)', {
				persistedMsgCount: t.messages.length,
			});
			runChatStream(win, threadId, t.messages, mode, modelSelection, finalSystemAppend, streamNonce);

			return { ok: true as const };
			} catch (e) {
				if (preflightAc.signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
					return { ok: false as const, error: 'aborted' as const };
				}
				throw e;
			} finally {
				if (preflightAbortByThread.get(threadId) === preflightAc) {
					preflightAbortByThread.delete(threadId);
				}
			}
		}
	);

	ipcMain.handle(
		'chat:editResend',
		async (
			event,
			payload: {
				threadId: string;
				visibleIndex: number;
				text: string;
				parts?: unknown;
				mode?: string;
				modelId?: string;
				streamNonce?: number;
			}
		) => {
			const { threadId, visibleIndex, text } = payload;
			const streamNonce = typeof payload.streamNonce === 'number' ? payload.streamNonce : undefined;
			const mode = parseComposerMode(payload.mode);
			const rawMid = payload.modelId;
			const modelSelection = typeof rawMid === 'string' ? rawMid.trim() : '';
			const win = BrowserWindow.fromWebContents(event.sender);
			if (!win) {
				return { ok: false as const, error: 'no-window' as const };
			}
			if (!modelSelection || modelSelection.toLowerCase() === 'auto') {
				return { ok: false as const, error: 'no-model' as const };
			}
			const trimmed = typeof text === 'string' ? text.trim() : '';
			if (!trimmed) {
				return { ok: false as const, error: 'empty-text' as const };
			}
			if (!Number.isInteger(visibleIndex) || visibleIndex < 0) {
				return { ok: false as const, error: 'bad-index' as const };
			}
			const preflightAc = new AbortController();
			preflightAbortByThread.get(threadId)?.abort();
			preflightAbortByThread.set(threadId, preflightAc);
			try {
				const settings = getSettings();
				const root = senderWorkspaceRoot(event);
				let workspaceFiles: string[] = [];
				if (root) {
					try {
						workspaceFiles = await ensureWorkspaceFileIndex(root, preflightAc.signal);
					} catch {
						workspaceFiles = [];
					}
				}
				throwIfAbortRequested(preflightAc.signal, threadId, 'editResend ensureWorkspaceFileIndex');
				const projectAgent = readWorkspaceAgentProjectSlice(root);
				const agentForTurn = mergeAgentWithPluginRuntime(
					mergeAgentWithProjectSlice(settings.agent, projectAgent),
					root
				);
				const lang = settings.language === 'en' ? 'en' : 'zh-CN';
				const threadTitleRuleContext = buildThreadTitleRuleAppend({
					agent: agentForTurn,
					workspaceRoot: root,
					uiLanguage: lang,
				});
				const { userText, agentSystemAppend } = prepareUserTurnForChat(
					trimmed,
					agentForTurn,
					root,
					workspaceFiles,
					lang
				);

				let finalSystemAppend = agentSystemAppend;
				finalSystemAppend = await appendMemoryAndRetrievalContext({
					base: finalSystemAppend,
					mode,
					settings,
					root,
					signal: preflightAc.signal,
				});
				throwIfAbortRequested(preflightAc.signal, threadId, 'editResend preflight');

				const editParts = sanitizeUserMessagePartsPayload(payload.parts);
				const t = replaceFromUserVisibleIndex(threadId, visibleIndex, userText, editParts);
				if (visibleIndex === 0 && t.titleSource !== 'manual') {
					queueThreadTitleGeneration({
						sender: event.sender,
						threadId,
						description: userText,
						settings,
						modelSelection,
						ruleContext: threadTitleRuleContext,
					});
				}
				runChatStream(win, threadId, t.messages, mode, modelSelection, finalSystemAppend, streamNonce);
				return { ok: true as const };
			} catch (e) {
				if (preflightAc.signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
					return { ok: false as const, error: 'aborted' as const };
				}
				return { ok: false as const, error: 'replace-failed' as const };
			} finally {
				if (preflightAbortByThread.get(threadId) === preflightAc) {
					preflightAbortByThread.delete(threadId);
				}
			}
		}
	);

	ipcMain.handle('chat:abort', (_e, threadId: string) => {
		abortPlanQuestionWaitersForThread(threadId);
		abortRequestUserInputWaitersForThread(threadId);
		abortTeamPlanApprovalForThread(threadId);
		preflightAbortByThread.get(threadId)?.abort();
		preflightAbortByThread.delete(threadId);
		abortByThread.get(threadId)?.abort();
		abortByThread.delete(threadId);
		const prefix = `ta-${threadId}-`;
		for (const [id, fn] of [...toolApprovalWaiters.entries()]) {
			if (id.startsWith(prefix)) {
				toolApprovalWaiters.delete(id);
				fn(false);
			}
		}
		const prefixMl = `ml-${threadId}-`;
		for (const [id, fn] of [...mistakeLimitWaiters.entries()]) {
			if (id.startsWith(prefixMl)) {
				mistakeLimitWaiters.delete(id);
				fn({ action: 'stop' });
			}
		}
		return { ok: true };
	});

	ipcMain.handle('agent:getSession', (event, threadId: string) => {
		const session =
			getManagedAgentSession(String(threadId ?? '').trim()) ??
			getAgentSession(String(threadId ?? '').trim()) ??
			null;
		if (session) {
			attachManagedAgentEmitter(String(threadId ?? '').trim(), (evt) => {
				event.sender.send('async-shell:chat', evt);
			});
		}
		return { ok: true as const, session };
	});

	ipcMain.handle('agent:sendInput', async (event, payload: { threadId?: string; agentId?: string; message?: string; interrupt?: boolean }) => {
		const threadId = String(payload?.threadId ?? '').trim();
		const agentId = String(payload?.agentId ?? '').trim();
		const message = String(payload?.message ?? '').trim();
		if (!threadId || !agentId || !message) {
			return { ok: false as const, error: 'missing agent input payload' };
		}
		const workspaceRoot = senderWorkspaceRoot(event);
		const settings = getSettings();
		const options = resolveManagedAgentLoopOptions(
			settings,
			workspaceRoot,
			getWorkspaceLspManagerForWebContents(event.sender),
			event.sender.id
		);
		if (!options) {
			return { ok: false as const, error: 'no-model' };
		}
		options.deferredToolState = getDeferredToolState(threadId);
		options.onDeferredToolStateChange = (state) => saveDeferredToolState(threadId, state);
		options.contextCompactState = getContextCompactState(threadId);
		options.onContextCompactStateChange = (state) => saveContextCompactState(threadId, state);
		options.toolResultReplacementState = getToolResultReplacementState(threadId);
		options.onToolResultReplacementStateChange = (state) =>
			saveToolResultReplacementState(threadId, state);
		const send = (evt: import('../agent/managedSubagents.js').ManagedAgentUiEvent) =>
			event.sender.send('async-shell:chat', evt);
		const result = await sendInputToManagedAgent({
			threadId,
			agentId,
			message,
			interrupt: payload?.interrupt === true,
			settings,
			options,
			emit: send,
		});
		return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
	});

	ipcMain.handle('agent:wait', async (_event, payload: { threadId?: string; agentIds?: string[]; timeoutMs?: number }) => {
		const threadId = String(payload?.threadId ?? '').trim();
		const agentIds = Array.isArray(payload?.agentIds)
			? payload.agentIds.map((value) => String(value ?? '').trim()).filter(Boolean)
			: [];
		if (!threadId || agentIds.length === 0) {
			return { ok: false as const, error: 'missing wait payload' };
		}
		const timeoutMsRaw = Number(payload?.timeoutMs ?? 30000);
		const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 30000;
		const statuses = await waitForManagedAgents(threadId, agentIds, timeoutMs);
		return {
			ok: true as const,
			statuses,
			timedOut: Object.keys(statuses).length < agentIds.length,
		};
	});

	ipcMain.handle('agent:resume', async (event, payload: { threadId?: string; agentId?: string }) => {
		const threadId = String(payload?.threadId ?? '').trim();
		const agentId = String(payload?.agentId ?? '').trim();
		if (!threadId || !agentId) {
			return { ok: false as const, error: 'missing resume payload' };
		}
		const workspaceRoot = senderWorkspaceRoot(event);
		const settings = getSettings();
		const options = resolveManagedAgentLoopOptions(
			settings,
			workspaceRoot,
			getWorkspaceLspManagerForWebContents(event.sender),
			event.sender.id
		);
		if (!options) {
			return { ok: false as const, error: 'no-model' };
		}
		options.deferredToolState = getDeferredToolState(threadId);
		options.onDeferredToolStateChange = (state) => saveDeferredToolState(threadId, state);
		options.contextCompactState = getContextCompactState(threadId);
		options.onContextCompactStateChange = (state) => saveContextCompactState(threadId, state);
		options.toolResultReplacementState = getToolResultReplacementState(threadId);
		options.onToolResultReplacementStateChange = (state) =>
			saveToolResultReplacementState(threadId, state);
		const send = (evt: import('../agent/managedSubagents.js').ManagedAgentUiEvent) =>
			event.sender.send('async-shell:chat', evt);
		const result = await resumeManagedAgent({
			threadId,
			agentId,
			settings,
			options,
			emit: send,
		});
		return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
	});

	ipcMain.handle('agent:close', (event, payload: { threadId?: string; agentId?: string }) => {
		const threadId = String(payload?.threadId ?? '').trim();
		const agentId = String(payload?.agentId ?? '').trim();
		if (!threadId || !agentId) {
			return { ok: false as const, error: 'missing close payload' };
		}
		const send = (evt: import('../agent/managedSubagents.js').ManagedAgentUiEvent) =>
			event.sender.send('async-shell:chat', evt);
		const result = closeManagedAgent({ threadId, agentId, emit: send });
		return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
	});

	ipcMain.handle(
		'agent:userInputRespond',
		(_e, payload: { requestId?: string; answers?: Record<string, unknown> }) => {
			const requestId = String(payload?.requestId ?? '');
			if (!requestId) {
				return { ok: false as const, error: 'missing requestId' as const };
			}
			const ok = resolveRequestUserInput(requestId, {
				answers: payload?.answers,
			});
			return ok ? ({ ok: true as const } as const) : ({ ok: false as const, error: 'unknown request' as const });
		}
	);

	ipcMain.handle(
		'agent:toolApprovalRespond',
		(_e, payload: { approvalId: string; approved: boolean }) => {
			const id = String(payload?.approvalId ?? '');
			if (!id) return { ok: false as const, error: 'missing id' };
			resolveToolApproval(toolApprovalWaiters, id, Boolean(payload.approved));
			return { ok: true as const };
		}
	);

	ipcMain.handle(
		'plan:toolQuestionRespond',
		(
			_e,
			payload: { requestId?: string; skipped?: boolean; answerText?: string }
		) => {
			const requestId = String(payload?.requestId ?? '');
			if (!requestId) return { ok: false as const, error: 'missing requestId' as const };
			const ok = resolvePlanQuestionTool(requestId, {
				skipped: Boolean(payload?.skipped),
				answerText: typeof payload?.answerText === 'string' ? payload.answerText : undefined,
			});
			return ok ? ({ ok: true as const } as const) : ({ ok: false as const, error: 'unknown request' as const });
		}
	);

	ipcMain.handle(
		'team:planApprovalRespond',
		(
			_e,
			payload: { proposalId?: string; approved?: boolean; feedbackText?: string }
		) => {
			const proposalId = String(payload?.proposalId ?? '');
			if (!proposalId) return { ok: false as const, error: 'missing proposalId' as const };
			const ok = resolveTeamPlanApproval(proposalId, {
				approved: Boolean(payload?.approved),
				feedbackText: typeof payload?.feedbackText === 'string' ? payload.feedbackText : undefined,
			});
			return ok ? ({ ok: true as const } as const) : ({ ok: false as const, error: 'unknown request' as const });
		}
	);

	ipcMain.handle(
		'agent:mistakeLimitRespond',
		(
			_e,
			payload: {
				recoveryId?: string;
				action?: string;
				hint?: string;
			}
		) => {
			const id = String(payload?.recoveryId ?? '');
			if (!id) return { ok: false as const, error: 'missing id' as const };
			const act = String(payload?.action ?? 'continue');
			let decision: MistakeLimitDecision;
			if (act === 'stop') {
				decision = { action: 'stop' };
			} else if (act === 'hint') {
				const h = String(payload?.hint ?? '').trim();
				decision = h ? { action: 'hint', userText: h } : { action: 'continue' };
			} else {
				decision = { action: 'continue' };
			}
			resolveMistakeLimitRecovery(mistakeLimitWaiters, id, decision);
			return { ok: true as const };
		}
	);


	ipcMain.handle('agent:keepLastTurn', (_e, threadId: string) => {
		agentRevertSnapshotsByThread.delete(threadId);
		return { ok: true as const };
	});

	ipcMain.handle('agent:revertLastTurn', (event, threadId: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const snapshots = agentRevertSnapshotsByThread.get(threadId);
		if (!snapshots || snapshots.size === 0) {
			return { ok: true as const, reverted: 0 };
		}

		for (const [relPath, previousContent] of Array.from(snapshots.entries()).reverse()) {
			const full = resolveWorkspacePath(relPath, root);
			if (previousContent === null) {
				if (fs.existsSync(full)) {
					fs.unlinkSync(full);
				}
				continue;
			}
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, previousContent, 'utf8');
		}

		agentRevertSnapshotsByThread.delete(threadId);
		return { ok: true as const, reverted: snapshots.size };
	});

	ipcMain.handle('agent:keepFile', (_e, threadId: string, relPath: string) => {
		const snapshots = agentRevertSnapshotsByThread.get(threadId);
		if (!snapshots) return { ok: true as const };
		snapshots.delete(relPath);
		if (snapshots.size === 0) agentRevertSnapshotsByThread.delete(threadId);
		return { ok: true as const };
	});

ipcMain.handle('agent:getFileSnapshot', (_e, threadId: string, relPath: string) => {
	const snapshots = agentRevertSnapshotsByThread.get(String(threadId ?? ''));
	if (!snapshots || !snapshots.has(relPath)) {
		return { ok: true as const, hasSnapshot: false as const };
	}
		return {
			ok: true as const,
			hasSnapshot: true as const,
		previousContent: snapshots.get(relPath) ?? null,
	};
});

ipcMain.handle(
	'agent:seedFileSnapshot',
	(_e, payload: { threadId?: string; relPath?: string; content?: string; diff?: string }) => {
		const threadId = String(payload?.threadId ?? '');
		const relPath = String(payload?.relPath ?? '');
		const diff = normalizePatchChunk(payload?.diff ?? '');
		const currentContent = typeof payload?.content === 'string' ? payload.content : '';
		if (!threadId || !relPath || !diff) {
			return { ok: false as const, error: 'invalid-payload' as const };
		}
		const reversed = reverseUnifiedPatch(diff);
		if (!reversed) {
			return { ok: false as const, error: 'reverse-failed' as const };
		}
		const baseline = applyPatch(currentContent, reversed, { fuzzFactor: 3 });
		if (baseline === false) {
			return { ok: false as const, error: 'apply-failed' as const };
		}
		const previousContent =
			/^new file mode\s/m.test(diff) || /^---\s+\/dev\/null$/m.test(diff)
				? null
				: baseline;
		const snapshots = agentRevertSnapshotsByThread.get(threadId) ?? new Map<string, string | null>();
		snapshots.set(relPath, previousContent);
		agentRevertSnapshotsByThread.set(threadId, snapshots);
		return {
			ok: true as const,
			seeded: true as const,
			previousLength: (previousContent ?? '').length,
		};
	}
);

	ipcMain.handle(
	'agent:acceptFileHunk',
	(event, payload: { threadId?: string; relPath?: string; chunk?: string }) => {
			const wr = senderWorkspaceRoot(event);
			const threadId = String(payload?.threadId ?? '');
			const relPath = String(payload?.relPath ?? '');
			const chunk = normalizePatchChunk(payload?.chunk ?? '');
			const snapshots = agentRevertSnapshotsByThread.get(threadId);
			if (!threadId || !relPath || !chunk || !snapshots || !snapshots.has(relPath)) {
				return { ok: false as const, error: 'missing-snapshot' as const };
			}
			if (!wr) {
				return { ok: false as const, error: 'no-workspace' as const };
			}

			const previousContent = snapshots.get(relPath) ?? null;
			const baseline = previousContent ?? '';
			const nextBaseline = applyPatch(baseline, chunk, { fuzzFactor: 3 });
			if (nextBaseline === false) {
				return { ok: false as const, error: 'apply-failed' as const };
			}

			const currentContent = readWorkspaceTextFileIfExists(relPath, wr);
			if (contentsEqual(nextBaseline, currentContent)) {
				snapshots.delete(relPath);
			} else {
				snapshots.set(relPath, nextBaseline);
			}
			if (snapshots.size === 0) {
				agentRevertSnapshotsByThread.delete(threadId);
			}
			return { ok: true as const, cleared: !snapshots.has(relPath) };
		}
	);

	ipcMain.handle(
		'agent:revertFileHunk',
		(event, payload: { threadId?: string; relPath?: string; chunk?: string }) => {
			const wr = senderWorkspaceRoot(event);
			const threadId = String(payload?.threadId ?? '');
			const relPath = String(payload?.relPath ?? '');
			const chunk = normalizePatchChunk(payload?.chunk ?? '');
			const snapshots = agentRevertSnapshotsByThread.get(threadId);
			if (!threadId || !relPath || !chunk || !snapshots || !snapshots.has(relPath)) {
				return { ok: false as const, error: 'missing-snapshot' as const };
			}
			if (!wr) {
				return { ok: false as const, error: 'no-workspace' as const };
			}

			const reversed = reverseUnifiedPatch(chunk);
			if (!reversed) {
				return { ok: false as const, error: 'reverse-failed' as const };
			}

			const previousContent = snapshots.get(relPath) ?? null;
			const currentContent = readWorkspaceTextFileIfExists(relPath, wr);
			const currentText = currentContent ?? '';
			const reverted = applyPatch(currentText, reversed, { fuzzFactor: 3 });
			if (reverted === false) {
				return { ok: false as const, error: 'apply-failed' as const };
			}

			const full = resolveWorkspacePath(relPath, wr);
			if (previousContent === null && reverted === '') {
				if (fs.existsSync(full)) {
					fs.unlinkSync(full);
				}
			} else {
				fs.mkdirSync(path.dirname(full), { recursive: true });
				fs.writeFileSync(full, reverted, 'utf8');
			}

			const nextContent = readWorkspaceTextFileIfExists(relPath, wr);
			if (contentsEqual(previousContent, nextContent)) {
				snapshots.delete(relPath);
			}
			if (snapshots.size === 0) {
				agentRevertSnapshotsByThread.delete(threadId);
			}
			return { ok: true as const, cleared: !snapshots.has(relPath) };
		}
	);

	ipcMain.handle('agent:revertFile', (event, threadId: string, relPath: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const snapshots = agentRevertSnapshotsByThread.get(threadId);
		if (!snapshots || !snapshots.has(relPath)) {
			return { ok: true as const, reverted: false };
		}
		const previousContent = snapshots.get(relPath)!;
		const full = resolveWorkspacePath(relPath, root);
		if (previousContent === null) {
			if (fs.existsSync(full)) fs.unlinkSync(full);
		} else {
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, previousContent, 'utf8');
		}
		snapshots.delete(relPath);
		if (snapshots.size === 0) agentRevertSnapshotsByThread.delete(threadId);
		return { ok: true as const, reverted: true };
	});


	ipcMain.handle(
		'plan:save',
		(event, payload: { filename: string; content: string }) => {
			try {
				const safe = String(payload.filename ?? 'plan.md')
					.replace(/[<>:"/\\|?*]/g, '_')
					.slice(0, 120);
				const content = String(payload.content ?? '');
				const wsRoot = senderWorkspaceRoot(event);
				if (wsRoot) {
					const dir = path.join(wsRoot, '.async', 'plans');
					fs.mkdirSync(dir, { recursive: true });
					const full = path.join(dir, safe);
					fs.writeFileSync(full, content, 'utf8');
					const relPath = path.join('.async', 'plans', safe).replace(/\\/g, '/');
					return { ok: true as const, path: full, relPath };
				}
				const dir = path.join(app.getPath('userData'), '.async', 'plans');
				fs.mkdirSync(dir, { recursive: true });
				const full = path.join(dir, safe);
				fs.writeFileSync(full, content, 'utf8');
				return { ok: true as const, path: full };
			} catch (e) {
				return { ok: false as const, error: String(e) };
			}
		}
	);

	ipcMain.handle('plan:saveStructured', (_e, payload: { threadId: string; plan: import('../threadStore.js').ThreadPlan }) => {
		try {
			savePlan(payload.threadId, payload.plan);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('threads:getPlan', (_e, threadId: string) => {
		const t = getThread(threadId);
		if (!t) {
			return { ok: false as const };
		}
		return { ok: true as const, plan: t.plan ?? null };
	});


	/** 自动更新：检查更新 */

}
