import * as fs from 'node:fs';
import * as path from 'node:path';
import { minimatch } from 'minimatch';
import type { AgentCustomization, AgentCommand, AgentSkill, AgentRule, AgentSubagent } from '../agentSettingsTypes.js';
import { buildAutoReplyLanguageRuleBlock } from '../../src/autoReplyLanguageRule.js';
import { collectAtWorkspacePathsInText } from './workspaceContextExpand.js';

const MAX_MARKDOWN_IMPORT_CHARS = 120_000;
const MAX_SKILL_FILE_CHARS = 80_000;

function readTextFileSafe(fullPath: string, maxChars: number): string {
	try {
		if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
			return '';
		}
		const t = fs.readFileSync(fullPath, 'utf8');
		if (t.length > maxChars) {
			return `${t.slice(0, maxChars)}\n\n… (truncated)`;
		}
		return t;
	} catch {
		return '';
	}
}

/** 简单剥离 `---` YAML frontmatter */
function stripSimpleFrontmatter(md: string): { body: string; title?: string; description?: string } {
	const t = md.trim();
	if (!t.startsWith('---')) {
		return { body: md };
	}
	const end = t.indexOf('\n---', 3);
	if (end < 0) {
		return { body: md };
	}
	const yamlBlock = t.slice(3, end).trim();
	const body = t.slice(end + 4).trim();
	const meta: Record<string, string> = {};
	for (const line of yamlBlock.split('\n')) {
		const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
		if (m) {
			meta[m[1]!] = (m[2] ?? '').replace(/^["']|["']$/g, '').trim();
		}
	}
	return {
		body,
		title: meta.name || meta.title,
		description: meta.description,
	};
}

/** 扫描 `.../<slug>/SKILL.md`（单层子目录） */
function scanSkillsDirectory(
	workspaceRoot: string,
	segments: readonly string[],
	sourceLabel: string
): AgentSkill[] {
	const skillsRoot = path.join(workspaceRoot, ...segments);
	if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
		return [];
	}
	const relHint = [...segments, '<slug>', 'SKILL.md'].join('/');
	const out: AgentSkill[] = [];
	try {
		for (const dirName of fs.readdirSync(skillsRoot)) {
			const skillPath = path.join(skillsRoot, dirName, 'SKILL.md');
			if (!fs.existsSync(skillPath)) {
				continue;
			}
			const raw = readTextFileSafe(skillPath, MAX_SKILL_FILE_CHARS);
			if (!raw.trim()) {
				continue;
			}
			const { body, title, description } = stripSimpleFrontmatter(raw);
			const slug = dirName.trim().toLowerCase();
			if (!slug) {
				continue;
			}
			const skillSourceRelPath = [...segments, dirName, 'SKILL.md'].join('/');
			out.push({
				id: `ws-skill-${sourceLabel}:${slug}`,
				name: title?.trim() || dirName,
				description:
					description?.trim() ||
					`Project skill from ${relHint.replace('<slug>', dirName)}`,
				slug,
				content: body.trim(),
				enabled: true,
				origin: 'project',
				skillSourceRelPath,
			});
		}
	} catch {
		return out;
	}
	return out;
}

/**
 * 从工作区加载磁盘技能：
 * - `.claude/skills/<slug>/SKILL.md`
 * - `.cursor/skills/<slug>/SKILL.md`（Cursor）
 * - `.async/skills/<slug>/SKILL.md`（本应用约定）
 * 与设置里 Skills 合并时按 slug；**优先级：`.async` > `.cursor` > `.claude`**（后者可被前者覆盖）。
 */
export function loadClaudeWorkspaceSkills(workspaceRoot: string | null): AgentSkill[] {
	if (!workspaceRoot) {
		return [];
	}
	const claude = scanSkillsDirectory(workspaceRoot, ['.claude', 'skills'], 'claude');
	const cursor = scanSkillsDirectory(workspaceRoot, ['.cursor', 'skills'], 'cursor');
	const asyncShell = scanSkillsDirectory(workspaceRoot, ['.async', 'skills'], 'async');
	return [...claude, ...cursor, ...asyncShell];
}

/** 获取用户主目录路径（跨平台） */
function getUserHomeDir(): string | null {
	// Windows: 优先 USERPROFILE（原生路径），避免 Git Bash 的 HOME（/c/Users/...）导致 fs 失败
	if (process.platform === 'win32') {
		const fromEnv = process.env.USERPROFILE || process.env.HOME;
		if (fromEnv) return fromEnv;
		try {
			const { homedir } = require('node:os');
			return homedir();
		} catch {
			/* ignore */
		}
		return null;
	}
	return process.env.HOME || null;
}

/**
 * 从全局目录加载磁盘技能（用户主目录级别）：
 * - `~/.claude/skills/<slug>/SKILL.md`
 * - `~/.async/skills/<slug>/SKILL.md`
 * 优先级：`.async` > `.claude`
 */
export function loadGlobalSkills(): AgentSkill[] {
	const home = getUserHomeDir();
	if (!home) {
		return [];
	}
	const claude = scanSkillsDirectory(home, ['.claude', 'skills'], 'claude');
	const asyncShell = scanSkillsDirectory(home, ['.async', 'skills'], 'async');
	// 标记为全局来源
	const markGlobal = (skills: AgentSkill[], sourceLabel: string): AgentSkill[] =>
		skills.map((s) => ({
			...s,
			id: `global-skill-${sourceLabel}:${s.slug}`,
			origin: 'user' as const,
			skillSourceRelPath: undefined,
		}));
	return [...markGlobal(claude, 'claude'), ...markGlobal(asyncShell, 'async')];
}

/**
 * 扫描磁盘子 Agent 配置（兼容 Claude Code `.claude/agents/<name>.md` 约定）：
 * - `.claude/agents/<name>.md`
 * - `.cursor/agents/<name>.md`（兼容写法）
 * - `.async/agents/<name>.md`
 * 文件名（去扩展名）作为 subagent 名称；frontmatter 可提供 `name`、`description`，正文为 instructions。
 */
function scanSubagentsDirectory(
	workspaceRoot: string,
	segments: readonly string[],
	sourceLabel: string
): AgentSubagent[] {
	const dir = path.join(workspaceRoot, ...segments);
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
		return [];
	}
	const out: AgentSubagent[] = [];
	try {
		for (const fileName of fs.readdirSync(dir)) {
			if (!/\.md$/i.test(fileName)) {
				continue;
			}
			const full = path.join(dir, fileName);
			if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
				continue;
			}
			const raw = readTextFileSafe(full, MAX_SKILL_FILE_CHARS);
			if (!raw.trim()) {
				continue;
			}
			const { body, title, description } = stripSimpleFrontmatter(raw);
			const baseName = fileName.replace(/\.md$/i, '').trim();
			if (!baseName) {
				continue;
			}
			out.push({
				id: `ws-subagent-${sourceLabel}:${baseName.toLowerCase()}`,
				name: title?.trim() || baseName,
				description:
					description?.trim() ||
					`Project subagent from ${[...segments, fileName].join('/')}`,
				instructions: body.trim(),
				enabled: true,
				origin: 'project',
			});
		}
	} catch {
		return out;
	}
	return out;
}

