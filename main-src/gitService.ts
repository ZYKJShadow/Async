import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { isPathInsideRoot } from './workspace.js';

const execFileAsync = promisify(execFile);
const PROBE_CACHE_TTL_MS = 5000;

/** IPC 在调用 git 前用当前窗口的 workspace root 包裹异步逻辑。 */
const gitWorkspaceAls = new AsyncLocalStorage<string>();

export function withGitWorkspaceRootAsync<T>(root: string, fn: () => Promise<T>): Promise<T> {
	return gitWorkspaceAls.run(path.resolve(root), fn);
}

const GIT_MISSING_MESSAGE = 'Git is not installed';
const GIT_NOT_REPO_MESSAGE = 'Current workspace is not a Git repository';

type ExecFileLikeError = Error & {
	code?: string;
	stderr?: string;
	stdout?: string;
};

export type GitFailureKind = 'missing' | 'not_repo' | 'unknown';
type GitProbeResult = { ok: true; topLevel: string } | { ok: false; reason: GitFailureKind; message: string };
const gitProbeCache = new Map<string, { expiresAt: number; result: GitProbeResult }>();

function gitErrorText(error: unknown): string {
	if (error instanceof Error) {
		const extra = error as ExecFileLikeError;
		return [error.message, extra.stderr, extra.stdout].filter(Boolean).join('\n');
	}
	return String(error);
}

export function classifyGitFailure(error: unknown): GitFailureKind {
	const text = gitErrorText(error);
	const code =
		error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
	if (
		code === 'ENOENT' ||
		/\bENOENT\b/i.test(text) ||
		/\bnot found\b/i.test(text) ||
		/\bspawn\s+git(?:\.exe)?\b/i.test(text) ||
		/\bgit(?:\.exe)?\b.*\bnot recognized\b/i.test(text) ||
		/\bcannot find the file specified\b/i.test(text)
	) {
		return 'missing';
	}
	if (/not a git repository/i.test(text)) {
		return 'not_repo';
	}
	return 'unknown';
}

export function normalizeGitFailureMessage(error: unknown, fallback = 'Git command failed'): string {
	switch (classifyGitFailure(error)) {
		case 'missing':
			return GIT_MISSING_MESSAGE;
		case 'not_repo':
			return GIT_NOT_REPO_MESSAGE;
		default:
			return fallback;
	}
}

function repoRoot(): string {
	const root = gitWorkspaceAls.getStore();
	if (!root) {
		throw new Error('No workspace');
	}
	return root;
}

async function git(args: string[], cwd?: string): Promise<string> {
	const root = cwd ?? repoRoot();
	const { stdout, stderr } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
		cwd: root,
		maxBuffer: 10 * 1024 * 1024,
		windowsHide: true,
		encoding: 'utf8',
	});
	if (stderr && !stdout) {
		return stderr.trim();
	}
	// 只去掉末尾的空白字符,保留前导空格(对 git status --porcelain 很重要)
	return stdout.replace(/[\r\n]+$/, '');
}

/** 单次 `git diff HEAD`（全量），用于批量构建各文件预览，避免每文件起一个子进程。 */
export async function gitDiffHeadUnified(workspaceRootAbs: string): Promise<string> {
	const root = path.resolve(workspaceRootAbs);
	try {
		return await git(['diff', 'HEAD', '--no-ext-diff', '--unified=3'], root);
	} catch {
		return '';
	}
}

export async function gitBranch(): Promise<string> {
	try {
		return await git(['branch', '--show-current']);
	} catch {
		return '';
	}
}

export async function gitStatusPorcelain(): Promise<string> {
	try {
		/* 显式 v1，避免用户 alias / 将来默认把 --porcelain 变成 v2 导致解析失败 */
		return await git(['status', '--porcelain=v1']);
	} catch (e) {
		throw new Error(`Git status failed: ${String(e)}`);
	}
}

/** 当前工作区目录下的 Git 仓库根（绝对路径）；非仓库或失败时为 null */
export async function gitRevParseShowToplevel(): Promise<string | null> {
	const probe = await gitProbeContext();
	return probe.ok ? probe.topLevel : null;
}

