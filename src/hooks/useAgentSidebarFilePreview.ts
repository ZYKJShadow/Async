import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { buildAgentFilePreviewHunks } from '../agentFilePreviewDiff';
import { countDiffAddDel } from '../agentChatSegments';
import { normalizeWorkspaceRelPath, workspaceRelPathsEqual } from '../agentFileChangesFromGit';
import { voidShellDebugLog } from '../tabCloseDebug';
import { debugDiffHead } from '../appDiffUtils';
import type { ShellLayoutMode } from '../app/shellLayoutStorage';
import type { AgentConversationFileOpenOptions } from './useFileOperations';
import type { AgentFilePreviewState } from './useAgentFileReview';
import type { AgentRightSidebarView } from './useTeamSessionActions';

type DiffPreview = {
	diff: string;
	isBinary: boolean;
	additions: number;
	deletions: number;
};

export type AgentGitPack = {
	gitStatusOk: boolean;
	gitChangedPaths: string[];
	diffPreviews: Record<string, DiffPreview>;
};

export type UseAgentSidebarFilePreviewParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	layoutMode: ShellLayoutMode;
	currentId: string | null;
	openFileInTab: (
		rel: string,
		revealLine?: number,
		revealEndLine?: number,
		options?: { background?: boolean } & AgentConversationFileOpenOptions
	) => Promise<void> | void;
	agentGitPackRef: MutableRefObject<AgentGitPack>;
	setAgentRightSidebarView: Dispatch<SetStateAction<AgentRightSidebarView>>;
	setAgentRightSidebarOpen: Dispatch<SetStateAction<boolean>>;
	setAgentFilePreview: Dispatch<SetStateAction<AgentFilePreviewState | null>>;
	agentFilePreviewRequestRef: MutableRefObject<number>;
};

export type AgentSidebarFilePreviewOpener = (
	rel: string,
	revealLine?: number,
	revealEndLine?: number,
	options?: AgentConversationFileOpenOptions
) => Promise<void>;

/**
 * 在 agent 布局右侧栏打开"文件预览 + diff"。
 *
 * 实现细节：四级 diff 来源回退，行为与原 App.tsx 完全一致：
 *  1. 来源 diff（assistant 消息直接给出的 patch / preview）；
 *  2. agent 快照（snapshot），通过 createTwoFilesPatch 生成；
 *  3. 权威 git diff（git:diffPreview full=true）；
 *  4. 缓存的 git preview 兜底。
 *
 * 同时维护 requestId 抗竞态：每次进入 +1，最终写入前若 ref 已变则丢弃。
 */