export function loadClaudeWorkspaceSubagents(workspaceRoot: string | null): AgentSubagent[] {
	if (!workspaceRoot) {
		return [];
	}
	const claude = scanSubagentsDirectory(workspaceRoot, ['.claude', 'agents'], 'claude');
	const cursor = scanSubagentsDirectory(workspaceRoot, ['.cursor', 'agents'], 'cursor');
	const asyncShell = scanSubagentsDirectory(workspaceRoot, ['.async', 'agents'], 'async');
	return [...claude, ...cursor, ...asyncShell];
}

function mergeSubagentsByName(
	settingsSubagents: AgentSubagent[] | undefined,
	workspaceSubagents: AgentSubagent[]
): AgentSubagent[] {
	const map = new Map<string, AgentSubagent>();
	for (const s of settingsSubagents ?? []) {
		const key = (s.name ?? '').trim().toLowerCase();
		if (key) {
			map.set(key, s);
		}
	}
	for (const w of workspaceSubagents) {
		const key = (w.name ?? '').trim().toLowerCase();
		if (!key) continue;
		map.set(key, w);
	}
	return [...map.values()];
}

function mergeSkillsBySlug(settingsSkills: AgentSkill[] | undefined, workspaceSkills: AgentSkill[]): AgentSkill[] {
	const map = new Map<string, AgentSkill>();
	for (const s of settingsSkills ?? []) {
		if (s.slug?.trim()) {
			map.set(s.slug.trim().toLowerCase(), s);
		}
	}
	for (const w of workspaceSkills) {
		map.set(w.slug.trim().toLowerCase(), w);
	}
	return [...map.values()];
}

