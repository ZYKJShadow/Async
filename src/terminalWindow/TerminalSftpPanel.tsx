import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from '../i18n';
import { FileTypeIcon } from '../fileTypeIcons';
import { IconCloseSmall } from '../icons';
import type { TerminalProfile } from './terminalSettings';
import { TerminalAuthPromptModal } from './TerminalAuthPromptModal';

type AsyncShell = NonNullable<Window['asyncShell']>;

type SftpEntry = {
	name: string;
	fullPath: string;
	type: string;
	size: number;
	modifyTime: number;
	rights?: {
		user?: string;
		group?: string;
		other?: string;
	};
};

type Props = {
	t: TFunction;
	shell: AsyncShell;
	profile: TerminalProfile;
	visible: boolean;
	path?: string;
	onPathChange(path: string): void;
	onClose(): void;
};

type ContextMenuState = {
	entry: SftpEntry;
	x: number;
	y: number;
};

export const TerminalSftpPanel = memo(function TerminalSftpPanel({
	t,
	shell,
	profile,
	visible,
	path,
	onPathChange,
	onClose,
}: Props) {
	const [connectionId, setConnectionId] = useState<string | null>(null);
	const [currentPath, setCurrentPath] = useState(path || '/');
	const [entries, setEntries] = useState<SftpEntry[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const [editingPath, setEditingPath] = useState<string | null>(null);
	const [showFilter, setShowFilter] = useState(false);
	const [filterText, setFilterText] = useState('');
	const [errorText, setErrorText] = useState('');
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const [createDirectoryOpen, setCreateDirectoryOpen] = useState(false);
	const [createDirectoryName, setCreateDirectoryName] = useState('');
	const [busyMessage, setBusyMessage] = useState('');
	const [authPrompt, setAuthPrompt] = useState<{ prompt: string; kind: 'password' | 'passphrase' } | null>(null);
	const [autoConnectAttempted, setAutoConnectAttempted] = useState(false);
	const requestSeqRef = useRef(0);
	const panelRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!path) {
			return;
		}
		setCurrentPath(path);
	}, [path]);

	const disconnect = useCallback(async () => {
		if (!connectionId) {
			return;
		}
		const activeConnectionId = connectionId;
		setConnectionId(null);
		await shell.invoke('term:sftpDisconnect', activeConnectionId).catch(() => {
			/* ignore */
		});
	}, [connectionId, shell]);

	const loadDirectory = useCallback(
		async (targetPath: string, nextConnectionId?: string | null) => {
			const activeConnectionId = nextConnectionId ?? connectionId;
			if (!activeConnectionId) {
				return;
			}
			const normalizedPath = normalizeRemotePath(targetPath);
			const requestSeq = ++requestSeqRef.current;
			setLoading(true);
			setErrorText('');
			setEntries(null);
			try {
				const result = (await shell.invoke('term:sftpList', activeConnectionId, normalizedPath)) as
					| { ok: true; entries: SftpEntry[] }
					| { ok: false; error?: string };
				if (requestSeqRef.current !== requestSeq) {
					return;
				}
				if (!result.ok) {
					throw new Error(result.error || 'SFTP list failed');
				}
				const sortedEntries = [...result.entries].sort((left, right) => {
					const leftRank = left.type === 'd' ? 0 : 1;
					const rightRank = right.type === 'd' ? 0 : 1;
					if (leftRank !== rightRank) {
						return leftRank - rightRank;
					}
					return left.name.localeCompare(right.name);
				});
				setEntries(sortedEntries);
				setCurrentPath(normalizedPath);
				onPathChange(normalizedPath);
				setShowFilter(false);
				setFilterText('');
			} catch (error) {
				setEntries([]);
				setErrorText(error instanceof Error ? error.message : String(error));
			} finally {
				if (requestSeqRef.current === requestSeq) {
					setLoading(false);
				}
			}
		},
		[connectionId, onPathChange, shell]
	);

	const connect = useCallback(
		async (passwordOverride?: string, rememberPassword?: boolean) => {
			setAutoConnectAttempted(true);
			setConnecting(true);
			setErrorText('');
			if (passwordOverride) {
				setAuthPrompt(null);
			}
			try {
				const result = (await shell.invoke('term:sftpConnect', profile, {
					passwordOverride: passwordOverride || null,
				})) as
					| { ok: true; connectionId: string; initialPath: string }
					| { ok: false; error?: string; authRequired?: { kind: 'password' | 'passphrase'; prompt: string } };
				if (!result.ok) {
					if (result.authRequired) {
						setAuthPrompt(result.authRequired);
						return;
					}
					throw new Error(result.error || 'SFTP connect failed');
				}
				if (passwordOverride) {
					await shell
						.invoke(rememberPassword ? 'term:profilePasswordSet' : 'term:profilePasswordCacheSet', profile.id, passwordOverride)
						.catch(() => {
						/* ignore */
						});
				}
				setAuthPrompt(null);
				setConnectionId(result.connectionId);
				setConnecting(false);
				await loadDirectory(path || result.initialPath || '/', result.connectionId);
			} catch (error) {
				setErrorText(error instanceof Error ? error.message : String(error));
			} finally {
				setConnecting(false);
			}
		},
		[loadDirectory, path, profile, shell]
	);

	useEffect(() => {
		if (!visible) {
			setContextMenu(null);
			setAuthPrompt(null);
			setAutoConnectAttempted(false);
			void disconnect();
			return;
		}
		if (!connectionId && !connecting && !authPrompt && !autoConnectAttempted) {
			void connect();
		}
	}, [authPrompt, autoConnectAttempted, connect, connecting, connectionId, disconnect, visible]);

	useEffect(() => {
		if (!visible) {
			return;
		}
		const onPointerDown = (event: MouseEvent) => {
			if (!panelRef.current?.contains(event.target as Node)) {
				setContextMenu(null);
			}
		};
		window.addEventListener('mousedown', onPointerDown);
		return () => window.removeEventListener('mousedown', onPointerDown);
	}, [visible]);

	useEffect(() => () => void disconnect(), [disconnect]);

	const filteredEntries = useMemo(() => {
		if (!entries) {
			return [];
		}
		const query = filterText.trim().toLowerCase();
		if (!showFilter || !query) {
			return entries;
		}
		return entries.filter((entry) => entry.name.toLowerCase().includes(query));
	}, [entries, filterText, showFilter]);

	const pathSegments = useMemo(() => buildPathSegments(currentPath), [currentPath]);
	const hasFilterQuery = showFilter && filterText.trim().length > 0;
	const connectionBadgeLabel = connecting
		? t('app.universalTerminalSftpConnecting')
		: loading
			? t('app.universalTerminalSftpLoading')
			: busyMessage
				? t('app.universalTerminalSftpWorking')
				: t('app.universalTerminalSftpConnected');
	const entrySummaryLabel =
		entries === null
			? t('app.universalTerminalSftpEntrySummaryPending')
			: hasFilterQuery
				? t('app.universalTerminalSftpFilteredSummary', {
						shown: String(filteredEntries.length),
						total: String(entries.length),
					})
				: t('app.universalTerminalSftpEntrySummary', {
						count: String(entries.length),
					});
	const profileSummary =
		profile.kind === 'ssh'
			? [profile.sshUser, profile.sshHost].filter(Boolean).join('@') || profile.name
			: profile.name;

	const navigate = useCallback(
		async (targetPath: string) => {
			if (!connectionId) {
				return;
			}
			setContextMenu(null);
			await loadDirectory(targetPath, connectionId);
		},
		[connectionId, loadDirectory]
	);

	const downloadFileEntry = useCallback(
		async (entry: SftpEntry) => {
			if (!connectionId) {
				return;
			}
			const picked = (await shell.invoke('term:pickSavePath', {
				title: t('app.universalTerminalSftpDownload'),
				defaultPath: entry.name,
			})) as { ok?: boolean; canceled?: boolean; path?: string };
			if (!picked?.ok || !picked.path) {
				return;
			}
			setBusyMessage(entry.fullPath);
			try {
				const result = (await shell.invoke('term:sftpDownloadFile', connectionId, entry.fullPath, picked.path)) as {
					ok?: boolean;
					error?: string;
				};
				if (!result?.ok) {
					throw new Error(result?.error || 'download failed');
				}
			} catch (error) {
				setErrorText(error instanceof Error ? error.message : String(error));
			} finally {
				setBusyMessage('');
			}
		},
		[connectionId, shell, t]
	);

	const downloadDirectoryEntry = useCallback(
		async (entry: SftpEntry) => {
			if (!connectionId) {
				return;
			}
			const picked = (await shell.invoke('term:pickPath', {
				kind: 'directory',
				title: t('app.universalTerminalSftpDownloadDirectory'),
			})) as { ok?: boolean; path?: string };
			if (!picked?.ok || !picked.path) {
				return;
			}
			setBusyMessage(entry.fullPath);
			try {
				const result = (await shell.invoke(
					'term:sftpDownloadDirectory',
					connectionId,
					entry.fullPath,
					joinLocalPath(picked.path, entry.name)
				)) as { ok?: boolean; error?: string };
				if (!result?.ok) {
					throw new Error(result?.error || 'download directory failed');
				}
			} catch (error) {
				setErrorText(error instanceof Error ? error.message : String(error));
			} finally {
				setBusyMessage('');
			}
		},
		[connectionId, shell, t]
	);

	const openEntry = useCallback(
		async (entry: SftpEntry) => {
			if (!connectionId) {
				return;
			}
			if (entry.type === 'd') {
				await navigate(entry.fullPath);
				return;
			}
			if (entry.type === 'l') {
				try {
					const realPathResult = (await shell.invoke('term:sftpRealPath', connectionId, entry.fullPath)) as
						| { ok: true; path: string }
						| { ok: false; error?: string };
					if (!realPathResult.ok) {
						throw new Error(realPathResult.error || 'resolve symlink failed');
					}
					const statResult = (await shell.invoke('term:sftpStat', connectionId, realPathResult.path)) as
						| { ok: true; entry: SftpEntry }
						| { ok: false; error?: string };
					if (!statResult.ok) {
						throw new Error(statResult.error || 'stat failed');
					}
					if (statResult.entry.type === 'd') {
						await navigate(realPathResult.path);
						return;
					}
				} catch (error) {
					setErrorText(error instanceof Error ? error.message : String(error));
					return;
				}
			}
			await downloadFileEntry(entry);
		},
		[connectionId, downloadFileEntry, navigate, shell]
	);

	const uploadFiles = useCallback(async () => {
		if (!connectionId) {
			return;
		}
		const picked = (await shell.invoke('term:pickPath', {
			kind: 'file',
			multi: true,
			title: t('app.universalTerminalSftpUploadFiles'),
		})) as { ok?: boolean; paths?: string[] };
		if (!picked?.ok || !Array.isArray(picked.paths) || picked.paths.length === 0) {
			return;
		}
		setBusyMessage(t('app.universalTerminalSftpUploadFiles'));
		try {
			for (const localPath of picked.paths) {
				const result = (await shell.invoke(
					'term:sftpUploadFile',
					connectionId,
					localPath,
					joinRemotePath(currentPath, basenameLocalPath(localPath))
				)) as { ok?: boolean; error?: string };
				if (!result?.ok) {
					throw new Error(result?.error || 'upload failed');
				}
			}
			await loadDirectory(currentPath, connectionId);
		} catch (error) {
			setErrorText(error instanceof Error ? error.message : String(error));
		} finally {
			setBusyMessage('');
		}
	}, [connectionId, currentPath, loadDirectory, shell, t]);

	const uploadFolder = useCallback(async () => {
		if (!connectionId) {
			return;
		}
		const picked = (await shell.invoke('term:pickPath', {
			kind: 'directory',
			title: t('app.universalTerminalSftpUploadFolder'),
		})) as { ok?: boolean; path?: string };
		if (!picked?.ok || !picked.path) {
			return;
		}
		setBusyMessage(t('app.universalTerminalSftpUploadFolder'));
		try {
			const result = (await shell.invoke('term:sftpUploadDirectory', connectionId, picked.path, currentPath)) as {
				ok?: boolean;
				error?: string;
			};
			if (!result?.ok) {
				throw new Error(result?.error || 'upload directory failed');
			}
			await loadDirectory(currentPath, connectionId);
		} catch (error) {
			setErrorText(error instanceof Error ? error.message : String(error));
		} finally {
			setBusyMessage('');
		}
	}, [connectionId, currentPath, loadDirectory, shell, t]);

	const createDirectory = useCallback(async () => {
		if (!connectionId || !createDirectoryName.trim()) {
			return;
		}
		setBusyMessage(createDirectoryName.trim());
		try {
			const result = (await shell.invoke(
				'term:sftpMkdir',
				connectionId,
				joinRemotePath(currentPath, createDirectoryName.trim())
			)) as { ok?: boolean; error?: string };
			if (!result?.ok) {
				throw new Error(result?.error || 'mkdir failed');
			}
			setCreateDirectoryOpen(false);
			setCreateDirectoryName('');
			await loadDirectory(currentPath, connectionId);
		} catch (error) {
			setErrorText(error instanceof Error ? error.message : String(error));
		} finally {
			setBusyMessage('');
		}
	}, [connectionId, createDirectoryName, currentPath, loadDirectory, shell]);

	const deleteEntry = useCallback(
		async (entry: SftpEntry) => {
			if (!connectionId) {
				return;
			}
			setBusyMessage(entry.fullPath);
			try {
				const result = (await shell.invoke('term:sftpDelete', connectionId, entry.fullPath, entry.type === 'd')) as {
					ok?: boolean;
					error?: string;
				};
				if (!result?.ok) {
					throw new Error(result?.error || 'delete failed');
				}
				await loadDirectory(currentPath, connectionId);
			} catch (error) {
				setErrorText(error instanceof Error ? error.message : String(error));
			} finally {
				setBusyMessage('');
			}
		},
		[connectionId, currentPath, loadDirectory, shell]
	);

	const copyFullPath = useCallback(
		async (entry: SftpEntry) => {
			await shell.invoke('clipboard:writeText', entry.fullPath).catch(() => {
				/* ignore */
			});
		},
		[shell]
	);

	const editLocally = useCallback(
		async (entry: SftpEntry) => {
			if (!connectionId) {
				return;
			}
			setBusyMessage(entry.fullPath);
			try {
				const result = (await shell.invoke('term:sftpEditLocal', connectionId, entry.fullPath, entryToMode(entry))) as {
					ok?: boolean;
					error?: string;
				};
				if (!result?.ok) {
					throw new Error(result?.error || 'edit locally failed');
				}
			} catch (error) {
				setErrorText(error instanceof Error ? error.message : String(error));
			} finally {
				setBusyMessage('');
			}
		},
		[connectionId, shell]
	);

	if (!visible) {
		return null;
	}

	return (
		<div className="ref-uterm-sftp-panel" ref={panelRef}>
			<div className="ref-uterm-sftp-head">
				<div className="ref-uterm-sftp-head-top">
					<div className="ref-uterm-sftp-head-copy">
						<div className="ref-uterm-sftp-head-kicker">SFTP</div>
						<div className="ref-uterm-sftp-head-title-row">
							<h3 className="ref-uterm-sftp-head-title">{t('app.universalTerminalSftpTitle')}</h3>
							<div className="ref-uterm-sftp-head-badges">
								<span
									className={`ref-uterm-sftp-head-badge ${
										connecting || loading || busyMessage ? 'is-busy' : 'is-live'
									}`}
								>
									{connectionBadgeLabel}
								</span>
								<span className="ref-uterm-sftp-head-badge">{entrySummaryLabel}</span>
							</div>
						</div>
						<div className="ref-uterm-sftp-head-subtitle">{profileSummary}</div>
					</div>

					<div className="ref-uterm-sftp-actions">
						<button
							type="button"
							className={`ref-uterm-sftp-head-btn ${showFilter ? 'is-active' : ''}`}
							onClick={() => {
								if (showFilter) {
									setShowFilter(false);
									setFilterText('');
									return;
								}
								setShowFilter(true);
							}}
						>
							<SftpHeaderIcon kind="filter" className="ref-uterm-sftp-head-btn-icon" />
							<span>{t('app.universalTerminalSftpFilter')}</span>
						</button>
						<button type="button" className="ref-uterm-sftp-head-btn" onClick={() => setCreateDirectoryOpen(true)}>
							<SftpHeaderIcon kind="folder-plus" className="ref-uterm-sftp-head-btn-icon" />
							<span>{t('app.universalTerminalSftpCreateDirectory')}</span>
						</button>
						<button
							type="button"
							className="ref-uterm-sftp-head-btn ref-uterm-sftp-head-btn--primary"
							onClick={() => void uploadFiles()}
						>
							<SftpHeaderIcon kind="upload" className="ref-uterm-sftp-head-btn-icon" />
							<span>{t('app.universalTerminalSftpUploadFiles')}</span>
						</button>
						<button type="button" className="ref-uterm-sftp-head-btn" onClick={() => void uploadFolder()}>
							<SftpHeaderIcon kind="upload" className="ref-uterm-sftp-head-btn-icon" />
							<span>{t('app.universalTerminalSftpUploadFolder')}</span>
						</button>
						<button type="button" className="ref-uterm-sftp-close" onClick={onClose} aria-label={t('common.close')}>
							<IconCloseSmall className="ref-uterm-sftp-head-btn-icon" />
						</button>
					</div>
				</div>

				<div className="ref-uterm-sftp-head-bottom">
					<div className="ref-uterm-sftp-head-path">
						<div className="ref-uterm-sftp-head-path-label">{t('app.universalTerminalSftpLocation')}</div>
						{editingPath !== null ? (
							<input
								type="text"
								className="ref-uterm-sftp-path-input ref-uterm-sftp-path-input--head"
								value={editingPath}
								autoFocus
								onChange={(event) => setEditingPath(event.target.value)}
								onBlur={() => setEditingPath(null)}
								onKeyDown={(event) => {
									if (event.key === 'Escape') {
										setEditingPath(null);
									}
									if (event.key === 'Enter') {
										void navigate(editingPath);
										setEditingPath(null);
									}
								}}
							/>
						) : (
							<div className="ref-uterm-sftp-breadcrumb" onDoubleClick={() => setEditingPath(currentPath)}>
								<button type="button" className="ref-uterm-sftp-crumb" onClick={() => void navigate('/')}>
									SFTP
								</button>
								{pathSegments.map((segment) => (
									<button
										key={segment.path}
										type="button"
										className="ref-uterm-sftp-crumb"
										onClick={() => void navigate(segment.path)}
									>
										{segment.name}
									</button>
								))}
							</div>
						)}
					</div>
					{editingPath === null ? (
						<button
							type="button"
							className="ref-uterm-sftp-head-btn ref-uterm-sftp-head-btn--secondary"
							onClick={() => setEditingPath(currentPath)}
						>
							<span>{t('app.universalTerminalSftpEditPath')}</span>
						</button>
					) : null}
				</div>

				{showFilter ? (
					<div className="ref-uterm-sftp-filterbar">
						<div className="ref-uterm-sftp-filter-group">
							<input
								type="text"
								className="ref-uterm-sftp-filter-input"
								value={filterText}
								autoFocus={editingPath === null}
								placeholder={t('app.universalTerminalSftpFilterPlaceholder')}
								onChange={(event) => setFilterText(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Escape') {
										setShowFilter(false);
										setFilterText('');
									}
								}}
							/>
							<button
								type="button"
								className="ref-uterm-sftp-filter-clear"
								onClick={() => {
									setShowFilter(false);
									setFilterText('');
								}}
							>
								<IconCloseSmall className="ref-uterm-sftp-head-btn-icon" />
							</button>
						</div>
					</div>
				) : null}
			</div>

			<div className="ref-uterm-sftp-body">
				{errorText ? <div className="ref-uterm-sftp-alert">{errorText}</div> : null}
				{connecting ? <div className="ref-uterm-sftp-state">{t('app.universalTerminalSftpConnecting')}</div> : null}
				{!connecting && loading ? <div className="ref-uterm-sftp-state">{t('app.universalTerminalSftpLoading')}</div> : null}
				{!connecting && !loading && entries ? (
					<div className="ref-uterm-sftp-list">
						{currentPath !== '/' && (!showFilter || filterText.trim() === '') ? (
							<button type="button" className="ref-uterm-sftp-row is-nav" onClick={() => void navigate(dirnameRemote(currentPath))}>
								<span className="ref-uterm-sftp-row-icon">
									<SftpEntryIcon type=".." />
								</span>
								<span className="ref-uterm-sftp-row-name">{t('app.universalTerminalSftpGoUp')}</span>
								<span className="ref-uterm-sftp-row-spacer" />
							</button>
						) : null}
						{filteredEntries.map((entry) => (
							<button
								key={entry.fullPath}
								type="button"
								className="ref-uterm-sftp-row"
								onClick={() => void openEntry(entry)}
								onContextMenu={(event) => {
									event.preventDefault();
									setContextMenu({ entry, x: event.clientX, y: event.clientY });
								}}
							>
								<span className="ref-uterm-sftp-row-icon">
									<SftpEntryIcon type={entry.type} name={entry.name} />
								</span>
								<span className="ref-uterm-sftp-row-name" title={entry.name}>
									{entry.name}
								</span>
								<span className="ref-uterm-sftp-row-spacer" />
								<span className="ref-uterm-sftp-row-size">{entry.type === 'd' ? '' : formatFileSize(entry.size)}</span>
								<span className="ref-uterm-sftp-row-date">{formatFileDate(entry.modifyTime)}</span>
								<span className="ref-uterm-sftp-row-mode">{formatMode(entry)}</span>
							</button>
						))}
						{filteredEntries.length === 0 && showFilter && filterText.trim() ? (
							<div className="ref-uterm-sftp-empty">
								{t('app.universalTerminalSftpNoMatches', { filterText })}
							</div>
						) : null}
					</div>
				) : null}
			</div>

			{contextMenu ? (
				<div
					className="ref-uterm-dropdown ref-uterm-sftp-context"
					style={{
						left: Math.max(8, Math.min(contextMenu.x - 12, window.innerWidth - 240)),
						top: Math.max(8, Math.min(contextMenu.y - 12, window.innerHeight - 240)),
						right: 'auto',
					}}
				>
					<button
						type="button"
						className="ref-uterm-dropdown-item"
						onClick={() => {
							setContextMenu(null);
							setCreateDirectoryOpen(true);
						}}
					>
						{t('app.universalTerminalSftpCreateDirectory')}
					</button>
					<button
						type="button"
						className="ref-uterm-dropdown-item"
						onClick={() => {
							setContextMenu(null);
							void (contextMenu.entry.type === 'd'
								? downloadDirectoryEntry(contextMenu.entry)
								: downloadFileEntry(contextMenu.entry));
						}}
					>
						{contextMenu.entry.type === 'd'
							? t('app.universalTerminalSftpDownloadDirectory')
							: t('app.universalTerminalSftpDownload')}
					</button>
					<button
						type="button"
						className="ref-uterm-dropdown-item"
						onClick={() => {
							setContextMenu(null);
							void copyFullPath(contextMenu.entry);
						}}
					>
						{t('app.universalTerminalSftpCopyFullPath')}
					</button>
					{contextMenu.entry.type !== 'd' ? (
						<button
							type="button"
							className="ref-uterm-dropdown-item"
							onClick={() => {
								setContextMenu(null);
								void editLocally(contextMenu.entry);
							}}
						>
							{t('app.universalTerminalSftpEditLocal')}
						</button>
					) : null}
					<div className="ref-uterm-dropdown-sep" />
					<button
						type="button"
						className="ref-uterm-dropdown-item ref-uterm-dropdown-item--danger"
						onClick={() => {
							setContextMenu(null);
							if (!window.confirm(t('app.universalTerminalSftpDeleteConfirm', { fullPath: contextMenu.entry.fullPath }))) {
								return;
							}
							void deleteEntry(contextMenu.entry);
						}}
					>
						{t('common.delete')}
					</button>
				</div>
			) : null}

			{createDirectoryOpen ? (
				<div className="modal-backdrop" onClick={() => setCreateDirectoryOpen(false)}>
					<div className="modal ref-uterm-sftp-modal" onClick={(event) => event.stopPropagation()}>
						<h2>{t('app.universalTerminalSftpCreateDirectoryTitle')}</h2>
						<label className="field">
							<span>{t('app.universalTerminalSftpCreateDirectoryName')}</span>
							<input
								type="text"
								value={createDirectoryName}
								autoFocus
								onChange={(event) => setCreateDirectoryName(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter' && createDirectoryName.trim()) {
										void createDirectory();
									}
								}}
							/>
						</label>
						<div className="modal-actions">
							<button type="button" className="ref-uterm-settings-secondary-btn" onClick={() => setCreateDirectoryOpen(false)}>
								{t('common.cancel')}
							</button>
							<button type="button" className="ref-uterm-settings-primary-btn" onClick={() => void createDirectory()}>
								{t('app.universalTerminalSftpCreateAction')}
							</button>
						</div>
					</div>
				</div>
			) : null}

			{busyMessage ? (
				<div className="modal-backdrop ref-uterm-sftp-progress">
					<div className="modal ref-uterm-sftp-modal">
						<h2>{t('app.universalTerminalSftpWorking')}</h2>
						<div className="ref-uterm-sftp-progress-copy">{busyMessage}</div>
					</div>
				</div>
			) : null}

			{authPrompt ? (
				<TerminalAuthPromptModal
					t={t}
					kind={authPrompt.kind}
					prompt={authPrompt.prompt}
					sessionTitle="SFTP"
					profileName={profile.name || `${profile.sshUser}@${profile.sshHost}`}
					onCancel={() => {
						setAuthPrompt(null);
						onClose();
					}}
					onSubmit={(value, remember) => {
						void connect(value, remember);
					}}
				/>
			) : null}
		</div>
	);
});