export function useAgentSidebarFilePreview(
	params: UseAgentSidebarFilePreviewParams
): AgentSidebarFilePreviewOpener {
	const {
		shell,
		layoutMode,
		currentId,
		openFileInTab,
		agentGitPackRef,
		setAgentRightSidebarView,
		setAgentRightSidebarOpen,
		setAgentFilePreview,
		agentFilePreviewRequestRef,
	} = params;

	return useCallback(
		async (
			rel: string,
			revealLine?: number,
			revealEndLine?: number,
			options?: AgentConversationFileOpenOptions
		) => {
			if (!shell || layoutMode !== 'agent') {
				await openFileInTab(rel, revealLine, revealEndLine, options);
				return;
			}

			const { gitStatusOk, gitChangedPaths, diffPreviews } = agentGitPackRef.current;
			const normalizedRel = normalizeWorkspaceRelPath(rel);
			const safeRevealLine =
				typeof revealLine === 'number' && Number.isFinite(revealLine) && revealLine > 0
					? Math.floor(revealLine)
					: undefined;
			const safeRevealEndLine =
				typeof revealEndLine === 'number' && Number.isFinite(revealEndLine) && revealEndLine > 0
					? Math.floor(revealEndLine)
					: undefined;
			const sourceDiff = typeof options?.diff === 'string' ? options.diff.trim() : '';
			const sourceAllowsReviewActions = options?.allowReviewActions === true;
			const useSourceReadonlyFallback = !gitStatusOk && sourceDiff.length > 0;
			voidShellDebugLog('agent-file-preview:open:start', {
				relPath: normalizedRel,
				revealLine: safeRevealLine ?? null,
				revealEndLine: safeRevealEndLine ?? null,
				sourceDiffLength: sourceDiff.length,
				sourceDiffHead: sourceDiff ? debugDiffHead(sourceDiff) : '',
				allowReviewActions: sourceAllowsReviewActions,
				useSourceReadonlyFallback,
				layoutMode,
				currentId: currentId ?? '',
			});

			setAgentRightSidebarView('file');
			setAgentRightSidebarOpen(true);
			setAgentFilePreview((prev) => ({
				relPath: normalizedRel,
				revealLine: safeRevealLine,
				revealEndLine: safeRevealEndLine,
				loading: true,
				content: prev?.relPath === normalizedRel ? prev.content : '',
				diff: sourceAllowsReviewActions || useSourceReadonlyFallback ? sourceDiff : '',
				isBinary: false,
				readError: null,
				additions: 0,
				deletions: 0,
				reviewMode:
					prev?.relPath === normalizedRel && sourceAllowsReviewActions
						? prev.reviewMode
						: 'readonly',
			}));

			const requestId = ++agentFilePreviewRequestRef.current;
			let content = '';
			let readError: string | null = null;
			try {
				const fileResult = (await shell.invoke('fs:readFile', normalizedRel)) as {
					ok?: boolean;
					content?: string;
				};
				if (fileResult.ok && typeof fileResult.content === 'string') {
					content = fileResult.content;
				}
			} catch (err) {
				readError = err instanceof Error ? err.message : String(err);
			}

			let previewDiff = sourceAllowsReviewActions || useSourceReadonlyFallback ? sourceDiff : '';
			let isBinary = false;
			let additions = 0;
			let deletions = 0;
			let reviewMode: AgentFilePreviewState['reviewMode'] = 'readonly';
			const isGitChanged = gitChangedPaths.some((path) =>
				workspaceRelPathsEqual(path, normalizedRel)
			);
			voidShellDebugLog('agent-file-preview:open:path-match', {
				relPath: normalizedRel,
				isGitChanged,
				gitChangedCount: gitChangedPaths.length,
				gitChangedHead: gitChangedPaths.slice(0, 12).join(' | '),
			});

			if (currentId && sourceAllowsReviewActions) {
				try {
					const snapshotResult = (await shell.invoke(
						'agent:getFileSnapshot',
						currentId,
						normalizedRel
					)) as
						| { ok: true; hasSnapshot: false }
						| { ok: true; hasSnapshot: true; previousContent: string | null }
						| { ok?: false };
					if (snapshotResult?.ok && snapshotResult.hasSnapshot) {
						const previousContent = snapshotResult.previousContent ?? '';
						const { createTwoFilesPatch } = await import('diff');
						previewDiff = createTwoFilesPatch(
							`a/${normalizedRel}`,
							`b/${normalizedRel}`,
							previousContent,
							content,
							'',
							'',
							{ context: 3 }
						).trim();
						reviewMode = 'snapshot';
						readError = null;
						voidShellDebugLog('agent-file-preview:open:snapshot', {
							relPath: normalizedRel,
							previousLength: previousContent.length,
							contentLength: content.length,
							diffLength: previewDiff.length,
							hunkCount: (await buildAgentFilePreviewHunks(previewDiff)).length,
							diffHead: debugDiffHead(previewDiff),
						});
					}
				} catch {
					/* snapshot lookup failed; fall back to git preview */
				}
			}

			let authoritativeGitPreviewLoaded = false;
			if (gitStatusOk) {
				try {
					const fullDiffResult = (await shell.invoke('git:diffPreview', {
						relPath: normalizedRel,
						full: true,
					})) as { ok: true; preview: DiffPreview } | { ok: false; error?: string };
					if (fullDiffResult.ok && fullDiffResult.preview) {
						authoritativeGitPreviewLoaded = true;
						const gitPreviewDiff = String(fullDiffResult.preview.diff ?? '');
						const gitPreviewIsBinary = fullDiffResult.preview.isBinary === true;
						const gitPreviewAdditions = fullDiffResult.preview.additions ?? 0;
						const gitPreviewDeletions = fullDiffResult.preview.deletions ?? 0;
						const gitPreviewHead = debugDiffHead(gitPreviewDiff);
						if (!sourceAllowsReviewActions || reviewMode !== 'snapshot') {
							previewDiff = gitPreviewDiff;
							isBinary = gitPreviewIsBinary;
							additions = gitPreviewAdditions;
							deletions = gitPreviewDeletions;
							reviewMode = 'readonly';
						} else if (!gitPreviewDiff.trim()) {
							// Snapshot exists but git shows clean: trust git and hide stale inline diff.
							previewDiff = '';
							isBinary = gitPreviewIsBinary;
							additions = gitPreviewAdditions;
							deletions = gitPreviewDeletions;
							reviewMode = 'readonly';
						}
						voidShellDebugLog('agent-file-preview:open:git-authoritative', {
							relPath: normalizedRel,
							diffLength: gitPreviewDiff.length,
							hunkCount: (await buildAgentFilePreviewHunks(gitPreviewDiff)).length,
							isBinary: gitPreviewIsBinary,
							additions: gitPreviewAdditions,
							deletions: gitPreviewDeletions,
							reviewMode,
							diffHead: gitPreviewHead,
						});
					}
				} catch {
					/* fall back to cached preview/status heuristics below */
				}
			}

			if (!authoritativeGitPreviewLoaded && !previewDiff && gitStatusOk && isGitChanged) {
				const cachedPreview = Object.entries(diffPreviews).find(([path]) =>
					workspaceRelPathsEqual(path, normalizedRel)
				)?.[1];
				voidShellDebugLog('agent-file-preview:open:git-start', {
					relPath: normalizedRel,
					hasCachedPreview: Boolean(cachedPreview),
					cachedDiffLength: String(cachedPreview?.diff ?? '').length,
					gitStatusOk,
					isGitChanged,
				});
				if (cachedPreview) {
					isBinary = cachedPreview.isBinary === true;
					additions = cachedPreview.additions ?? 0;
					deletions = cachedPreview.deletions ?? 0;
				}
				try {
					const fullDiffResult = (await shell.invoke('git:diffPreview', {
						relPath: normalizedRel,
						full: true,
					})) as { ok: true; preview: DiffPreview } | { ok: false; error?: string };
					if (fullDiffResult.ok && fullDiffResult.preview) {
						previewDiff = String(fullDiffResult.preview.diff ?? '');
						isBinary = fullDiffResult.preview.isBinary === true;
						additions = fullDiffResult.preview.additions ?? additions;
						deletions = fullDiffResult.preview.deletions ?? deletions;
						reviewMode = 'readonly';
						voidShellDebugLog('agent-file-preview:open:git-full', {
							relPath: normalizedRel,
							diffLength: previewDiff.length,
							hunkCount: (await buildAgentFilePreviewHunks(previewDiff)).length,
							isBinary,
							additions,
							deletions,
							diffHead: debugDiffHead(previewDiff),
						});
					}
				} catch {
					if (cachedPreview) {
						previewDiff = String(cachedPreview.diff ?? '');
						isBinary = cachedPreview.isBinary === true;
						additions = cachedPreview.additions ?? 0;
						deletions = cachedPreview.deletions ?? 0;
						reviewMode = 'readonly';
						voidShellDebugLog('agent-file-preview:open:git-cached-fallback', {
							relPath: normalizedRel,
							diffLength: previewDiff.length,
							hunkCount: (await buildAgentFilePreviewHunks(previewDiff)).length,
							isBinary,
							additions,
							deletions,
							diffHead: debugDiffHead(previewDiff),
						});
					}
				}
			}

			if (
				!authoritativeGitPreviewLoaded &&
				previewDiff &&
				!isBinary &&
				reviewMode === 'readonly' &&
				(await buildAgentFilePreviewHunks(previewDiff)).length === 0
			) {
				try {
					const fullDiffResult = (await shell.invoke('git:diffPreview', {
						relPath: normalizedRel,
						full: true,
					})) as { ok: true; preview: DiffPreview } | { ok: false; error?: string };
					if (fullDiffResult.ok && fullDiffResult.preview) {
						previewDiff = String(fullDiffResult.preview.diff ?? '');
						isBinary = fullDiffResult.preview.isBinary === true;
						additions = fullDiffResult.preview.additions ?? additions;
						deletions = fullDiffResult.preview.deletions ?? deletions;
						voidShellDebugLog('agent-file-preview:open:git-retry-full', {
							relPath: normalizedRel,
							diffLength: previewDiff.length,
							hunkCount: (await buildAgentFilePreviewHunks(previewDiff)).length,
							isBinary,
							additions,
							deletions,
							diffHead: debugDiffHead(previewDiff),
						});
					}
				} catch {
					/* keep the existing preview fallback */
				}
			}

			if (previewDiff) {
				const stats = countDiffAddDel(previewDiff);
				additions = additions || stats.additions;
				deletions = deletions || stats.deletions;
				readError = null;
			}

			const previewHunks = !isBinary ? await buildAgentFilePreviewHunks(previewDiff) : [];
			if (
				currentId &&
				sourceAllowsReviewActions &&
				previewDiff &&
				!isBinary &&
				reviewMode === 'readonly' &&
				previewHunks.length > 0
			) {
				try {
					const seedResult = (await shell.invoke('agent:seedFileSnapshot', {
						threadId: currentId,
						relPath: normalizedRel,
						content,
						diff: previewDiff,
					})) as {
						ok?: boolean;
						seeded?: boolean;
						previousLength?: number;
						error?: string;
					};
					if (seedResult?.ok && seedResult.seeded) {
						reviewMode = 'snapshot';
						voidShellDebugLog('agent-file-preview:open:seeded-snapshot', {
							relPath: normalizedRel,
							contentLength: content.length,
							previousLength: seedResult.previousLength ?? 0,
							diffLength: previewDiff.length,
							hunkCount: previewHunks.length,
							diffHead: debugDiffHead(previewDiff),
						});
					}
				} catch {
					/* derived snapshot seeding failed; keep readonly preview */
				}
			}

			if (requestId !== agentFilePreviewRequestRef.current) {
				voidShellDebugLog('agent-file-preview:open:stale', {
					relPath: normalizedRel,
					requestId,
					activeRequestId: agentFilePreviewRequestRef.current,
				});
				return;
			}

			voidShellDebugLog('agent-file-preview:open:final', {
				relPath: normalizedRel,
				reviewMode,
				contentLength: content.length,
				diffLength: previewDiff.length,
				hunkCount: previewHunks.length,
				isBinary,
				additions,
				deletions,
				readError: readError ?? '',
				diffHead: previewDiff ? debugDiffHead(previewDiff) : '',
			});

			setAgentFilePreview({
				relPath: normalizedRel,
				revealLine: safeRevealLine,
				revealEndLine: safeRevealEndLine,
				loading: false,
				content,
				diff: previewDiff,
				isBinary,
				readError,
				additions,
				deletions,
				reviewMode,
			});
		},
		[
			currentId,
			layoutMode,
			openFileInTab,
			shell,
			agentGitPackRef,
			setAgentRightSidebarView,
			setAgentRightSidebarOpen,
			setAgentFilePreview,
			agentFilePreviewRequestRef,
		]
	);
}
