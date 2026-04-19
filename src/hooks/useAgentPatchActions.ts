import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { writePersistedAgentFileChanges } from '../agentFileChangesPersist';
import { normalizeWorkspaceRelPath } from '../agentFileChangesFromGit';
import { computeMergedAgentFileChanges } from '../agentFileChangesCompute';
import type { ChatMessage } from '../threadTypes';
import type { ComposerMode } from '../ComposerPlusMenu';
import type { AgentPendingPatch } from '../ipcTypes';
import type { TFunction } from '../i18n';

const EMPTY_AGENT_PENDING_PATCHES: AgentPendingPatch[] = [];

export type AgentGitPack = {
	gitStatusOk: boolean;
	gitChangedPaths: string[];
	diffPreviews: Record<string, { diff: string; isBinary: boolean; additions: number; deletions: number }>;
};

export type UseAgentPatchActionsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	currentId: string | null;
	currentIdRef: MutableRefObject<string | null>;
	composerMode: ComposerMode;
	t: TFunction;
	messagesRef: MutableRefObject<ChatMessage[]>;
	agentReviewPendingByThreadRef: MutableRefObject<Record<string, AgentPendingPatch[]>>;
	agentGitPackRef: MutableRefObject<AgentGitPack>;
	setAgentReviewBusy: Dispatch<SetStateAction<boolean>>;
	setAgentReviewPendingByThread: Dispatch<SetStateAction<Record<string, AgentPendingPatch[]>>>;
	setDismissedFiles: Dispatch<SetStateAction<Set<string>>>;
	setRevertedFiles: Dispatch<SetStateAction<Set<string>>>;
	setRevertedChangeKeys: Dispatch<SetStateAction<Set<string>>>;
	setFileChangesDismissed: Dispatch<SetStateAction<boolean>>;
	dismissedFilesRef: MutableRefObject<Set<string>>;
	revertedFilesRef: MutableRefObject<Set<string>>;
	revertedChangeKeysRef: MutableRefObject<Set<string>>;
	fileChangesDismissedRef: MutableRefObject<boolean>;
	clearAgentReviewForThread: (threadId: string) => void;
	loadMessages: (id: string) => Promise<unknown>;
	refreshGit: () => void | Promise<unknown>;
};

export type UseAgentPatchActionsResult = {
	onApplyAgentPatchOne: (id: string) => Promise<void>;
	onApplyAgentPatchesAll: () => Promise<void>;
	onDiscardAgentReview: () => void;
	dismissAgentChangedFile: (relPath: string) => void;
	markAgentConversationChangeReverted: (changeKey: string | null, relPath?: string) => void;
	onKeepAllEdits: () => Promise<void>;
	onRevertAllEdits: () => Promise<void>;
	onKeepFileEdit: (relPath: string) => Promise<void>;
	onRevertFileEdit: (relPath: string) => Promise<void>;
};

/**
 * Agent diff/file 审阅类操作集合：apply / dismiss / keep / revert / 标记。
 *
 * 注意：依赖 `openAgentSidebarFilePreview` 的两个 hunk 级回调（`onAcceptAgentFilePreviewHunk`,
 * `onRevertAgentFilePreviewHunk`）保留在 App.tsx 主组件中，因为它们与主组件中
 * 较晚定义的 `openAgentSidebarFilePreview` 形成循环依赖，强行外提需要 ref 转发反而更绕。
 */
