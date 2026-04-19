import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
	newSegmentId,
	type ComposerImageMeta,
	type ComposerSegment,
	type PersistedComposerAttachment,
} from '../composerSegments';
import type { TFunction } from '../i18n';
import type { McpServerConfig, McpServerStatus } from '../mcpTypes';

const LEADING_SKILL_INVOKE_RE = /^\s*\.\/[\w.-]+(?:\s+|$)/;

export type UseComposerAttachmentsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	workspace: string | null;
	t: TFunction;
	flashComposerAttachErr: (msg: string) => void;
	composerRichBottomRef: RefObject<HTMLDivElement | null>;
	composerRichHeroRef: RefObject<HTMLDivElement | null>;
	setComposerSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	mcpServers: McpServerConfig[];
	setMcpServers: Dispatch<SetStateAction<McpServerConfig[]>>;
	setMcpStatuses: Dispatch<SetStateAction<McpServerStatus[]>>;
	plusMenuOpen: boolean;
};

export type UseComposerAttachmentsResult = {
	persistComposerAttachments: (files: File[]) => Promise<PersistedComposerAttachment[]>;
	focusPreferredComposerInput: () => void;
	appendComposerFileReferences: (attachments: PersistedComposerAttachment[]) => void;
	onChatPanelDropFiles: (files: File[]) => Promise<void>;
	pickComposerImagesFromDialog: () => Promise<void>;
	insertComposerSkillInvocation: (slug: string, name?: string) => void;
	refreshComposerMcpMenuState: () => Promise<void>;
	toggleComposerMcpServerEnabled: (id: string, nextEnabled: boolean) => Promise<void>;
};

/**
 * Composer 附件 / 拖入文件 / 截图 / Skill 调用 / MCP 菜单状态 一组。
 *
 * 行为与原 App.tsx 完全一致：
 *  - persistComposerAttachments 使用 4 个 ref（shell/workspace/t/flash）保持 useCallback 引用稳定
 *  - LEADING_SKILL_INVOKE_RE 用于识别旧版纯文本 `./slug ` 调用，并与新版 skill segment 互替
 *  - plusMenu 打开时刷新一次 MCP 服务器列表与状态
 */
