import { useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { newSegmentId, type ComposerSegment } from '../composerSegments';
import { tabIdFromPath, type EditorTab } from '../EditorTabBar';
import type { TFunction } from '../i18n';
import type { TurnTokenUsage } from '../ipcTypes';
import type { ParsedPlan } from '../planParser';
import type { ShellLayoutMode } from '../app/shellLayoutStorage';
import type { WorkspaceExplorerActions } from '../WorkspaceExplorer';
import type { AgentConversationFileOpenOptions } from './useFileOperations';

export type UseWorkspaceExplorerActionsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	workspace: string | null;
	t: TFunction;
	flashComposerAttachErr: (msg: string) => void;

	// editor tabs
	openFileInTab: (
		rel: string,
		revealLine?: number,
		revealEndLine?: number,
		options?: { background?: boolean } & AgentConversationFileOpenOptions
	) => Promise<void> | void;
	setOpenTabs: Dispatch<SetStateAction<EditorTab[]>>;
	activeTabId: string | null;
	setActiveTabId: (id: string | null) => void;
	filePath: string;
	setFilePath: (path: string) => void;
	setEditorValue: Dispatch<SetStateAction<string>>;

	// terminal
	appendEditorTerminal: (init?: { cwdRel?: string }) => Promise<void> | void;
	setEditorTerminalVisible: (visible: boolean) => void;

	// layout
	setLayoutMode: Dispatch<SetStateAction<ShellLayoutMode>>;

	// composer
	setComposerSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	composerRichBottomRef: RefObject<HTMLDivElement | null>;
	composerRichHeroRef: RefObject<HTMLDivElement | null>;

	// thread + streaming reset (addToNewChat)
	refreshThreads: () => void | Promise<unknown>;
	loadMessages: (id: string) => Promise<unknown>;
	setCurrentId: Dispatch<SetStateAction<string | null>>;
	setLastTurnUsage: Dispatch<SetStateAction<TurnTokenUsage | null>>;
	setAwaitingReply: Dispatch<SetStateAction<boolean>>;
	setStreaming: Dispatch<SetStateAction<string>>;
	setStreamingThinking: Dispatch<SetStateAction<string>>;
	clearStreamingToolPreviewNow: () => void;
	resetLiveAgentBlocks: () => void;
	streamStartedAtRef: { current: number | null };
	firstTokenAtRef: { current: number | null };
	setParsedPlan: Dispatch<SetStateAction<ParsedPlan | null>>;
	setPlanFilePath: Dispatch<SetStateAction<string | null>>;
	setPlanFileRelPath: Dispatch<SetStateAction<string | null>>;
	setInlineResendSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	setResendFromUserIndex: Dispatch<SetStateAction<number | null>>;

	// git
	refreshGit: () => void | Promise<unknown>;
};

/**
 * `WorkspaceExplorer` 的右键 / 双击动作集合（openInBrowser / 复制路径 / rename / delete / addToChat 等）。
 *
 * 行为与原 App.tsx 中 230 行的 `workspaceExplorerActions` useMemo 完全一致；
 * 仅当 shell + workspace 都存在时返回非空对象，否则返回 null（与原版语义相同）。
 */