function buildPathSegments(currentPath: string): Array<{ name: string; path: string }> {
	const normalized = normalizeRemotePath(currentPath);
	if (normalized === '/') {
		return [];
	}
	const segments = normalized.split('/').filter(Boolean);
	return segments.map((segment, index) => ({
		name: segment,
		path: `/${segments.slice(0, index + 1).join('/')}`,
	}));
}

function normalizeRemotePath(remotePath: string): string {
	const raw = String(remotePath || '').trim();
	if (!raw || raw === '.') {
		return '/';
	}
	const input = raw.replace(/\\/g, '/');
	const absolute = input.startsWith('/') ? input : `/${input}`;
	const segments = absolute.split('/');
	const next: string[] = [];
	for (const segment of segments) {
		if (!segment || segment === '.') {
			continue;
		}
		if (segment === '..') {
			next.pop();
			continue;
		}
		next.push(segment);
	}
	return `/${next.join('/')}` || '/';
}

function joinRemotePath(basePath: string, name: string): string {
	return normalizeRemotePath(`${normalizeRemotePath(basePath)}/${String(name || '').replace(/^\/+/, '')}`);
}

function dirnameRemote(remotePath: string): string {
	const normalized = normalizeRemotePath(remotePath);
	if (normalized === '/') {
		return '/';
	}
	const parts = normalized.split('/').filter(Boolean);
	parts.pop();
	return parts.length ? `/${parts.join('/')}` : '/';
}

