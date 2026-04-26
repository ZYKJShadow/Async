import { useCallback, useRef, useState } from 'react';
import type { AgentPendingPatch } from '../ipcTypes';

export type AgentFilePreviewState = {
	relPath: string;
	revealLine?: number;
	revealEndLine?: number;
	loading: boolean;
	content: string;
	diff: string;
	isBinary: boolean;
	previewKind?: AgentFilePreviewKind;
	fileSize?: number;
	unsupportedReason?: AgentFilePreviewUnsupportedReason | null;
	imageUrl?: string;
	readError: string | null;
	additions: number;
	deletions: number;
	reviewMode: 'snapshot' | 'readonly';
};

export type AgentFilePreviewKind =
	| 'text'
	| 'image'
	| 'pdf'
	| 'office'
	| 'archive'
	| 'media'
	| 'font'
	| 'executable'
	| 'binary'
	| 'large'
	| 'unknown';

export type AgentFilePreviewUnsupportedReason =
	| 'unsupported-type'
	| 'too-large'
	| 'binary-content'
	| 'not-file';

/**
 * 管理 Agent 文件审阅状态：待审阅 patch 列表、dismiss/revert 跟踪、文件预览。
 * 复杂操作（approveAll、revertAll）依赖 shell/loadMessages/refreshGit，留在 App.tsx 中组合。
 */
export function useAgentFileReview() {
	const [agentReviewPendingByThread, setAgentReviewPendingByThread] = useState<
		Record<string, AgentPendingPatch[]>
	>({});
	const [agentReviewBusy, setAgentReviewBusy] = useState(false);

	const [fileChangesDismissed, setFileChangesDismissed] = useState(false);
	const fileChangesDismissedRef = useRef(fileChangesDismissed);
	fileChangesDismissedRef.current = fileChangesDismissed;

	const [dismissedFiles, setDismissedFiles] = useState<Set<string>>(new Set());
	const dismissedFilesRef = useRef(dismissedFiles);
	dismissedFilesRef.current = dismissedFiles;

	const [revertedFiles, setRevertedFiles] = useState<Set<string>>(new Set());
	const revertedFilesRef = useRef(revertedFiles);
	revertedFilesRef.current = revertedFiles;

	const [revertedChangeKeys, setRevertedChangeKeys] = useState<Set<string>>(new Set());
	const revertedChangeKeysRef = useRef(revertedChangeKeys);
	revertedChangeKeysRef.current = revertedChangeKeys;

	/**
	 * 仍然可以撤销的文件路径（来自 main 进程仍然持有的快照）。
	 * 重启后即便 fileChanges 面板上仍能看到 Agent 改过的文件，没有快照就无法 revert，
	 * 这里把"还能撤销的集合"暴露给 UI，用于按钮置灰、撤销失败拦截。
	 */
	const [revertableSnapshotPaths, setRevertableSnapshotPaths] = useState<Set<string>>(new Set());
	const revertableSnapshotPathsRef = useRef(revertableSnapshotPaths);
	revertableSnapshotPathsRef.current = revertableSnapshotPaths;

	const [revertNotice, setRevertNotice] = useState<string | null>(null);

	const [agentFilePreview, setAgentFilePreview] = useState<AgentFilePreviewState | null>(null);
	const [agentFilePreviewBusyPatch, setAgentFilePreviewBusyPatch] = useState<string | null>(null);
	const agentFilePreviewRequestRef = useRef(0);

	const clearAgentReviewForThread = useCallback((threadId: string) => {
		setAgentReviewPendingByThread((prev) => {
			const next = { ...prev };
			delete next[threadId];
			return next;
		});
	}, []);

	/** 切换工作区时重置审阅状态 */
	const resetAgentReviewState = useCallback(() => {
		setFileChangesDismissed(false);
		setDismissedFiles(new Set());
	}, []);

	return {
		agentReviewPendingByThread,
		setAgentReviewPendingByThread,
		agentReviewBusy,
		setAgentReviewBusy,
		fileChangesDismissed,
		setFileChangesDismissed,
		fileChangesDismissedRef,
		dismissedFiles,
		setDismissedFiles,
		dismissedFilesRef,
		revertedFiles,
		setRevertedFiles,
		revertedFilesRef,
		revertedChangeKeys,
		setRevertedChangeKeys,
		revertedChangeKeysRef,
		revertableSnapshotPaths,
		setRevertableSnapshotPaths,
		revertableSnapshotPathsRef,
		revertNotice,
		setRevertNotice,
		agentFilePreview,
		setAgentFilePreview,
		agentFilePreviewBusyPatch,
		setAgentFilePreviewBusyPatch,
		agentFilePreviewRequestRef,
		clearAgentReviewForThread,
		resetAgentReviewState,
	};
}
