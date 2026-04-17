import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentToolDef, ToolResult } from './agentTools.js';
import type { ToolExecutionContext } from './toolExecutor.js';

const PERSIST_PREVIEW_CHARS = 4000;
const DEFAULT_THRESHOLD_CHARS = 100_000;
const BASH_THRESHOLD_CHARS = 30_000;
const SEARCH_THRESHOLD_CHARS = 20_000;

function sanitizePathPart(raw: string): string {
	return raw.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80) || 'item';
}

export function maxResultSizeCharsForTool(
	toolName: string,
	toolDef?: AgentToolDef | null
): number | null {
	if (typeof toolDef?.maxResultSizeChars === 'number') {
		if (!Number.isFinite(toolDef.maxResultSizeChars)) {
			return null;
		}
		return Math.max(0, Math.floor(toolDef.maxResultSizeChars));
	}
	if (toolName === 'Read') return null;
	if (toolName === 'Bash') return BASH_THRESHOLD_CHARS;
	if (toolName === 'Grep') return SEARCH_THRESHOLD_CHARS;
	if (toolName === 'Browser' || toolName === 'BrowserCapture') return BASH_THRESHOLD_CHARS;
	if (toolName.startsWith('mcp__')) return DEFAULT_THRESHOLD_CHARS;
	if (toolName === 'ReadMcpResourceTool' || toolName === 'ListMcpResourcesTool' || toolName === 'LSP') {
		return DEFAULT_THRESHOLD_CHARS;
	}
	return null;
}

function buildPersistenceTarget(
	execCtx: ToolExecutionContext,
	toolUseId: string,
	toolName: string
): {
	fullPath: string;
	displayPath: string;
} {
	const fileName = `${sanitizePathPart(toolName)}-${sanitizePathPart(toolUseId)}.txt`;
	if (execCtx.workspaceRoot) {
		const threadPart = sanitizePathPart(execCtx.threadId ?? 'thread');
		const relPath = path.posix.join('.async', 'tool-results', threadPart, fileName);
		return {
			fullPath: path.join(execCtx.workspaceRoot, relPath.replace(/\//g, path.sep)),
			displayPath: relPath,
		};
	}
	const tmpPath = path.join(
		os.tmpdir(),
		'async-tool-results',
		sanitizePathPart(execCtx.threadId ?? 'thread'),
		fileName
	);
	return {
		fullPath: tmpPath,
		displayPath: tmpPath,
	};
}

export function buildPersistedPreviewMessage(
	toolName: string,
	displayPath: string,
	originalContent: string
): string {
	const preview =
		originalContent.length > PERSIST_PREVIEW_CHARS
			? `${originalContent.slice(0, PERSIST_PREVIEW_CHARS)}\n... (preview truncated)`
			: originalContent;
	return [
		'[Large tool result persisted]',
		`Tool: ${toolName}`,
		`Path: ${displayPath}`,
		`Original size: ${originalContent.length} chars`,
		'Preview:',
		preview,
	].join('\n');
}

export async function persistToolResultToDisk(
	result: ToolResult,
	execCtx: ToolExecutionContext
): Promise<{
	content: string;
	originalSize: number;
}> {
	const target = buildPersistenceTarget(execCtx, result.toolCallId, result.name);
	await fs.promises.mkdir(path.dirname(target.fullPath), { recursive: true });
	await fs.promises.writeFile(target.fullPath, result.content, 'utf8');
	return {
		content: buildPersistedPreviewMessage(result.name, target.displayPath, result.content),
		originalSize: result.content.length,
	};
}

export async function persistLargeToolResultIfNeeded(
	result: ToolResult,
	execCtx: ToolExecutionContext,
	toolDef?: AgentToolDef | null
): Promise<ToolResult> {
	const threshold = maxResultSizeCharsForTool(result.name, toolDef);
	if (!Number.isFinite(threshold) || threshold === null || result.content.length <= threshold) {
		return result;
	}

	try {
		const persisted = await persistToolResultToDisk(result, execCtx);
		return {
			...result,
			content: persisted.content,
			structuredContent: undefined,
		};
	} catch {
		const fallbackPreview =
			result.content.length > PERSIST_PREVIEW_CHARS
				? `${result.content.slice(0, PERSIST_PREVIEW_CHARS)}\n... (truncated after persistence fallback)`
				: result.content;
		return {
			...result,
			content: fallbackPreview,
			structuredContent: undefined,
		};
	}
}
