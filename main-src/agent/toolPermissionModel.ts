/**
 * 工具权限规则（对齐 Claude Code `PermissionRule` / `ToolPermissionContext` 的精简子集）。
 *
 * - `deny` 优先于 `ask` 与 `allow`；
 * - `allow` 在无非 deny 匹配时直接放行（绕过 Bash/Write 的默认确认流）；
 * - `ask` 落入既有「delegate」路径，由 `confirmShellCommands` / `confirmWritesBeforeExecute` 等决定；
 * - `shouldAvoidPermissionPrompts` 时，本应 `ask` 的匹配视为 `deny`（无 UI 的后台场景）。
 */

import { minimatch } from 'minimatch';
import type { AgentCustomization, AgentToolPermissionRule } from '../agentSettingsTypes.js';
import type { ToolCall } from './agentTools.js';

export type ResolvedToolPermission = 'allow' | 'deny' | 'delegate';

function toolNameMatches(callName: string, ruleToolName: string): boolean {
	const r = ruleToolName.trim();
	if (!r || r === '*') return true;
	if (callName === r) return true;
	if (r.endsWith('*')) {
		return callName.startsWith(r.slice(0, -1));
	}
	return false;
}

function ruleContentMatches(call: ToolCall, ruleContent: string | undefined): boolean {
	if (ruleContent == null || ruleContent === '') return true;
	const rc = ruleContent.trim();

	if (call.name === 'Bash') {
		const cmd = String(call.arguments.command ?? '').trim();
		if (!cmd) return false;
		if (rc.includes('*') || rc.includes('?') || rc.includes('[')) {
			return minimatch(cmd, rc, { nocase: true, dot: true });
		}
		return cmd === rc || cmd.startsWith(`${rc} `);
	}

	if (call.name === 'Write' || call.name === 'Edit') {
		const rel = String(call.arguments.file_path ?? call.arguments.path ?? '').replace(/\\/g, '/');
		if (!rel) return false;
		if (rc.includes('*') || rc.includes('?') || rc.includes('[')) {
			return minimatch(rel, rc, { nocase: true, dot: true });
		}
		return rel === rc || rel.endsWith(`/${rc}`) || rel.endsWith(rc);
	}

	try {
		return JSON.stringify(call.arguments).includes(rc);
	} catch {
		return false;
	}
}

function collectMatchingRules(call: ToolCall, rules: AgentToolPermissionRule[]): AgentToolPermissionRule[] {
	return rules.filter((r) => toolNameMatches(call.name, r.toolName) && ruleContentMatches(call, r.ruleContent));
}

/**
 * 根据 `agent.toolPermissionRules` 解析是否允许、拒绝或交给默认闸门（delegate）。
 */
export function resolveToolPermissionFromRules(
	call: ToolCall,
	agent: AgentCustomization | undefined,
	opts?: { avoidPermissionPrompts?: boolean }
): ResolvedToolPermission {
	const rules = agent?.toolPermissionRules;
	if (!rules?.length) return 'delegate';

	const matching = collectMatchingRules(call, rules);
	if (matching.length === 0) return 'delegate';

	const avoid = Boolean(opts?.avoidPermissionPrompts || agent?.shouldAvoidPermissionPrompts);

	let hasDeny = false;
	let hasAsk = false;
	let hasAllow = false;
	for (const r of matching) {
		if (r.behavior === 'deny') hasDeny = true;
		else if (r.behavior === 'ask') hasAsk = true;
		else hasAllow = true;
	}

	if (hasDeny) return 'deny';
	if (hasAsk) {
		if (avoid) return 'deny';
		return 'delegate';
	}
	if (hasAllow) return 'allow';
	return 'delegate';
}