export function useAgentPatchActions(params: UseAgentPatchActionsParams): UseAgentPatchActionsResult {
	const {
		shell,
		currentId,
		currentIdRef,
		composerMode,
		t,
		messagesRef,
		agentReviewPendingByThreadRef,
		agentGitPackRef,
		setAgentReviewBusy,
		setAgentReviewPendingByThread,
		setDismissedFiles,
		setRevertedFiles,
		setRevertedChangeKeys,
		setFileChangesDismissed,
		dismissedFilesRef,
		revertedFilesRef,
		revertedChangeKeysRef,
		fileChangesDismissedRef,
		clearAgentReviewForThread,
		loadMessages,
		refreshGit,
	} = params;

	const onApplyAgentPatchOne = useCallback(
		async (id: string) => {
			const cid = currentIdRef.current;
			if (!shell || !cid) {
				return;
			}
			const list = agentReviewPendingByThreadRef.current[cid] ?? EMPTY_AGENT_PENDING_PATCHES;
			const patch = list.find((p) => p.id === id);
			if (!patch) {
				return;
			}
			setAgentReviewBusy(true);
			try {
				const ar = (await shell.invoke('agent:applyDiffChunk', {
					threadId: cid,
					chunk: patch.chunk,
				})) as { applied: string[]; failed: { path: string; reason: string }[] };
				if (ar.applied.length > 0) {
					setAgentReviewPendingByThread((prev) => ({
						...prev,
						[cid]: (prev[cid] ?? []).filter((x) => x.id !== id),
					}));
				}
				await loadMessages(cid);
				await refreshGit();
			} finally {
				setAgentReviewBusy(false);
			}
		},
		[
			shell,
			loadMessages,
			refreshGit,
			currentIdRef,
			agentReviewPendingByThreadRef,
			setAgentReviewBusy,
			setAgentReviewPendingByThread,
		]
	);

	const onApplyAgentPatchesAll = useCallback(async () => {
		const cid = currentIdRef.current;
		if (!shell || !cid) {
			return;
		}
		const list = agentReviewPendingByThreadRef.current[cid] ?? EMPTY_AGENT_PENDING_PATCHES;
		if (list.length === 0) {
			return;
		}
		setAgentReviewBusy(true);
		try {
			const ar = (await shell.invoke('agent:applyDiffChunks', {
				threadId: cid,
				items: list.map((p) => ({ id: p.id, chunk: p.chunk })),
			})) as {
				applied: string[];
				failed: { path: string; reason: string }[];
				succeededIds: string[];
			};
			const okIds = new Set(ar.succeededIds ?? []);
			setAgentReviewPendingByThread((prev) => ({
				...prev,
				[cid]: (prev[cid] ?? []).filter((p) => !okIds.has(p.id)),
			}));
			await loadMessages(cid);
			await refreshGit();
		} finally {
			setAgentReviewBusy(false);
		}
	}, [
		shell,
		loadMessages,
		refreshGit,
		currentIdRef,
		agentReviewPendingByThreadRef,
		setAgentReviewBusy,
		setAgentReviewPendingByThread,
	]);

	const onDiscardAgentReview = useCallback(() => {
		if (currentId) {
			clearAgentReviewForThread(currentId);
		}
	}, [currentId, clearAgentReviewForThread]);

	const dismissAgentChangedFile = useCallback(
		(relPath: string) => {
			if (!currentId) {
				return;
			}
			setDismissedFiles((prev) => {
				const next = new Set(prev).add(relPath);
				const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
				writePersistedAgentFileChanges(
					currentId,
					last?.content ?? '',
					fileChangesDismissedRef.current,
					next,
					revertedFilesRef.current,
					revertedChangeKeysRef.current
				);
				return next;
			});
		},
		[
			currentId,
			setDismissedFiles,
			messagesRef,
			fileChangesDismissedRef,
			revertedFilesRef,
			revertedChangeKeysRef,
		]
	);

	const markAgentConversationChangeReverted = useCallback(
		(changeKey: string | null, relPath?: string) => {
			if (!currentId) {
				return;
			}
			const normalizedPath =
				typeof relPath === 'string' ? normalizeWorkspaceRelPath(relPath) : '';
			const normalizedKey = typeof changeKey === 'string' ? changeKey.trim() : '';
			const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
			let nextPaths = revertedFilesRef.current;
			let nextKeys = revertedChangeKeysRef.current;
			if (normalizedPath) {
				nextPaths = new Set(revertedFilesRef.current).add(normalizedPath);
				setRevertedFiles(nextPaths);
			}
			if (normalizedKey) {
				nextKeys = new Set(revertedChangeKeysRef.current).add(normalizedKey);
				setRevertedChangeKeys(nextKeys);
			}
			writePersistedAgentFileChanges(
				currentId,
				last?.content ?? '',
				fileChangesDismissedRef.current,
				dismissedFilesRef.current,
				nextPaths,
				nextKeys
			);
		},
		[
			currentId,
			setRevertedFiles,
			setRevertedChangeKeys,
			messagesRef,
			fileChangesDismissedRef,
			dismissedFilesRef,
			revertedFilesRef,
			revertedChangeKeysRef,
		]
	);

	const onKeepAllEdits = useCallback(async () => {
		if (!currentId) {
			return;
		}
		if (shell) {
			try {
				await shell.invoke('agent:keepLastTurn', currentId);
			} catch {
				/* ignore */
			}
		}
		setDismissedFiles(new Set());
		setFileChangesDismissed(true);
		const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
		writePersistedAgentFileChanges(
			currentId,
			last?.content ?? '',
			true,
			new Set(),
			revertedFilesRef.current,
			revertedChangeKeysRef.current
		);
	}, [
		shell,
		currentId,
		setDismissedFiles,
		setFileChangesDismissed,
		messagesRef,
		revertedFilesRef,
		revertedChangeKeysRef,
	]);

	const onRevertAllEdits = useCallback(async () => {
		if (!shell || composerMode !== 'agent' || !currentId) return;
		const gp = agentGitPackRef.current;
		const revertedPaths = new Set(
			computeMergedAgentFileChanges(
				messagesRef.current,
				composerMode,
				t,
				dismissedFilesRef.current,
				{
					gitStatusOk: gp.gitStatusOk,
					gitChangedPaths: gp.gitChangedPaths,
					diffPreviews: gp.diffPreviews,
				},
				null
			).map((file) => file.path)
		);
		try {
			const result = (await shell.invoke('agent:revertLastTurn', currentId)) as {
				ok?: boolean;
				reverted?: number;
			};
			if ((result.reverted ?? 0) > 0) {
				void refreshGit();
			}
		} catch {
			/* IPC error — still dismiss panel to unblock the user */
		}
		setRevertedFiles(revertedPaths);
		setRevertedChangeKeys(new Set());
		setDismissedFiles(new Set());
		setFileChangesDismissed(true);
		const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
		writePersistedAgentFileChanges(
			currentId,
			last?.content ?? '',
			true,
			new Set(),
			revertedPaths,
			new Set()
		);
	}, [
		shell,
		composerMode,
		currentId,
		refreshGit,
		t,
		agentGitPackRef,
		messagesRef,
		dismissedFilesRef,
		setRevertedFiles,
		setRevertedChangeKeys,
		setDismissedFiles,
		setFileChangesDismissed,
	]);

	const onKeepFileEdit = useCallback(
		async (relPath: string) => {
			if (!shell || !currentId) return;
			try {
				await shell.invoke('agent:keepFile', currentId, relPath);
			} catch {
				/* ignore */
			}
			dismissAgentChangedFile(relPath);
		},
		[dismissAgentChangedFile, shell, currentId]
	);

	const onRevertFileEdit = useCallback(
		async (relPath: string) => {
			if (!shell || !currentId) return;
			try {
				await shell.invoke('agent:revertFile', currentId, relPath);
				void refreshGit();
			} catch {
				/* ignore */
			}
			markAgentConversationChangeReverted(null, relPath);
			dismissAgentChangedFile(relPath);
		},
		[dismissAgentChangedFile, markAgentConversationChangeReverted, shell, currentId, refreshGit]
	);

	return {
		onApplyAgentPatchOne,
		onApplyAgentPatchesAll,
		onDiscardAgentReview,
		dismissAgentChangedFile,
		markAgentConversationChangeReverted,
		onKeepAllEdits,
		onRevertAllEdits,
		onKeepFileEdit,
		onRevertFileEdit,
	};
}