export async function gitProbeContext(): Promise<GitProbeResult> {
	let ws: string;
	try {
		ws = repoRoot();
	} catch {
		return { ok: false, reason: 'unknown', message: 'No workspace' };
	}
	const key = path.resolve(ws).toLowerCase();
	const now = Date.now();
	const cached = gitProbeCache.get(key);
	if (cached && cached.expiresAt > now) {
		return cached.result;
	}
	try {
		const { stdout } = await execFileAsync(
			'git',
			['-c', 'core.quotepath=false', 'rev-parse', '--show-toplevel'],
			{
				cwd: ws,
				maxBuffer: 1024 * 1024,
				windowsHide: true,
				encoding: 'utf8',
			}
		);
		const line = stdout.trim();
		if (!line) {
			const result: GitProbeResult = { ok: false, reason: 'unknown', message: 'Git command failed' };
			gitProbeCache.set(key, { expiresAt: now + PROBE_CACHE_TTL_MS, result });
			return result;
		}
		const result: GitProbeResult = { ok: true, topLevel: path.resolve(line) };
		gitProbeCache.set(key, { expiresAt: now + PROBE_CACHE_TTL_MS, result });
		return result;
	} catch (error) {
		const reason = classifyGitFailure(error);
		const result: GitProbeResult = {
			ok: false,
			reason,
			message: normalizeGitFailureMessage(error),
		};
		gitProbeCache.set(key, { expiresAt: now + PROBE_CACHE_TTL_MS, result });
		return result;
	}
}

/**
 * `git status --porcelain` 的路径相对于仓库根；应用内路径相对于当前打开的文件夹。
 * 将仓库相对路径转为工作区相对路径；若文件不在当前工作区内则返回 null。
 */
export function workspaceRelativeFromRepoRelative(
	repoRelPath: string,
	workspaceRoot: string,
	gitTopLevel: string
): string | null {
	const norm = repoRelPath.replace(/\\/g, '/').replace(/^\.\//, '');
	const full = path.resolve(gitTopLevel, norm);
	const ws = path.resolve(workspaceRoot);
	if (!isPathInsideRoot(full, ws)) {
		return null;
	}
	const rel = path.relative(ws, full);
	if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
		return null;
	}
	return rel.split(path.sep).join('/');
}

/** 工作区相对路径 → 仓库相对路径（与 `workspaceRelativeFromRepoRelative` 互逆）。 */
export function repoRelativeFromWorkspaceRel(
	workspaceRelPath: string,
	workspaceRoot: string,
	gitTopLevel: string
): string | null {
	const norm = workspaceRelPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
	const full = path.resolve(workspaceRoot, norm);
	if (!isPathInsideRoot(full, gitTopLevel)) {
		return null;
	}
	const rel = path.relative(gitTopLevel, full);
	if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
		return null;
	}
	return rel.split(path.sep).join('/');
}

export type PathStatusEntry = { xy: string; label: string };

/** Single porcelain line → repo-relative path, or null if not a status line. */
export function pathFromPorcelainLine(raw: string): { xy: string; path: string } | null {
	const line = raw.trimEnd();
	if (line.length < 4 || line[2] !== ' ') {
		return null;
	}
	const xy = line.slice(0, 2);
	let rest = line.slice(3).trimEnd();
	if (rest.includes(' -> ')) {
		const idx = rest.lastIndexOf(' -> ');
		rest = rest.slice(idx + 4).trim();
	}
	if (rest.startsWith('"') && rest.endsWith('"')) {
		rest = rest
			.slice(1, -1)
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, '\\');
	}
	const norm = rest.replace(/\\/g, '/').replace(/^\.\//, '');
	if (!norm) {
		return null;
	}
	return { xy, path: norm };
}

/** Stable order of changed paths as in `git status --porcelain`. */
export function listPorcelainPaths(lines: string[]): string[] {
	const ordered: string[] = [];
	const seen = new Set<string>();
	for (const raw of lines) {
		const p = pathFromPorcelainLine(raw);
		if (!p || seen.has(p.path)) {
			continue;
		}
		seen.add(p.path);
		ordered.push(p.path);
	}
	return ordered;
}

/** Map repo-relative paths (forward slashes) to a short badge letter for UI. */
export function parseGitPathStatus(lines: string[]): Record<string, PathStatusEntry> {
	const out: Record<string, PathStatusEntry> = {};
	for (const raw of lines) {
		const parsed = pathFromPorcelainLine(raw);
		if (!parsed) {
			continue;
		}
		out[parsed.path] = { xy: parsed.xy, label: statusLabelFromXy(parsed.xy) };
	}
	return out;
}

function statusLabelFromXy(xy: string): string {
	if (xy === '??') {
		return 'U';
	}
	if (xy === '!!') {
		return 'I';
	}
	const i = xy[0] ?? ' ';
	const w = xy[1] ?? ' ';
	if (w === 'M' || i === 'M') {
		return 'M';
	}
	if (w === 'D' || i === 'D') {
		return 'D';
	}
	if (w === 'A' || i === 'A') {
		return 'A';
	}
	if (w === 'R' || i === 'R') {
		return 'R';
	}
	if (w === 'C' || i === 'C') {
		return 'C';
	}
	if (w === 'U' || i === 'U') {
		return 'U';
	}
	if (w === 'T' || i === 'T') {
		return 'T';
	}
	return '•';
}

