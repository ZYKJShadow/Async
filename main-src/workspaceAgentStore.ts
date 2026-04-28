/**
 * 当前工作区下的 Agent 片段（Rules / Skills / Subagents），与全局 settings.json 分离。
 * 持久化路径：`<workspace>/.async/agent.json`
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentCustomization, AgentRule, AgentSkill, AgentSubagent } from './agentSettingsTypes.js';

export type WorkspaceAgentProjectSlice = {
	rules?: AgentRule[];
	skills?: AgentSkill[];
	subagents?: AgentSubagent[];
};

const FILE_SEGMENTS = ['.async', 'agent.json'] as const;

export function workspaceAgentJsonPath(root: string): string {
	return path.join(root, ...FILE_SEGMENTS);
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asString(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}

function asOptString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

function asOptBool(v: unknown): boolean | undefined {
	return typeof v === 'boolean' ? v : undefined;
}

/** 仅在最小必要字段存在时通过，否则视为损坏条目并丢弃 */
function normalizeRule(raw: unknown): AgentRule | null {
	if (!isPlainRecord(raw)) {
		return null;
	}
	const id = asString(raw.id);
	const name = asString(raw.name);
	if (!id || !name) {
		return null;
	}
	const scope = raw.scope === 'glob' || raw.scope === 'manual' ? raw.scope : 'always';
	const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : true;
	const out: AgentRule = {
		id,
		name,
		content: asString(raw.content),
		scope,
		enabled,
	};
	const glob = asOptString(raw.globPattern);
	if (glob !== undefined) {
		out.globPattern = glob;
	}
	const origin = raw.origin === 'user' || raw.origin === 'project' ? raw.origin : undefined;
	if (origin) {
		out.origin = origin;
	}
	return out;
}

function normalizeSkill(raw: unknown): AgentSkill | null {
	if (!isPlainRecord(raw)) {
		return null;
	}
	const id = asString(raw.id);
	const name = asString(raw.name);
	const slug = asString(raw.slug);
	if (!id || !name || !slug) {
		return null;
	}
	const out: AgentSkill = {
		id,
		name,
		description: asString(raw.description),
		slug,
		content: asString(raw.content),
	};
	const enabled = asOptBool(raw.enabled);
	if (enabled !== undefined) {
		out.enabled = enabled;
	}
	const origin = raw.origin === 'user' || raw.origin === 'project' ? raw.origin : undefined;
	if (origin) {
		out.origin = origin;
	}
	const ssrp = asOptString(raw.skillSourceRelPath);
	if (ssrp !== undefined) {
		out.skillSourceRelPath = ssrp;
	}
	const sbda = asOptString(raw.skillBaseDirAbs);
	if (sbda !== undefined) {
		out.skillBaseDirAbs = sbda;
	}
	const psn = asOptString(raw.pluginSourceName);
	if (psn !== undefined) {
		out.pluginSourceName = psn;
	}
	const psrp = asOptString(raw.pluginSourceRelPath);
	if (psrp !== undefined) {
		out.pluginSourceRelPath = psrp;
	}
	const pra = asOptString(raw.pluginRootAbs);
	if (pra !== undefined) {
		out.pluginRootAbs = pra;
	}
	if (raw.pluginSourceKind === 'skill' || raw.pluginSourceKind === 'agent') {
		out.pluginSourceKind = raw.pluginSourceKind;
	}
	return out;
}

function normalizeSubagent(raw: unknown): AgentSubagent | null {
	if (!isPlainRecord(raw)) {
		return null;
	}
	const id = asString(raw.id);
	const name = asString(raw.name);
	if (!id || !name) {
		return null;
	}
	const out: AgentSubagent = {
		id,
		name,
		description: asString(raw.description),
		instructions: asString(raw.instructions),
	};
	if (raw.memoryScope === 'user' || raw.memoryScope === 'project' || raw.memoryScope === 'local') {
		out.memoryScope = raw.memoryScope;
	}
	const enabled = asOptBool(raw.enabled);
	if (enabled !== undefined) {
		out.enabled = enabled;
	}
	const origin = raw.origin === 'user' || raw.origin === 'project' ? raw.origin : undefined;
	if (origin) {
		out.origin = origin;
	}
	const psn = asOptString(raw.pluginSourceName);
	if (psn !== undefined) {
		out.pluginSourceName = psn;
	}
	const psrp = asOptString(raw.pluginSourceRelPath);
	if (psrp !== undefined) {
		out.pluginSourceRelPath = psrp;
	}
	return out;
}

function normalizeArray<T>(raw: unknown, normalize: (item: unknown) => T | null, label: string, file: string): T[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: T[] = [];
	let dropped = 0;
	for (const item of raw) {
		const norm = normalize(item);
		if (norm) {
			out.push(norm);
		} else {
			dropped += 1;
		}
	}
	if (dropped > 0) {
		console.warn(`[workspaceAgentStore] dropped ${dropped} malformed ${label} entries from ${file}`);
	}
	return out;
}

export function readWorkspaceAgentProjectSlice(root: string | null): WorkspaceAgentProjectSlice {
	if (!root) {
		return {};
	}
	const p = workspaceAgentJsonPath(root);
	let raw: string;
	try {
		if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
			return {};
		}
		raw = fs.readFileSync(p, 'utf8');
	} catch (e) {
		console.warn(`[workspaceAgentStore] failed to read ${p}: ${(e as Error)?.message ?? e}`);
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		console.warn(`[workspaceAgentStore] ${p} is not valid JSON, ignoring: ${(e as Error)?.message ?? e}`);
		quarantineCorruptFile(p, raw);
		return {};
	}
	if (!isPlainRecord(parsed)) {
		console.warn(`[workspaceAgentStore] ${p} root is not an object, ignoring`);
		return {};
	}
	return {
		rules: normalizeArray(parsed.rules, normalizeRule, 'rule', p),
		skills: normalizeArray(parsed.skills, normalizeSkill, 'skill', p),
		subagents: normalizeArray(parsed.subagents, normalizeSubagent, 'subagent', p),
	};
}

/** 把无法解析的文件改名为 .corrupt-<ts>.bak，避免下次启动反复挂掉 */
function quarantineCorruptFile(filePath: string, _raw: string): void {
	try {
		const backup = `${filePath}.corrupt-${Date.now()}.bak`;
		fs.renameSync(filePath, backup);
		console.warn(`[workspaceAgentStore] quarantined corrupt file to ${backup}`);
	} catch (e) {
		console.warn(`[workspaceAgentStore] could not quarantine ${filePath}: ${(e as Error)?.message ?? e}`);
	}
}

export function writeWorkspaceAgentProjectSlice(root: string, slice: WorkspaceAgentProjectSlice): void {
	const p = workspaceAgentJsonPath(root);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	const out: WorkspaceAgentProjectSlice = {
		rules: slice.rules ?? [],
		skills: slice.skills ?? [],
		subagents: slice.subagents ?? [],
	};
	fs.writeFileSync(p, JSON.stringify(out, null, 2), 'utf8');
}

/** 合并全局 agent 与当前仓库片段，供对话准备与注入使用 */
export function mergeAgentWithProjectSlice(
	userAgent: AgentCustomization | undefined,
	project: WorkspaceAgentProjectSlice
): AgentCustomization {
	const u = userAgent ?? {};
	return {
		...u,
		rules: [...(u.rules ?? []), ...(project.rules ?? [])],
		skills: [...(u.skills ?? []), ...(project.skills ?? [])],
		subagents: [...(u.subagents ?? []), ...(project.subagents ?? [])],
	};
}