function formatFileSize(size: number): string {
	if (!Number.isFinite(size) || size < 0) {
		return '';
	}
	if (size < 1024) {
		return `${size} B`;
	}
	if (size < 1024 * 1024) {
		return `${(size / 1024).toFixed(1)} KB`;
	}
	if (size < 1024 * 1024 * 1024) {
		return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatFileDate(value: number): string {
	if (!value) {
		return '';
	}
	try {
		return new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		}).format(new Date(value));
	} catch {
		return '';
	}
}

function formatMode(entry: SftpEntry): string {
	const prefix = entry.type === 'd' ? 'd' : entry.type === 'l' ? 'l' : '-';
	const rights = entry.rights;
	if (!rights) {
		return '';
	}
	return `${prefix}${rights.user || '---'}${rights.group || '---'}${rights.other || '---'}`;
}

function basenameLocalPath(localPath: string): string {
	return String(localPath || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
}

function joinLocalPath(basePath: string, name: string): string {
	return `${basePath.replace(/[\\/]+$/, '')}${basePath.includes('\\') ? '\\' : '/'}${name}`;
}

function entryToMode(_entry: SftpEntry): number | null {
	return null;
}

function SftpEntryIcon({ type, name = '' }: { type: string; name?: string }) {
	if (type === 'd') {
		return <FileTypeIcon fileName={name || 'folder'} isDirectory className="ref-uterm-sftp-fileicon" />;
	}
	if (type === 'l') {
		return (
			<SftpGlyph
				d="M10.5 13.5 8 16a3 3 0 1 1-4.24-4.24l2.5-2.5M13.5 10.5 16 8a3 3 0 0 1 4.24 4.24l-2.5 2.5M8 12h8"
				className="ref-uterm-sftp-fileicon ref-uterm-sftp-fileicon--link"
				open
			/>
		);
	}
	if (type === '..') {
		return <SftpGlyph d="M12 19V5M5 12l7-7 7 7" className="ref-uterm-sftp-fileicon ref-uterm-sftp-fileicon--up" open />;
	}
	return <FileTypeIcon fileName={name || 'file'} isDirectory={false} className="ref-uterm-sftp-fileicon" />;
}

function SftpHeaderIcon({ kind, className }: { kind: 'filter' | 'folder-plus' | 'upload'; className?: string }) {
	if (kind === 'filter') {
		return <SftpGlyph d="M4 6h16M7 12h10M10 18h4" className={className} open />;
	}
	if (kind === 'folder-plus') {
		return <SftpGlyph d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z M12 11.5v5M9.5 14h5" className={className} open />;
	}
	return <SftpGlyph d="M12 19V7M7.5 11.5 12 7l4.5 4.5M5 19h14" className={className} open />;
}

function SftpGlyph({ d, open = false, className }: { d: string; open?: boolean; className?: string }) {
	return (
		<svg className={className || 'ref-uterm-sftp-svg'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
			<path d={d} strokeLinecap="round" strokeLinejoin="round" fill={open ? 'none' : 'currentColor'} />
		</svg>
	);
}