export async function gitStageAll(): Promise<void> {
	await git(['add', '-A']);
}

export async function gitCommit(message: string): Promise<void> {
	if (!message.trim()) {
		throw new Error('Empty commit message');
	}
	await git(['commit', '-m', message]);
}

export async function gitPush(): Promise<void> {
	await git(['push']);
}

export async function gitPushSetUpstream(branch: string, remote = 'origin'): Promise<void> {
	const b = assertSafeBranchSegment(branch);
	const r = assertSafeBranchSegment(remote);
	await git(['push', '-u', r, b]);
}

/** 是否有任何已暂存（index）变更 */
export async function gitHasStaged(): Promise<boolean> {
	try {
		await git(['diff', '--cached', '--quiet']);
		return false;
	} catch (e) {
		const code = (e && typeof e === 'object' && 'code' in e ? (e as { code?: unknown }).code : undefined) as
			| number
			| string
			| undefined;
		// `--quiet` 退出码 1 == 有差异；其他错误码视为异常
		if (code === 1 || code === '1') {
			return true;
		}
		throw e;
	}
}

/** 远端 origin 的 URL（如配置）；无远端时为空字符串 */
export async function gitRemoteOriginUrl(): Promise<string> {
	try {
		return (await git(['config', '--get', 'remote.origin.url'])).trim();
	} catch {
		return '';
	}
}

/** 当前分支是否设置了 upstream（upstream ref，如 `origin/feature-x`）；无则空串 */
export async function gitUpstreamRef(): Promise<string> {
	try {
		return (await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).trim();
	} catch {
		return '';
	}
}

/** 远端 HEAD 指向的默认分支（如 `main`）；推断不到则空串 */
export async function gitRemoteDefaultBranch(remote = 'origin'): Promise<string> {
	try {
		const ref = (await git(['symbolic-ref', `refs/remotes/${remote}/HEAD`])).trim();
		const prefix = `refs/remotes/${remote}/`;
		if (ref.startsWith(prefix)) {
			return ref.slice(prefix.length);
		}
		return '';
	} catch {
		return '';
	}
}

/** 本地分支列表（按最近提交排序）；`current` 为 `git branch --show-current`，detached 时可能为空 */
export async function gitListLocalBranches(): Promise<{ branches: string[]; current: string }> {
	try {
		const out = await git(['-c', 'color.ui=false', 'branch', '--list', '--sort=-committerdate']);
		const branches: string[] = [];
		let currentFromStar = '';
		for (const line of out.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const isCur = trimmed.startsWith('*');
			const name = trimmed.replace(/^\*\s+/, '').trim();
			if (!name || name.startsWith('(')) {
				continue;
			}
			if (isCur) {
				currentFromStar = name;
			}
			branches.push(name);
		}
		const current = currentFromStar || (await gitBranch());
		return { branches, current };
	} catch {
		return { branches: [], current: '' };
	}
}

function assertSafeBranchSegment(name: string): string {
	const n = name.trim();
	if (!n || n.length > 240) {
		throw new Error('Invalid branch name');
	}
	if (/[\n\r\0]/.test(n) || n.startsWith('-') || n.includes('..')) {
		throw new Error('Invalid branch name');
	}
	return n;
}

export async function gitSwitchBranch(branch: string): Promise<void> {
	const b = assertSafeBranchSegment(branch);
	await git(['switch', '--', b]);
}

export async function gitCreateBranchAndSwitch(name: string): Promise<void> {
	const n = assertSafeBranchSegment(name);
	await git(['switch', '-c', '--', n]);
}

function isBinaryBuffer(buf: Buffer): boolean {
	const n = Math.min(buf.length, 8000);
	for (let i = 0; i < n; i++) {
		if (buf[i] === 0) {
			return true;
		}
	}
	return false;
}

/** 统计 unified diff 文本中的 +/- 行数（忽略 diff 头与 hunk 头）。 */
export function countDiffLineStats(diff: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const line of diff.split('\n')) {
		if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ')) {
			continue;
		}
		if (line.startsWith('+')) {
			additions++;
		} else if (line.startsWith('-')) {
			deletions++;
		}
	}
	return { additions, deletions };
}

