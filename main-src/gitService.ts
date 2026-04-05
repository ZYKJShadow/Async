import { execFile } from 'node:child_process';
import { createTwoFilesPatch } from 'diff';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { getWorkspaceRoot, isPathInsideRoot } from './workspace.js';

const execFileAsync = promisify(execFile);

const GIT_MISSING_MESSAGE = 'Git is not installed';
const GIT_NOT_REPO_MESSAGE = 'Current workspace is not a Git repository';

type ExecFileLikeError = Error & {
	code?: string;
	stderr?: string;
	stdout?: string;
};

export type GitFailureKind = 'missing' | 'not_repo' | 'unknown';

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
	const root = getWorkspaceRoot();
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
	return stdout.trim();
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

export async function gitProbeContext(): Promise<
	| { ok: true; topLevel: string }
	| { ok: false; reason: GitFailureKind; message: string }
> {
	const ws = getWorkspaceRoot();
	if (!ws) {
		return { ok: false, reason: 'unknown', message: 'No workspace' };
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
			return { ok: false, reason: 'unknown', message: 'Git command failed' };
		}
		return { ok: true, topLevel: path.resolve(line) };
	} catch (error) {
		const reason = classifyGitFailure(error);
		return {
			ok: false,
			reason,
			message: normalizeGitFailureMessage(error),
		};
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

/** Unified diff vs HEAD, or synthetic “all added” for untracked text files. */
export async function getDiffPreview(relPath: string, options?: DiffPreviewOptions): Promise<DiffPreview> {
	const root = repoRoot();
	const full = path.resolve(root, relPath);
	if (!isPathInsideRoot(full, root)) {
		throw new Error('Bad path');
	}
	const fs = await import('node:fs');
	const maxChars = options?.maxChars ?? 14_000;

	let diffText = '';
	try {
		diffText = await git(['diff', 'HEAD', '--', relPath]);
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