export function useWorkspaceExplorerActions(
	params: UseWorkspaceExplorerActionsParams
): WorkspaceExplorerActions | null {
	const {
		shell,
		workspace,
		t,
		flashComposerAttachErr,
		openFileInTab,
		setOpenTabs,
		activeTabId,
		setActiveTabId,
		filePath,
		setFilePath,
		setEditorValue,
		appendEditorTerminal,
		setEditorTerminalVisible,
		setLayoutMode,
		setComposerSegments,
		composerRichBottomRef,
		composerRichHeroRef,
		refreshThreads,
		loadMessages,
		setCurrentId,
		setLastTurnUsage,
		setAwaitingReply,
		setStreaming,
		setStreamingThinking,
		clearStreamingToolPreviewNow,
		resetLiveAgentBlocks,
		streamStartedAtRef,
		firstTokenAtRef,
		setParsedPlan,
		setPlanFilePath,
		setPlanFileRelPath,
		setInlineResendSegments,
		setResendFromUserIndex,
		refreshGit,
	} = params;

	return useMemo((): WorkspaceExplorerActions | null => {
		if (!shell || !workspace) {
			return null;
		}
		const joinAbs = (rel: string) => {
			const root = workspace.replace(/\\/g, '/').replace(/\/$/, '');
			const sub = rel.replace(/\\/g, '/').replace(/^\//, '');
			return `${root}/${sub}`;
		};
		const normPath = (p: string) => p.replace(/\\/g, '/');
		return {
			openToSide: (rel) => void openFileInTab(rel, undefined, undefined, { background: true }),
			openInBrowser: async (rel) => {
				const r = (await shell.invoke('shell:openInBrowser', rel)) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errOpenBrowser'));
				}
			},
			openWithDefault: async (rel) => {
				const r = (await shell.invoke('shell:openDefault', rel)) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errOpenDefault'));
				}
			},
			revealInOs: async (rel) => {
				const r = (await shell.invoke('shell:revealInFolder', rel)) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errReveal'));
				}
			},
			openInTerminal: async (cwdRel) => {
				setLayoutMode('editor');
				setEditorTerminalVisible(true);
				await appendEditorTerminal(cwdRel !== '' ? { cwdRel } : undefined);
			},
			copyAbsolutePath: async (rel) => {
				const r = (await shell.invoke('clipboard:writeText', joinAbs(rel))) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errClipboard'));
				}
			},
			copyRelativePath: async (rel) => {
				const r = (await shell.invoke('clipboard:writeText', rel.replace(/\\/g, '/'))) as {
					ok?: boolean;
					error?: string;
				};
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errClipboard'));
				}
			},
			copyFileName: async (rel) => {
				const base = normPath(rel).split('/').pop() ?? rel;
				const r = (await shell.invoke('clipboard:writeText', base)) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errClipboard'));
				}
			},
			addToChat: (rel) => {
				setComposerSegments((prev) => {
					const next = [...prev];
					const last = next[next.length - 1];
					if (last?.kind === 'text' && last.text.length > 0 && !/\s$/.test(last.text)) {
						next[next.length - 1] = { ...last, text: `${last.text} ` };
					}
					next.push({ id: newSegmentId(), kind: 'file', path: rel });
					next.push({ id: newSegmentId(), kind: 'text', text: '' });
					return next;
				});
				setLayoutMode('agent');
				queueMicrotask(() => {
					if (composerRichBottomRef.current) {
						composerRichBottomRef.current.focus();
					} else {
						composerRichHeroRef.current?.focus();
					}
				});
			},
			addToNewChat: async (rel) => {
				const r = (await shell.invoke('threads:create')) as { id: string };
				await refreshThreads();
				await shell.invoke('threads:select', r.id);
				setCurrentId(r.id);
				setLastTurnUsage(null);
				setAwaitingReply(false);
				setStreaming('');
				setStreamingThinking('');
				clearStreamingToolPreviewNow();
				resetLiveAgentBlocks();
				streamStartedAtRef.current = null;
				firstTokenAtRef.current = null;
				setParsedPlan(null);
				setPlanFilePath(null);
				setPlanFileRelPath(null);
				await loadMessages(r.id);
				setComposerSegments([
					{ id: newSegmentId(), kind: 'file', path: rel },
					{ id: newSegmentId(), kind: 'text', text: '' },
				]);
				setInlineResendSegments([]);
				setResendFromUserIndex(null);
				setLayoutMode('agent');
				queueMicrotask(() => {
					if (composerRichBottomRef.current) {
						composerRichBottomRef.current.focus();
					} else {
						composerRichHeroRef.current?.focus();
					}
				});
			},
			rename: async (rel) => {
				const parts = normPath(rel).split('/').filter(Boolean);
				const base = parts[parts.length - 1] ?? rel;
				const next = window.prompt(t('explorer.renamePrompt'), base);
				if (next == null || next.trim() === '' || next.trim() === base) {
					return;
				}
				const r = (await shell.invoke('fs:renameEntry', rel, next.trim())) as {
					ok?: boolean;
					newRel?: string;
					error?: string;
				};
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errRename'));
					return;
				}
				const nr = r.newRel ?? rel;
				const oldTid = tabIdFromPath(rel);
				const newTid = tabIdFromPath(nr);
				setOpenTabs((prev) =>
					prev.map((tab) =>
						normPath(tab.filePath) === normPath(rel)
							? { ...tab, filePath: nr, id: newTid, dirty: tab.dirty }
							: tab
					)
				);
				if (activeTabId === oldTid) {
					setActiveTabId(newTid);
				}
				if (normPath(filePath.trim()) === normPath(rel)) {
					setFilePath(nr);
				}
				await refreshGit();
			},
			delete: async (rel, isDir) => {
				const ok = isDir
					? window.confirm(t('explorer.deleteConfirmDir'))
					: window.confirm(t('explorer.deleteConfirmFile'));
				if (!ok) {
					return;
				}
				const r = (await shell.invoke('fs:removeEntry', rel, isDir)) as {
					ok?: boolean;
					error?: string;
				};
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errDelete'));
					return;
				}
				const norm = normPath(rel);
				const curActive = activeTabId;
				setOpenTabs((prev) => {
					const next = prev.filter((tab) => {
						const p = normPath(tab.filePath);
						if (isDir) {
							const pref = norm.endsWith('/') ? norm : `${norm}/`;
							return p !== norm && !p.startsWith(pref);
						}
						return p !== norm;
					});
					const activeGone = curActive != null && !next.some((tab) => tab.id === curActive);
					if (activeGone) {
						const oldIdx = prev.findIndex((tab) => tab.id === curActive);
						const pick = next[Math.min(oldIdx, Math.max(0, next.length - 1))] ?? null;
						queueMicrotask(() => {
							setActiveTabId(pick?.id ?? null);
							if (pick) {
								setFilePath(pick.filePath);
								void (async () => {
									try {
										const rr = (await shell.invoke('fs:readFile', pick.filePath)) as {
											ok?: boolean;
											content?: string;
										};
										if (rr.ok && rr.content !== undefined) {
											setEditorValue(rr.content);
										}
									} catch {
										setEditorValue('');
									}
								})();
							} else {
								setFilePath('');
								setEditorValue('');
							}
						});
					}
					return next;
				});
				await refreshGit();
			},
		};
	}, [
		shell,
		workspace,
		t,
		openFileInTab,
		appendEditorTerminal,
		setEditorTerminalVisible,
		setLayoutMode,
		setComposerSegments,
		flashComposerAttachErr,
		refreshThreads,
		loadMessages,
		setCurrentId,
		setLastTurnUsage,
		setAwaitingReply,
		setStreaming,
		setStreamingThinking,
		clearStreamingToolPreviewNow,
		resetLiveAgentBlocks,
		setParsedPlan,
		setPlanFilePath,
		setPlanFileRelPath,
		setInlineResendSegments,
		setResendFromUserIndex,
		activeTabId,
		setOpenTabs,
		setActiveTabId,
		setFilePath,
		setEditorValue,
		refreshGit,
		filePath,
		composerRichBottomRef,
		composerRichHeroRef,
		streamStartedAtRef,
		firstTokenAtRef,
	]);
}
