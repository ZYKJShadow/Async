/**
 * Agent 工具执行前用户确认（主进程侧逻辑与「安全命令」白名单）。
 *
 * 可配置规则见 `toolPermissionModel.ts`（对齐 Claude Code `PermissionRule` 子集）；
 * 未命中规则时仍按工具名走 Bash / Write 等默认闸门。
 */

import type { ToolCall } from './agentTools.js';
import type { BeforeExecuteToolResult } from './agentLoop.js';
import type { AgentCustomization } from '../agentSettingsTypes.js';
import { resolveToolPermissionFromRules } from './toolPermissionModel.js';
import { getShellPermissionMode } from '../../src/shellPermissionMode.js';

/** 低风险 shell：在设置允许时可跳过确认 */
export function isSafeShellCommandForAutoApprove(cmd: string): boolean {
	const c = cmd.trim();
	if (/^git\s+(status|diff|log|branch|show|remote\s+-v)\b/i.test(c)) return true;
	if (/^(npm|pnpm|yarn|bun)\s+(test|run\s+test|run\s+lint|run\s+build|version)\b/i.test(c)) return true;
	if (/^(npx|pnpm\s+dlx)\s+eslint\b/i.test(c)) return true;
	return false;
}

export type ToolApprovalSend = (obj: unknown) => void;

export function createToolApprovalBeforeExecute(
	send: ToolApprovalSend,
	threadId: string,
	signal: AbortSignal,
	getAgent: () => AgentCustomization | undefined,
	waiters: Map<string, (approved: boolean) => void>,
	options?: { avoidPermissionPrompts?: boolean }
): (call: ToolCall) => Promise<BeforeExecuteToolResult> {
	let seq = 0;

	return async (call) => {
		const agent = getAgent() ?? {};
		const perm = resolveToolPermissionFromRules(call, agent, {
			avoidPermissionPrompts: options?.avoidPermissionPrompts,
		});
		if (perm === 'deny') {
			return { proceed: false, rejectionMessage: '工具调用被权限规则拒绝。' };
		}

		if (call.name === 'Bash') {
			const mode = getShellPermissionMode(agent);
			const cmd = String(call.arguments.command ?? '');

			if (perm === 'allow') {
				if (mode !== 'ask_every_time') {
					return { proceed: true };
				}
			} else {
				if (mode === 'always') {
					return { proceed: true };
				}
				if (mode === 'rules') {
					const skipSafe = agent.skipSafeShellCommandsConfirm !== false;
					if (skipSafe && isSafeShellCommandForAutoApprove(cmd)) {
						return { proceed: true };
					}
				}
			}

			const id = `ta-${threadId}-${Date.now()}-${++seq}`;
			return await new Promise<BeforeExecuteToolResult>((resolve) => {
				if (signal.aborted) {
					resolve({ proceed: false, rejectionMessage: '已中止生成。' });
					return;
				}
				const onAbort = () => {
					waiters.delete(id);
					resolve({ proceed: false, rejectionMessage: '已中止生成。' });
				};
				signal.addEventListener('abort', onAbort, { once: true });
				waiters.set(id, (approved) => {
					signal.removeEventListener('abort', onAbort);
					waiters.delete(id);
					resolve(
						approved
							? { proceed: true }
							: { proceed: false, rejectionMessage: '用户未批准执行此 shell 命令。' }
					);
				});
				send({
					threadId,
					type: 'tool_approval_request',
					approvalId: id,
					toolName: call.name,
					command: cmd,
				});
			});
		}

		if (perm === 'allow') {
			return { proceed: true };
		}

		if (call.name === 'Write' || call.name === 'Edit') {
			if (agent.confirmWritesBeforeExecute !== true) {
				return { proceed: true };
			}
			const relPath = String(call.arguments.file_path ?? call.arguments.path ?? '');
			const id = `ta-${threadId}-${Date.now()}-${++seq}`;
			return await new Promise<BeforeExecuteToolResult>((resolve) => {
				if (signal.aborted) {
					resolve({ proceed: false, rejectionMessage: '已中止生成。' });
					return;
				}
				const onAbort = () => {
					waiters.delete(id);
					resolve({ proceed: false, rejectionMessage: '已中止生成。' });
				};
				signal.addEventListener('abort', onAbort, { once: true });
				waiters.set(id, (approved) => {
					signal.removeEventListener('abort', onAbort);
					waiters.delete(id);
					resolve(
						approved
							? { proceed: true }
							: { proceed: false, rejectionMessage: '用户未批准此次文件写入。' }
					);
				});
				send({
					threadId,
					type: 'tool_approval_request',
					approvalId: id,
					toolName: call.name,
					path: relPath,
				});
			});
		}

		return { proceed: true };
	};
}

/** 由 IPC 调用：解析用户对弹窗的选择 */
export function resolveToolApproval(
	waiters: Map<string, (approved: boolean) => void>,
	approvalId: string,
	approved: boolean
): void {
	const fn = waiters.get(approvalId);
	if (fn) {
		waiters.delete(approvalId);
		fn(approved);
	}
}