/** 读取 `CLAUDE.md`、`.claude/CLAUDE.md` 与 `.claude/rules` 下规则 */
export function loadClaudeProjectRulesMarkdown(workspaceRoot: string | null): string {
	if (!workspaceRoot) {
		return '';
	}
	const parts: string[] = [];
	for (const rel of ['CLAUDE.md', path.join('.claude', 'CLAUDE.md')]) {
		const full = path.join(workspaceRoot, rel);
		const t = readTextFileSafe(full, MAX_MARKDOWN_IMPORT_CHARS).trim();
		if (t) {
			parts.push(`**${rel.replace(/\\/g, '/')}**\n${t}`);
		}
	}
	const rulesDir = path.join(workspaceRoot, '.claude', 'rules');
	if (fs.existsSync(rulesDir) && fs.statSync(rulesDir).isDirectory()) {
		try {
			const names = fs.readdirSync(rulesDir);
			for (const n of names) {
				if (!/\.(md|mdc)$/i.test(n)) {
					continue;
				}
				const full = path.join(rulesDir, n);
				const t = readTextFileSafe(full, MAX_MARKDOWN_IMPORT_CHARS).trim();
				if (t) {
					parts.push(`**.claude/rules/${n}**\n${t}`);
				}
			}
		} catch {
			/* skip */
		}
	}
	return parts.join('\n\n---\n\n');
}

const MANUAL_RULE_RE = /@rule:\s*(?:"([^"]+)"|([a-f0-9-]{36})|([^\s@]+))/gi;

/**
 * Manual 规则：用户消息中出现 `@rule:"名称"`、`@rule:<uuid>` 或 `@rule:token` 时注入对应规则正文，并从用户消息中移除这些标记。
 */
