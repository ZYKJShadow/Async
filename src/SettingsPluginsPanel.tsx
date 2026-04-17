import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PluginInstallScope, PluginPanelState } from './pluginMarketplaceTypes';
import type { PluginRuntimeState } from './pluginRuntimeTypes';
import { useI18n } from './i18n';
import { VoidSelect } from './VoidSelect';

type ShellApi = NonNullable<Window['asyncShell']>;

type Props = {
	shell: ShellApi | null;
	workspaceOpen: boolean;
};

type BannerKind = 'success' | 'error' | 'info';
type ToastState = { key: number; kind: BannerKind; text: string } | null;

function IconRefresh({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconTrash({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" strokeLinecap="round" />
		</svg>
	);
}

function IconFolder({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M3 7h6l2 2h10v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconFolderPlus({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M3 7h6l2 2h10v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M12 12v5M9.5 14.5h5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconPlug({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 22v-6M9 8V2M15 8V2M12 16a4 4 0 00-4-4V8h8v4a4 4 0 00-4 4z" strokeLinecap="round" />
		</svg>
	);
}

function IconChevron({ open, className }: { open: boolean; className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path
				d={open ? 'M6 9l6 6 6-6' : 'M9 18l6-6-6-6'}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function Badge({ text, tone = 'default' }: { text: string; tone?: 'default' | 'success' | 'warn' }) {
	return <span className={`ref-settings-plugins-badge ref-settings-plugins-badge--${tone}`}>{text}</span>;
}

export function SettingsPluginsPanel({ shell, workspaceOpen }: Props) {
	const { t } = useI18n();
	const [state, setState] = useState<PluginPanelState | null>(null);
	const [runtimeState, setRuntimeState] = useState<PluginRuntimeState | null>(null);
	const [loading, setLoading] = useState(true);
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const [sourceInput, setSourceInput] = useState('');
	const [search, setSearch] = useState('');
	const deferredSearch = useDeferredValue(search);
	const [toast, setToast] = useState<ToastState>(null);
	const [expandedByMarketplace, setExpandedByMarketplace] = useState<Record<string, boolean>>({});
	const [installScope, setInstallScope] = useState<PluginInstallScope>('user');
	const toastTimerRef = useRef<number | null>(null);

	useEffect(() => {
		if (!workspaceOpen && installScope === 'project') {
			setInstallScope('user');
		}
	}, [workspaceOpen, installScope]);

	const clearToastTimer = useCallback(() => {
		if (toastTimerRef.current !== null) {
			window.clearTimeout(toastTimerRef.current);
			toastTimerRef.current = null;
		}
	}, []);

	const setToastText = useCallback(
		(kind: BannerKind, text: string) => {
			clearToastTimer();
			if (!text.trim()) {
				setToast(null);
				return;
			}
			setToast((prev) => ({
				key: (prev?.key ?? 0) + 1,
				kind,
				text,
			}));
			toastTimerRef.current = window.setTimeout(() => {
				setToast(null);
				toastTimerRef.current = null;
			}, kind === 'error' ? 4200 : 2600);
		},
		[clearToastTimer]
	);

	const loadState = useCallback(async () => {
		if (!shell) {
			setState(null);
			setRuntimeState(null);
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const [next, runtime] = (await Promise.all([
				shell.invoke('plugins:getState'),
				shell.invoke('plugins:getRuntimeState'),
			])) as [PluginPanelState, PluginRuntimeState];
			setState(next);
			setRuntimeState(runtime);
			setExpandedByMarketplace((prev) => {
				const nextMap = { ...prev };
				for (const marketplace of next.marketplaces) {
					if (nextMap[marketplace.name] == null) {
						nextMap[marketplace.name] = true;
					}
				}
				return nextMap;
			});
		} catch (error) {
			setToastText('error', error instanceof Error ? error.message : t('settings.plugins.loadFailed'));
		} finally {
			setLoading(false);
		}
	}, [setToastText, shell, t]);

	useEffect(() => {
		void loadState();
	}, [loadState]);

	useEffect(() => {
		if (!shell?.subscribePluginsChanged) {
			return;
		}
		return shell.subscribePluginsChanged(() => {
			void loadState();
		});
	}, [loadState, shell]);

	useEffect(() => () => clearToastTimer(), [clearToastTimer]);

	const sourceExamples = useMemo(
		() => ['anthropics/claude-code-plugins', 'https://example.com/marketplace.json', './plugins-marketplace'],
		[]
	);

	const searchQuery = deferredSearch.trim().toLowerCase();

	const installedPlugins = useMemo(() => {
		if (!state) {
			return [];
		}
		if (!searchQuery) {
			return state.installed;
		}
		return state.installed.filter((item) => {
			const haystack = [item.pluginName, item.marketplaceName ?? '', item.description ?? '', item.scope].join(' ').toLowerCase();
			return haystack.includes(searchQuery);
		});
	}, [state, searchQuery]);

	const marketplaces = useMemo(() => {
		if (!state) {
			return [];
		}
		if (!searchQuery) {
			return state.marketplaces;
		}
		return state.marketplaces
			.map((marketplace) => ({
				...marketplace,
				plugins: marketplace.plugins.filter((plugin) => {
					const haystack = [
						marketplace.name,
						marketplace.description ?? '',
						plugin.name,
						plugin.description ?? '',
						plugin.category ?? '',
						plugin.tags.join(' '),
						plugin.sourceKind,
					]
						.join(' ')
						.toLowerCase();
					return haystack.includes(searchQuery);
				}),
			}))
			.filter((marketplace) => marketplace.plugins.length > 0 || marketplace.name.toLowerCase().includes(searchQuery));
	}, [state, searchQuery]);

	const runtimeByInstallDir = useMemo(() => {
		const map = new Map<
			string,
			{
				skills: number;
				commands: number;
				mcpServers: number;
			}
		>();
		for (const plugin of runtimeState?.plugins ?? []) {
			map.set(plugin.installDir, {
				skills: plugin.skills.length,
				commands: plugin.commands.length,
				mcpServers: plugin.mcpServers.length,
			});
		}
		return map;
	}, [runtimeState]);

	const invokePluginAction = useCallback(
		async (
			busy: string,
			channel: string,
			payload: Record<string, unknown>,
			successText?: string
		) => {
			if (!shell) {
				return false;
			}
			setBusyKey(busy);
			try {
				const result = (await shell.invoke(channel, payload)) as { ok?: boolean; error?: string };
				if (!result?.ok) {
					setToastText('error', result?.error || t('settings.plugins.operationFailed'));
					return false;
				}
				if (successText) {
					setToastText('success', successText);
				}
				await loadState();
				return true;
			} catch (error) {
				setToastText('error', error instanceof Error ? error.message : t('settings.plugins.operationFailed'));
				return false;
			} finally {
				setBusyKey(null);
			}
		},
		[loadState, shell, t, setToastText]
	);

	const handleAddMarketplace = useCallback(async () => {
		const input = sourceInput.trim();
		if (!input) {
			setToastText('error', t('settings.plugins.emptySource'));
			return;
		}
		const ok = await invokePluginAction(
			'add-marketplace',
			'plugins:addMarketplace',
			{ input },
			t('settings.plugins.marketplaceAdded')
		);
		if (ok) {
			setSourceInput('');
		}
	}, [invokePluginAction, setToastText, sourceInput, t]);

	const handleRefreshMarketplace = useCallback(
		async (name: string) => {
			await invokePluginAction(
				`refresh:${name}`,
				'plugins:refreshMarketplace',
				{ name },
				t('settings.plugins.marketplaceRefreshed')
			);
		},
		[invokePluginAction, t]
	);

	const handleRefreshAll = useCallback(async () => {
		if (!state || !shell) {
			return;
		}
		const refreshable = state.marketplaces.filter((item) => item.canRefresh);
		if (refreshable.length === 0) {
			setToastText('info', t('settings.plugins.noRefreshableMarketplaces'));
			return;
		}
		setBusyKey('refresh-all');
		try {
			for (const marketplace of refreshable) {
				const result = (await shell.invoke('plugins:refreshMarketplace', { name: marketplace.name })) as {
					ok?: boolean;
					error?: string;
				};
				if (!result?.ok) {
					setToastText('error', result?.error || t('settings.plugins.operationFailed'));
					return;
				}
			}
			setToastText('success', t('settings.plugins.marketplaceRefreshedAll'));
			await loadState();
		} catch (error) {
			setToastText('error', error instanceof Error ? error.message : t('settings.plugins.operationFailed'));
		} finally {
			setBusyKey(null);
		}
	}, [loadState, setToastText, shell, state, t]);

	const handleRemoveMarketplace = useCallback(
		async (name: string) => {
			if (!window.confirm(t('settings.plugins.confirmRemoveMarketplace', { name }))) {
				return;
			}
			await invokePluginAction(
				`remove:${name}`,
				'plugins:removeMarketplace',
				{ name },
				t('settings.plugins.marketplaceRemoved')
			);
		},
		[invokePluginAction, t]
	);

	const handleInstall = useCallback(
		async (marketplaceName: string, pluginName: string) => {
			await invokePluginAction(
				`install:${marketplaceName}:${pluginName}:${installScope}`,
				'plugins:install',
				{ marketplaceName, pluginName, scope: installScope },
				t('settings.plugins.pluginInstalled')
			);
		},
		[installScope, invokePluginAction, t]
	);

	const handleToggleEnabled = useCallback(
		async (installDir: string, enabled: boolean) => {
			await invokePluginAction(
				`toggle:${installDir}`,
				'plugins:setEnabled',
				{ installDir, enabled },
				enabled ? t('settings.plugins.pluginEnabled') : t('settings.plugins.pluginDisabled')
			);
		},
		[invokePluginAction, t]
	);

	const handleUninstall = useCallback(
		async (installDir: string, pluginName: string) => {
			if (!window.confirm(t('settings.plugins.confirmUninstallPlugin', { name: pluginName }))) {
				return;
			}
			await invokePluginAction(
				`uninstall:${installDir}`,
				'plugins:uninstall',
				{ installDir },
				t('settings.plugins.pluginUninstalled')
			);
		},
		[invokePluginAction, t]
	);

	const handlePickUserDirectory = useCallback(async () => {
		if (!shell) {
			return;
		}
		setBusyKey('pick-user-dir');
		try {
			const picked = (await shell.invoke('plugins:pickUserDirectory')) as { ok?: boolean; path?: string };
			if (!picked?.ok || !picked.path) {
				return;
			}
			await invokePluginAction(
				'set-user-dir',
				'plugins:setUserDirectory',
				{ path: picked.path },
				t('settings.plugins.userDirectoryUpdated')
			);
		} finally {
			setBusyKey(null);
		}
	}, [invokePluginAction, shell, t]);

	const handleResetUserDirectory = useCallback(async () => {
		await invokePluginAction(
			'reset-user-dir',
			'plugins:setUserDirectory',
			{ reset: true },
			t('settings.plugins.userDirectoryReset')
		);
	}, [invokePluginAction, t]);

	const revealPath = useCallback(
		(targetPath: string) => {
			if (!shell || !targetPath.trim()) {
				return;
			}
			void shell.invoke('shell:revealAbsolutePath', targetPath.trim());
		},
		[shell]
	);

	if (!shell) {
		return (
			<div className="ref-settings-panel ref-settings-panel--plugins">
				<p className="ref-settings-lead">{t('settings.plugins.shellUnavailable')}</p>
			</div>
		);
	}

	if (loading && !state) {
		return (
			<div className="ref-settings-panel ref-settings-panel--plugins">
				<p className="ref-settings-proxy-hint">{t('common.loading')}</p>
			</div>
		);
	}

	return (
		<div className="ref-settings-panel ref-settings-panel--plugins">
			<p className="ref-settings-lead">{t('settings.plugins.lead')}</p>

			<section className="ref-settings-agent-section">
				<div className="ref-settings-agent-section-head ref-settings-agent-section-head--wrap">
					<h2 className="ref-settings-agent-section-title">{t('settings.plugins.marketplacesTitle')}</h2>
					<div className="ref-settings-agent-head-actions">
						<button
							type="button"
							className="ref-settings-agent-new-btn"
							onClick={() => void handleRefreshAll()}
							disabled={busyKey === 'refresh-all'}
						>
							<IconRefresh />
							<span>{t('settings.plugins.refreshAll')}</span>
						</button>
					</div>
				</div>
				<p className="ref-settings-agent-section-desc">{t('settings.plugins.marketplacesDesc')}</p>

				<div className="ref-settings-plugins-root-grid">
					<div className="ref-settings-agent-card ref-settings-plugins-root-card">
						<div className="ref-settings-plugins-root-head">
							<div className="ref-settings-plugins-root-copy">
								<div className="ref-settings-plugins-root-title-row">
									<div className="ref-settings-agent-card-title">{t('settings.plugins.userScope')}</div>
									<Badge
										text={
											state?.userPluginsRootCustomized
												? t('settings.plugins.userDirectoryCustom')
												: t('settings.plugins.userDirectoryDefault')
										}
									/>
								</div>
								<p className="ref-settings-agent-card-desc">
									{state?.userPluginsRootCustomized
										? t('settings.plugins.userDirectoryCustomDesc')
										: t('settings.plugins.userDirectoryDefaultDesc')}
								</p>
								<div className="ref-settings-plugins-path-block">{state?.userPluginsRoot ?? ''}</div>
							</div>
							<div className="ref-settings-plugins-root-actions">
								<button
									type="button"
									className="ref-settings-agent-new-btn ref-settings-agent-new-btn--emph"
									onClick={() => void handlePickUserDirectory()}
									disabled={busyKey === 'pick-user-dir' || busyKey === 'set-user-dir'}
								>
									<IconFolderPlus />
									<span>{t('settings.plugins.chooseUserDirectory')}</span>
								</button>
								<button
									type="button"
									className="ref-settings-agent-new-btn"
									onClick={() => revealPath(state?.userPluginsRoot ?? '')}
								>
									<IconFolder />
									<span>{t('settings.plugins.reveal')}</span>
								</button>
								<button
									type="button"
									className="ref-settings-agent-new-btn"
									onClick={() => void handleResetUserDirectory()}
									disabled={!state?.userPluginsRootCustomized || busyKey === 'reset-user-dir'}
								>
									<IconRefresh />
									<span>{t('settings.plugins.resetUserDirectory')}</span>
								</button>
							</div>
						</div>
					</div>
					<div className="ref-settings-agent-card ref-settings-plugins-root-card">
						<div className="ref-settings-plugins-root-head">
							<div className="ref-settings-plugins-root-copy">
								<div className="ref-settings-agent-card-title">{t('settings.plugins.projectScope')}</div>
								<p className="ref-settings-agent-card-desc">
									{state?.projectPluginsRoot ?? t('settings.plugins.projectScopeUnavailable')}
								</p>
								{state?.projectPluginsRoot ? (
									<div className="ref-settings-plugins-path-block">{state.projectPluginsRoot}</div>
								) : null}
							</div>
							<button
								type="button"
								className="ref-settings-agent-new-btn"
								onClick={() => revealPath(state?.projectPluginsRoot ?? '')}
								disabled={!state?.projectPluginsRoot}
							>
								<IconFolder />
								<span>{t('settings.plugins.reveal')}</span>
							</button>
						</div>
					</div>
				</div>

				<div className="ref-settings-agent-card ref-settings-plugins-source-card">
					<div className="ref-settings-plugins-add-row">
						<label className="ref-settings-field ref-settings-plugins-source-field">
							<span>{t('settings.plugins.sourceLabel')}</span>
							<input
								value={sourceInput}
								onChange={(event) => setSourceInput(event.target.value)}
								placeholder={t('settings.plugins.sourcePlaceholder')}
								spellCheck={false}
								onKeyDown={(event) => {
									if (event.key === 'Enter') {
										event.preventDefault();
										void handleAddMarketplace();
									}
								}}
							/>
						</label>
						<button
							type="button"
							className="ref-settings-agent-new-btn ref-settings-agent-new-btn--emph"
							onClick={() => void handleAddMarketplace()}
							disabled={busyKey === 'add-marketplace'}
						>
							<IconPlug />
							<span>{t('settings.plugins.addMarketplace')}</span>
						</button>
					</div>
					<p className="ref-settings-proxy-hint">{t('settings.plugins.examplesLabel')}: {sourceExamples.join('  ·  ')}</p>
				</div>

				<div className="ref-settings-plugins-search-row">
					<label className="ref-settings-field ref-settings-plugins-search-field">
						<span>{t('settings.plugins.searchLabel')}</span>
						<input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder={t('settings.plugins.searchPlaceholder')}
							spellCheck={false}
						/>
					</label>
					<label className="ref-settings-field ref-settings-plugins-scope-field">
						<span>{t('settings.plugins.installScope')}</span>
						<VoidSelect
							ariaLabel={t('settings.plugins.installScope')}
							value={installScope}
							onChange={(value) => setInstallScope(value === 'project' ? 'project' : 'user')}
							options={[
								{ value: 'user', label: t('settings.plugins.userScope') },
								{ value: 'project', label: t('settings.plugins.projectScope'), disabled: !workspaceOpen },
							]}
						/>
					</label>
				</div>

				<div className="ref-settings-plugins-marketplace-list">
					{marketplaces.length === 0 ? (
						<div className="ref-settings-plugins-empty">{t('settings.plugins.marketplacesEmpty')}</div>
					) : null}
					{marketplaces.map((marketplace) => {
						const open = expandedByMarketplace[marketplace.name] !== false;
						return (
							<div key={marketplace.name} className="ref-settings-agent-card ref-settings-plugins-marketplace-card">
								<div className="ref-settings-plugins-marketplace-top">
									<button
										type="button"
										className="ref-settings-plugins-marketplace-toggle"
										onClick={() =>
											setExpandedByMarketplace((prev) => ({
												...prev,
												[marketplace.name]: !open,
											}))
										}
									>
										<span className="ref-settings-plugins-marketplace-toggle-icon">
											<IconChevron open={open} />
										</span>
										<div className="ref-settings-plugins-marketplace-summary">
											<div className="ref-settings-plugins-marketplace-title-row">
												<strong className="ref-settings-agent-card-title">{marketplace.name}</strong>
												<Badge text={t(`settings.plugins.sourceKind.${marketplace.sourceKind}`)} />
												<Badge text={t('settings.plugins.pluginCount', { count: String(marketplace.pluginCount) })} />
											</div>
											<p className="ref-settings-agent-card-desc">
												{marketplace.description || marketplace.sourceLabel}
											</p>
										</div>
									</button>
									<div className="ref-settings-plugins-marketplace-toolbar">
										<button
											type="button"
											className="ref-settings-plugins-marketplace-action-btn"
											onClick={() => revealPath(marketplace.installLocation)}
											title={t('settings.plugins.reveal')}
										>
											<IconFolder />
											<span>{t('settings.plugins.reveal')}</span>
										</button>
										<button
											type="button"
											className="ref-settings-plugins-marketplace-action-btn"
											onClick={() => void handleRefreshMarketplace(marketplace.name)}
											disabled={!marketplace.canRefresh || busyKey === `refresh:${marketplace.name}`}
											title={t('settings.plugins.refresh')}
										>
											<IconRefresh />
											<span>{t('settings.plugins.refresh')}</span>
										</button>
										<button
											type="button"
											className="ref-settings-plugins-marketplace-action-btn"
											onClick={() => void handleRemoveMarketplace(marketplace.name)}
											disabled={busyKey === `remove:${marketplace.name}`}
											title={t('settings.plugins.remove')}
										>
											<IconTrash />
											<span>{t('settings.plugins.remove')}</span>
										</button>
									</div>
								</div>
								{open ? (
									<div className="ref-settings-plugins-marketplace-body">
										<div className="ref-settings-plugins-path-block">{marketplace.installLocation}</div>
										{marketplace.error ? (
											<div className="ref-settings-plugins-inline-error">{marketplace.error}</div>
										) : null}
										<div className="ref-settings-plugins-plugin-grid">
											{marketplace.plugins.length === 0 ? (
												<div className="ref-settings-plugins-empty ref-settings-plugins-empty--inline">
													{t('settings.plugins.pluginsEmpty')}
												</div>
											) : null}
											{marketplace.plugins.map((plugin) => {
												const installInSelectedScope = plugin.installs.find((item) => item.scope === installScope);
												return (
													<div key={`${marketplace.name}:${plugin.name}`} className="ref-settings-plugins-plugin-card">
														<div className="ref-settings-plugins-plugin-head">
															<div>
																<div className="ref-settings-plugins-plugin-title-row">
																	<strong>{plugin.name}</strong>
																	{plugin.version ? <Badge text={`v${plugin.version}`} /> : null}
																</div>
																<p className="ref-settings-agent-card-desc">
																	{plugin.description || t('settings.plugins.noDescription')}
																</p>
															</div>
															<button
																type="button"
																className="ref-settings-agent-new-btn ref-settings-agent-new-btn--emph"
																onClick={() => void handleInstall(marketplace.name, plugin.name)}
																disabled={
																	Boolean(installInSelectedScope) ||
																	busyKey === `install:${marketplace.name}:${plugin.name}:${installScope}`
																}
															>
																<span>
																	{installInSelectedScope
																		? t('settings.plugins.installedInScope')
																		: t('settings.plugins.install')}
																</span>
															</button>
														</div>
														<div className="ref-settings-plugins-badge-row">
															<Badge text={t(`settings.plugins.pluginSourceKind.${plugin.sourceKind}`)} />
															{plugin.category ? <Badge text={plugin.category} /> : null}
															{plugin.tags.slice(0, 3).map((tag) => (
																<Badge key={tag} text={tag} />
															))}
														</div>
														{plugin.installs.length > 0 ? (
															<div className="ref-settings-plugins-install-row">
																{plugin.installs.map((install) => (
																	<Badge
																		key={`${install.installDir}:${install.scope}`}
																		text={`${t(`settings.plugins.scopeShort.${install.scope}`)} · ${
																			install.enabled
																				? t('settings.plugins.enabled')
																				: t('settings.plugins.disabled')
																		}`}
																		tone={install.enabled ? 'success' : 'warn'}
																	/>
																))}
															</div>
														) : null}
													</div>
												);
											})}
										</div>
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			</section>

			<section className="ref-settings-agent-section">
				<div className="ref-settings-agent-section-head">
					<h2 className="ref-settings-agent-section-title">{t('settings.plugins.installedTitle')}</h2>
				</div>
				<p className="ref-settings-agent-section-desc">{t('settings.plugins.installedDesc')}</p>
				<div className="ref-settings-plugins-marketplace-list">
					{installedPlugins.length === 0 ? (
						<div className="ref-settings-plugins-empty">{t('settings.plugins.installedEmpty')}</div>
					) : null}
					{installedPlugins.map((plugin) => {
						const runtime = runtimeByInstallDir.get(plugin.installDir);
						return (
						<div key={plugin.id} className="ref-settings-agent-card ref-settings-plugins-marketplace-card">
							<div className="ref-settings-plugins-marketplace-top">
								<div className="ref-settings-plugins-marketplace-summary">
									<div className="ref-settings-plugins-marketplace-title-row">
										<strong className="ref-settings-agent-card-title">{plugin.displayName}</strong>
										{plugin.version ? <Badge text={`v${plugin.version}`} /> : null}
										<Badge
											text={plugin.enabled ? t('settings.plugins.enabled') : t('settings.plugins.disabled')}
											tone={plugin.enabled ? 'success' : 'warn'}
										/>
									</div>
									<p className="ref-settings-agent-card-desc">
										{plugin.description || t('settings.plugins.noDescription')}
									</p>
									<div className="ref-settings-plugins-badge-row">
										<Badge text={t(`settings.plugins.scopeShort.${plugin.scope}`)} />
										{plugin.marketplaceName ? <Badge text={plugin.marketplaceName} /> : null}
										<Badge text={t(`settings.plugins.installedSourceKind.${plugin.sourceKind}`)} />
										{runtime && runtime.skills > 0 ? (
											<Badge text={t('settings.plugins.runtimeSkills', { count: String(runtime.skills) })} />
										) : null}
										{runtime && runtime.commands > 0 ? (
											<Badge text={t('settings.plugins.runtimeCommands', { count: String(runtime.commands) })} />
										) : null}
										{runtime && runtime.mcpServers > 0 ? (
											<Badge text={t('settings.plugins.runtimeMcp', { count: String(runtime.mcpServers) })} />
										) : null}
									</div>
									{runtime && (runtime.skills > 0 || runtime.commands > 0 || runtime.mcpServers > 0) ? (
										<p className="ref-settings-proxy-hint" style={{ marginTop: 10 }}>
											{t('settings.plugins.runtimeReadyDesc')}
										</p>
									) : null}
								</div>
								<div className="ref-settings-plugins-marketplace-toolbar">
									<button
										type="button"
										className="ref-settings-plugins-marketplace-action-btn"
										onClick={() => revealPath(plugin.installDir)}
										title={t('settings.plugins.reveal')}
									>
										<IconFolder />
										<span>{t('settings.plugins.reveal')}</span>
									</button>
									<button
										type="button"
										className="ref-settings-plugins-marketplace-action-btn"
										onClick={() => void handleToggleEnabled(plugin.installDir, !plugin.enabled)}
										disabled={busyKey === `toggle:${plugin.installDir}`}
										title={plugin.enabled ? t('settings.plugins.disable') : t('settings.plugins.enable')}
									>
										<span>{plugin.enabled ? t('settings.plugins.disable') : t('settings.plugins.enable')}</span>
									</button>
									<button
										type="button"
										className="ref-settings-plugins-marketplace-action-btn"
										onClick={() => void handleUninstall(plugin.installDir, plugin.displayName)}
										disabled={busyKey === `uninstall:${plugin.installDir}`}
										title={t('settings.plugins.uninstall')}
									>
										<IconTrash />
										<span>{t('settings.plugins.uninstall')}</span>
									</button>
								</div>
							</div>
							<div className="ref-settings-plugins-marketplace-body">
								<div className="ref-settings-plugins-path-block">{plugin.installDir}</div>
							</div>
						</div>
						);
					})}
				</div>
			</section>

			{toast && typeof document !== 'undefined'
				? createPortal(
					<div
						key={toast.key}
						className={`ref-settings-plugins-toast ref-settings-plugins-toast--${toast.kind}`}
						role={toast.kind === 'error' ? 'alert' : 'status'}
						aria-live="polite"
					>
						{toast.text}
					</div>,
					document.body
				)
				: null}
		</div>
	);
}