function clipDiff(text: string, maxChars?: number | null): string {
	if (!Number.isFinite(maxChars) || !maxChars || maxChars <= 0 || text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, maxChars)}\n\n… (truncated)`;
}

export type DiffPreview = { diff: string; isBinary: boolean; additions: number; deletions: number };
type DiffPreviewOptions = { maxChars?: number | null };

/**
 * 将单次 `git diff HEAD` 输出按文件拆成块，键为仓库相对路径（`diff --git` 的 b/ 侧）。
 */
export function splitUnifiedDiff(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	const text = raw.replace(/^\uFEFF/, '');
	if (!text.trim()) {
		return out;
	}
	const lines = text.split(/\r?\n/);
	let buf: string[] = [];
	const flush = () => {
		if (buf.length === 0) {
			return;
		}
		const chunk = buf.join('\n');
		const head = buf[0] ?? '';
		const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(head);
		if (m) {
			const key = m[2]!.replace(/\\/g, '/').replace(/^\.\/+/, '');
			out[key] = chunk;
		}
		buf = [];
	};
	for (const line of lines) {
		if (line.startsWith('diff --git ') && buf.length > 0) {
			flush();
		}
		buf.push(line);
	}
	flush();
	return out;
}

/**
 * 用一次全量 diff 文本为 `changedPaths` 构建预览；无对应 hunk 的路径回退为 `getDiffPreview`（如未跟踪文件）。
 */
export async function buildDiffPreviewsMap(
	changedPaths: string[],
	fullDiffRaw: string,
	workspaceRootAbs: string,
	gitTopLevel: string,
	options?: { maxChars?: number }
): Promise<Record<string, DiffPreview>> {
	const split = splitUnifiedDiff(fullDiffRaw);
	const root = path.resolve(workspaceRootAbs);
	const maxChars = options?.maxChars ?? 14_000;
	const out: Record<string, DiffPreview> = {};
	const fallbacks: string[] = [];

	for (const wsRel of changedPaths) {
		const repoRel = repoRelativeFromWorkspaceRel(wsRel, root, gitTopLevel);
		const chunk = repoRel ? split[repoRel] : undefined;
		if (chunk && (/Binary files .* differ/i.test(chunk) || /GIT binary patch/i.test(chunk))) {
			out[wsRel] = { diff: 'Binary file not shown.', isBinary: true, additions: 0, deletions: 0 };
			continue;
		}
		if (chunk?.trim()) {
			const { additions, deletions } = countDiffLineStats(chunk);
			out[wsRel] = { diff: clipDiff(chunk, maxChars), isBinary: false, additions, deletions };
			continue;
		}
		fallbacks.push(wsRel);
	}

	if (fallbacks.length > 0) {
		// 避免逐文件 fallback 再次触发 N 次 git diff（大仓库下会造成秒级阻塞）。
		for (const wsRel of fallbacks) {
			out[wsRel] = { diff: '', isBinary: false, additions: 0, deletions: 0 };
		}
	}

	return out;
}

/** Unified diff vs HEAD, or synthetic “all added” for untracked text files. */
export async function getDiffPreview(
	relPath: string,
	options?: DiffPreviewOptions,
	/** 显式工作区根（IPC 传入），避免并行 diff 时 AsyncLocalStorage 上下文丢失导致 repoRoot() 失败。 */
	workspaceRootAbs?: string | null
): Promise<DiffPreview> {
	const root = workspaceRootAbs != null && workspaceRootAbs !== '' ? path.resolve(workspaceRootAbs) : repoRoot();
	const full = path.resolve(root, relPath);
	if (!isPathInsideRoot(full, root)) {
		throw new Error('Bad path');
	}
	const fs = await import('node:fs');
	const maxChars = options?.maxChars ?? 14_000;

	let diffText = '';
	try {
		diffText = await git(['diff', 'HEAD', '--', relPath], root);
	} catch {
		diffText = '';
	}

	if (/Binary files .* differ/i.test(diffText) || /GIT binary patch/i.test(diffText)) {
		return { diff: 'Binary file not shown.', isBinary: true, additions: 0, deletions: 0 };
	}

	if (diffText.trim()) {
		const { additions, deletions } = countDiffLineStats(diffText);
		return { diff: clipDiff(diffText, maxChars), isBinary: false, additions, deletions };
	}

	if (!fs.existsSync(full)) {
		return { diff: '', isBinary: false, additions: 0, deletions: 0 };
	}

	const buf = fs.readFileSync(full);
	if (isBinaryBuffer(buf)) {
		return { diff: '', isBinary: false, additions: 0, deletions: 0 };
	}

	return { diff: '', isBinary: false, additions: 0, deletions: 0 };
}

/** Read file at repo-relative path for diff preview (must stay in workspace). */
export async function safeReadFileForGit(relativePath: string): Promise<string> {
	const root = repoRoot();
	const full = path.resolve(root, relativePath);
	if (!isPathInsideRoot(full, root)) {
		throw new Error('Bad path');
	}
	const fs = await import('node:fs');
	return fs.readFileSync(full, 'utf8');
}