export function applyManualRuleInvocations(
	text: string,
	rules: AgentRule[] | undefined
): { userText: string; manualBlocks: string[] } {
	const manual = (rules ?? []).filter((r) => r.enabled && r.scope === 'manual');
	if (!manual.length) {
		return { userText: text, manualBlocks: [] };
	}

	function resolveRule(key: string): AgentRule | undefined {
		const k = key.trim();
		if (!k) {
			return undefined;
		}
		const lower = k.toLowerCase();
		return manual.find((r) => r.id === k || r.name.trim().toLowerCase() === lower);
	}

	const blocks: string[] = [];
	const userText = text.replace(MANUAL_RULE_RE, (_full, q1: string | undefined, q2: string | undefined, q3: string | undefined) => {
		const key = (q1 ?? q2 ?? q3 ?? '').trim();
		const rule = resolveRule(key);
		if (rule) {
			blocks.push(`#### Rule（手动 @rule）: ${rule.name}\n${rule.content}`);
		} else {
			blocks.push(
				`#### Rule（手动 @rule）: 未找到匹配项 "${key}"\n（请检查规则 id 或名称是否与设置中 Manual 规则一致。）`
			);
		}
		return ' ';
	})
		.replace(/\s{2,}/g, ' ')
		.trim();
	return { userText, manualBlocks: blocks };
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 消息以 `/slash` 开头时展开为命令模板（长 slash 优先） */
export function applySlashCommands(
	text: string,
	commands: AgentCommand[] | undefined
): { userText: string; slashSystemBlock: string } {
	const raw = text.trim();
	if (!commands?.length) {
		return { userText: raw, slashSystemBlock: '' };
	}
	const sorted = [...commands].filter((c) => c.slash.trim()).sort((a, b) => b.slash.length - a.slash.length);
	for (const c of sorted) {
		const slash = c.slash.trim().replace(/^\//, '');
		const re = new RegExp(`^/${escapeRe(slash)}(?:\\s+|$)`, 'i');
		if (!re.test(raw)) {
			continue;
		}
		const rest = raw.replace(re, '').trim();
		if (c.invocation === 'prompt') {
			const rendered = (c.body ?? '').replace(/\$ARGUMENTS\b/g, rest || '(none)');
			return {
				userText: rest || `Execute the /${slash} workflow.`,
				slashSystemBlock: `#### Slash command: /${slash}\n${
					c.description ? `${c.description}\n\n` : ''
				}${rendered.trim()}`,
			};
		}
		let body = (c.body ?? '').trim();
		body = body.replace(/\{\{\s*args\s*\}\}/gi, rest);
		body = body.replace(/\{\{\s*input\s*\}\}/gi, rest);
		return {
			userText: body.length > 0 ? body : rest,
			slashSystemBlock: '',
		};
	}
	return { userText: raw, slashSystemBlock: '' };
}

const SKILL_LEAD = /^\s*\.\/([\w.-]+)\s*([\s\S]*)$/;

/** `./slug` 触发 Skill：正文去掉前缀，技能说明注入系统区 */
export function applySkillInvocation(
	text: string,
	skills: AgentSkill[] | undefined
): { userText: string; skillSystemBlock: string; usedSkillSlug?: string } {
	const raw = text.trim();
	const m = raw.match(SKILL_LEAD);
	if (!m || !skills?.length) {
		return { userText: raw, skillSystemBlock: '' };
	}
	const slug = m[1]!.toLowerCase();
	const rest = (m[2] ?? '').trim();
	const sk = skills.find((s) => s.slug.trim().toLowerCase() === slug && s.enabled !== false);
	if (!sk) {
		return { userText: raw, skillSystemBlock: '' };
	}
	const userText = rest.length > 0 ? rest : '（已调用 Skill，请按下列说明执行。）';
	const skillSystemBlock = `#### Skill: ${sk.name}\n${sk.description ? `${sk.description}\n\n` : ''}${sk.content}`;
	return { userText, skillSystemBlock, usedSkillSlug: sk.slug };
}

function pathMatchesGlob(relPath: string, pattern: string): boolean {
	const norm = relPath.replace(/\\/g, '/');
	const pat = pattern.replace(/\\/g, '/').trim();
	if (!pat) {
		return false;
	}
	if (minimatch(norm, pat, { dot: true })) {
		return true;
	}
	const base = norm.split('/').pop() ?? norm;
	return minimatch(base, pat, { dot: true });
}

/** 工作区磁盘规则目录：优先 Async 约定，其次 Cursor 兼容路径 */
const THIRD_PARTY_RULE_DIRS = [
	{ segments: ['.async', 'rules'] as const, prefix: '.async/rules' },
	{ segments: ['.cursor', 'rules'] as const, prefix: '.cursor/rules' },
] as const;

function readRuleFilesFromDir(absDir: string, pathPrefix: string): string[] {
	const parts: string[] = [];
	if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
		return parts;
	}
	try {
		const names = fs.readdirSync(absDir);
		for (const n of names) {
			if (!/\.(md|mdc)$/i.test(n)) {
				continue;
			}
			const full = path.join(absDir, n);
			try {
				const t = fs.readFileSync(full, 'utf8').trim();
				if (t) {
					parts.push(`**${pathPrefix}/${n}**\n${t}`);
				}
			} catch {
				/* skip */
			}
		}
	} catch {
		/* skip */
	}
	return parts;
}

/** 读取工作区 `.async/rules` 与 `.cursor/rules` 下 .md / .mdc（Async 优先，其次 Cursor 习惯） */
export function loadThirdPartyAgentRules(workspaceRoot: string | null): string {
	if (!workspaceRoot) {
		return '';
	}
	const chunks: string[] = [];
	for (const { segments, prefix } of THIRD_PARTY_RULE_DIRS) {
		const dir = path.join(workspaceRoot, ...segments);
		chunks.push(...readRuleFilesFromDir(dir, prefix));
	}
	return chunks.join('\n\n---\n\n');
}

function buildEnabledAlwaysRuleBlocks(agent: AgentCustomization | undefined): string[] {
	const parts: string[] = [];
	for (const rule of agent?.rules ?? []) {
		if (!rule.enabled || rule.scope !== 'always') {
			continue;
		}
		parts.push(`#### Rule: ${rule.name}\n${rule.content}`);
	}
	return parts;
}

export function buildAgentGlobalRuleAppend(
	agent: AgentCustomization | undefined,
	uiLanguage: 'zh-CN' | 'en'
): string {
	const parts = buildEnabledAlwaysRuleBlocks(agent);
	parts.push(buildAutoReplyLanguageRuleBlock(uiLanguage, uiLanguage));
	return parts.join('\n\n');
}

export function buildAgentSystemAppend(opts: {
	agent: AgentCustomization | undefined;
	userText: string;
	atPaths: string[];
	skillSystemBlock: string;
	slashCommandSystemBlock: string;
	thirdPartyRules: string;
	uiLanguage: 'zh-CN' | 'en';
	/** 来自 `@rule:` 的 Manual 规则块（已含标题） */
	manualRuleBlocks?: string[];
}): string {
	const parts: string[] = [];
	const agent = opts.agent;

	if (opts.thirdPartyRules.trim()) {
		parts.push(`#### 从项目导入的规则（.async/rules、.cursor/rules、CLAUDE.md、.claude/rules）\n${opts.thirdPartyRules.trim()}`);
	}

	parts.push(...buildEnabledAlwaysRuleBlocks(agent));

	for (const r of agent?.rules ?? []) {
		if (!r.enabled) {
			continue;
		}
		if (r.scope === 'glob' && r.globPattern?.trim()) {
			const pat = r.globPattern.trim();
			if (opts.atPaths.some((p) => pathMatchesGlob(p, pat))) {
				parts.push(`#### Rule（路径匹配）: ${r.name}\n${r.content}`);
			}
		}
	}

	for (const block of opts.manualRuleBlocks ?? []) {
		if (block.trim()) {
			parts.push(block.trim());
		}
	}

	if (opts.slashCommandSystemBlock.trim()) {
		parts.push(opts.slashCommandSystemBlock.trim());
	}

	if (opts.skillSystemBlock.trim()) {
		parts.push(opts.skillSystemBlock.trim());
	}

	parts.push(buildAutoReplyLanguageRuleBlock(opts.uiLanguage, opts.uiLanguage));

	const subs = (agent?.subagents ?? []).filter((s) => s.enabled !== false);
	if (subs.length > 0) {
		const body = subs
			.map((s) =>
				[
					`##### Subagent: ${s.name}`,
					`- ${s.description}`,
					s.memoryScope ? `- Persistent memory: ${s.memoryScope}` : '',
					'',
					s.instructions,
				]
					.filter(Boolean)
					.join('\n')
			)
			.join('\n\n');
		parts.push(`#### Subagents\n?????????????????\n\n${body}`);
	}


	return parts.join('\n\n');
}

export type PreparedUserTurn = {
	userText: string;
	agentSystemAppend: string;
	/** 用户消息中通过 @ 引用的工作区相对路径列表，用于语义检索去重 */
	atPaths: string[];
	/** 本次用户消息触发使用的 Skill slug（如果有） */
	usedSkillSlug?: string;
};

export function prepareUserTurnForChat(
	rawText: string,
	agent: AgentCustomization | undefined,
	workspaceRoot: string | null,
	workspaceFiles: string[],
	uiLanguage: 'zh-CN' | 'en'
): PreparedUserTurn {
	const { userText: afterCmd, slashSystemBlock } = applySlashCommands(rawText, agent?.commands);
	const { userText: afterManual, manualBlocks } = applyManualRuleInvocations(afterCmd, agent?.rules);
	const wsSkills = workspaceRoot ? loadClaudeWorkspaceSkills(workspaceRoot) : [];
	const globalSkills = loadGlobalSkills();
	const diskSkills = mergeSkillsBySlug(globalSkills, wsSkills);
	const mergedSkills = mergeSkillsBySlug(agent?.skills, diskSkills);
	const wsSubagents = workspaceRoot ? loadClaudeWorkspaceSubagents(workspaceRoot) : [];
	const mergedSubagents = mergeSubagentsByName(agent?.subagents, wsSubagents);
	const agentWithDisk: AgentCustomization | undefined = agent
		? { ...agent, skills: mergedSkills, subagents: mergedSubagents }
		: agent;
	const { userText, skillSystemBlock, usedSkillSlug } = applySkillInvocation(afterManual, mergedSkills);
	const atPaths = workspaceRoot ? collectAtWorkspacePathsInText(userText, workspaceFiles) : [];
	const cursorRules = workspaceRoot ? loadThirdPartyAgentRules(workspaceRoot) : '';
	const claudeRules = workspaceRoot ? loadClaudeProjectRulesMarkdown(workspaceRoot) : '';
	const thirdPartyMerged = [cursorRules, claudeRules].filter((s) => s.trim().length > 0).join('\n\n---\n\n');
	const agentSystemAppend = buildAgentSystemAppend({
		agent: agentWithDisk,
		userText,
		atPaths,
		skillSystemBlock,
		slashCommandSystemBlock: slashSystemBlock,
		thirdPartyRules: thirdPartyMerged,
		uiLanguage,
		manualRuleBlocks: manualBlocks,
	});
	return { userText, agentSystemAppend, atPaths, usedSkillSlug };
}