export function useComposerAttachments(
	params: UseComposerAttachmentsParams
): UseComposerAttachmentsResult {
	const {
		shell,
		workspace,
		t,
		flashComposerAttachErr,
		composerRichBottomRef,
		composerRichHeroRef,
		setComposerSegments,
		mcpServers,
		setMcpServers,
		setMcpStatuses,
		plusMenuOpen,
	} = params;

	const persistComposerShellRef = useRef(shell);
	const persistComposerWorkspaceRef = useRef(workspace);
	const persistComposerTRef = useRef(t);
	const persistComposerFlashErrRef = useRef(flashComposerAttachErr);
	persistComposerShellRef.current = shell;
	persistComposerWorkspaceRef.current = workspace;
	persistComposerTRef.current = t;
	persistComposerFlashErrRef.current = flashComposerAttachErr;

	const persistComposerAttachments = useCallback(
		async (files: File[]): Promise<PersistedComposerAttachment[]> => {
			const sh = persistComposerShellRef.current;
			if (!sh) {
				return [];
			}
			const ws = persistComposerWorkspaceRef.current;
			const tr = persistComposerTRef.current;
			const flash = persistComposerFlashErrRef.current;
			if (!ws) {
				flash(tr('composer.attach.noWorkspace'));
				return [];
			}
			const out: PersistedComposerAttachment[] = [];
			for (const f of files) {
				const droppedFilePath =
					typeof sh.getPathForFile === 'function' ? sh.getPathForFile(f) : null;
				if (droppedFilePath) {
					const directRef = (await sh.invoke('workspace:resolveDroppedFilePath', {
						fullPath: droppedFilePath,
					})) as { ok?: boolean; relPath?: string; imageMeta?: ComposerImageMeta };
					if (directRef?.ok && typeof directRef.relPath === 'string') {
						out.push(
							directRef.imageMeta
								? { relPath: directRef.relPath, imageMeta: directRef.imageMeta }
								: { relPath: directRef.relPath }
						);
						continue;
					}
				}
				const b64 = await new Promise<string>((resolve, reject) => {
					const r = new FileReader();
					r.onload = () => {
						const d = r.result as string;
						const i = d.indexOf(',');
						resolve(i >= 0 ? d.slice(i + 1) : d);
					};
					r.onerror = () => reject(r.error ?? new Error('read'));
					r.readAsDataURL(f);
				});
				const r = (await sh.invoke('workspace:saveComposerAttachment', {
					base64: b64,
					fileName: f.name,
				})) as {
					ok?: boolean;
					relPath?: string;
					error?: string;
					imageMeta?: ComposerImageMeta;
				};
				if (r?.ok && typeof r.relPath === 'string') {
					out.push(
						r.imageMeta ? { relPath: r.relPath, imageMeta: r.imageMeta } : { relPath: r.relPath }
					);
				} else {
					const err = r?.error;
					if (err === 'too-large') {
						flash(tr('composer.attach.tooLarge'));
					} else if (err === 'no-workspace') {
						flash(tr('composer.attach.noWorkspace'));
					} else {
						flash(tr('composer.attach.saveFailed'));
					}
				}
			}
			return out;
		},
		[]
	);

	const focusPreferredComposerInput = useCallback(() => {
		queueMicrotask(() => {
			if (composerRichBottomRef.current) {
				composerRichBottomRef.current.focus();
				return;
			}
			composerRichHeroRef.current?.focus();
		});
	}, [composerRichBottomRef, composerRichHeroRef]);

	const appendComposerFileReferences = useCallback(
		(attachments: PersistedComposerAttachment[]) => {
			const normalized = attachments
				.map((att) => ({
					relPath: att.relPath.replace(/\\/g, '/').trim(),
					imageMeta: att.imageMeta,
				}))
				.filter((att) => att.relPath.length > 0);
			if (normalized.length === 0) {
				return;
			}
			setComposerSegments((prev) => {
				const next = [...prev];
				const last = next[next.length - 1];
				if (last?.kind === 'text' && last.text.length > 0 && !last.text.endsWith('\n')) {
					next[next.length - 1] = { ...last, text: `${last.text}\n` };
				} else if (last?.kind === 'file') {
					next.push({ id: newSegmentId(), kind: 'text', text: '\n' });
				}
				for (const att of normalized) {
					const seg: ComposerSegment = att.imageMeta
						? { id: newSegmentId(), kind: 'file', path: att.relPath, imageMeta: att.imageMeta }
						: { id: newSegmentId(), kind: 'file', path: att.relPath };
					next.push(seg);
					next.push({ id: newSegmentId(), kind: 'text', text: '\n' });
				}
				return next;
			});
			focusPreferredComposerInput();
		},
		[focusPreferredComposerInput, setComposerSegments]
	);

	const onChatPanelDropFiles = useCallback(
		async (files: File[]) => {
			const attachments = await persistComposerAttachments(files);
			if (attachments.length === 0) {
				return;
			}
			appendComposerFileReferences(attachments);
		},
		[persistComposerAttachments, appendComposerFileReferences]
	);

	const pickComposerImagesFromDialog = useCallback(async () => {
		if (!shell) {
			return;
		}
		const r = (await shell.invoke('workspace:pickComposerImages')) as
			| { ok?: true; attachments?: PersistedComposerAttachment[] }
			| { ok?: false; canceled?: boolean; error?: string; attachments?: PersistedComposerAttachment[] };
		if (r?.ok && Array.isArray(r.attachments) && r.attachments.length > 0) {
			appendComposerFileReferences(r.attachments);
			return;
		}
		if (r && 'error' in r && r.error === 'no-workspace') {
			flashComposerAttachErr(t('composer.attach.noWorkspace'));
		}
	}, [appendComposerFileReferences, flashComposerAttachErr, shell, t]);

	const insertComposerSkillInvocation = useCallback(
		(slug: string, name?: string) => {
			const normalizedSlug = String(slug ?? '')
				.trim()
				.replace(/^\.\//, '');
			if (!normalizedSlug) {
				return;
			}
			const displayName = (name ?? '').trim() || normalizedSlug;
			setComposerSegments((prev) => {
				const skillSeg: ComposerSegment = {
					id: newSegmentId(),
					kind: 'skill',
					slug: normalizedSlug,
					name: displayName,
				};
				const next = [...prev];
				const first = next[0];
				/* 替换已有的 leading skill / 旧版 `./slug ` 文本，避免重复 */
				if (first?.kind === 'skill') {
					next[0] = skillSeg;
					return next;
				}
				if (first?.kind === 'text' && LEADING_SKILL_INVOKE_RE.test(first.text)) {
					const rest = first.text.replace(LEADING_SKILL_INVOKE_RE, '');
					if (rest.length > 0) {
						next[0] = { ...first, text: rest };
						return [skillSeg, ...next];
					}
					next.shift();
					return [skillSeg, ...next];
				}
				return [skillSeg, ...next];
			});
			focusPreferredComposerInput();
		},
		[focusPreferredComposerInput, setComposerSegments]
	);

	const refreshComposerMcpMenuState = useCallback(async () => {
		if (!shell) {
			return;
		}
		const [serversRes, statusesRes] = (await Promise.all([
			shell.invoke('mcp:getServers'),
			shell.invoke('mcp:getStatuses'),
		])) as [
			{ servers?: McpServerConfig[] } | undefined,
			{ statuses?: McpServerStatus[] } | undefined,
		];
		setMcpServers(serversRes?.servers ?? []);
		setMcpStatuses(statusesRes?.statuses ?? []);
	}, [setMcpServers, setMcpStatuses, shell]);

	const toggleComposerMcpServerEnabled = useCallback(
		async (id: string, nextEnabled: boolean) => {
			if (!shell) {
				return;
			}
			const current = mcpServers.find((server) => server.id === id);
			if (!current) {
				return;
			}
			setMcpServers((prev) =>
				prev.map((server) => (server.id === id ? { ...server, enabled: nextEnabled } : server))
			);
			try {
				await shell.invoke('mcp:saveServer', { ...current, enabled: nextEnabled });
			} finally {
				void refreshComposerMcpMenuState();
			}
		},
		[mcpServers, refreshComposerMcpMenuState, setMcpServers, shell]
	);

	useEffect(() => {
		if (!plusMenuOpen) {
			return;
		}
		void refreshComposerMcpMenuState();
	}, [plusMenuOpen, refreshComposerMcpMenuState]);

	return {
		persistComposerAttachments,
		focusPreferredComposerInput,
		appendComposerFileReferences,
		onChatPanelDropFiles,
		pickComposerImagesFromDialog,
		insertComposerSkillInvocation,
		refreshComposerMcpMenuState,
		toggleComposerMcpServerEnabled,
	};
}
