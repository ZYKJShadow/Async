import { useCallback, useEffect, useState } from 'react';
import { useI18n } from './i18n';
import type { AutoUpdateStatus } from './ipcTypes';

type SettingsAutoUpdatePanelProps = {
	shell: NonNullable<Window['asyncShell']> | null;
};

export function SettingsAutoUpdatePanel({ shell }: SettingsAutoUpdatePanelProps) {
	const { t } = useI18n();
	const [updateStatus, setUpdateStatus] = useState<AutoUpdateStatus>({ state: 'idle' });
	const [checking, setChecking] = useState(false);
	const [downloading, setDownloading] = useState(false);
	const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
	const [allowDifferential, setAllowDifferential] = useState(true);
	const [currentVersion, setCurrentVersion] = useState('');

	// 加载设置
	useEffect(() => {
		if (!shell) return;
		
		shell.invoke('settings:get').then((settings: any) => {
			setAutoUpdateEnabled(settings.autoUpdate?.enabled !== false);
			setAllowDifferential(settings.autoUpdate?.allowDifferential !== false);
		}).catch(() => {
			// 忽略错误
		});
	}, [shell]);

	// 获取当前应用版本
	useEffect(() => {
		if (!shell) return;
		shell.invoke('app:getVersion')
			.then((r: any) => {
				setCurrentVersion(r?.version ?? '');
			})
			.catch(() => {
				// 忽略错误
			});
	}, [shell]);

	// 监听自动更新状态变化
	useEffect(() => {
		if (!shell) return;
		
		const asyncShell = shell as any;
		const unsubscribe = asyncShell.subscribeAutoUpdateStatus((status: AutoUpdateStatus) => {
			setUpdateStatus(status);
			if (status.state !== 'checking') {
				setChecking(false);
			}
			if (status.state !== 'downloading') {
				setDownloading(false);
			}
		});
		return () => unsubscribe();
	}, [shell]);

	// 获取初始状态
	useEffect(() => {
		if (!shell) return;
		
		shell.invoke('auto-update:get-status')
			.then((status: any) => {
				setUpdateStatus(status);
			})
			.catch(() => {
				// 忽略错误
			});
	}, [shell]);

	const handleCheckForUpdates = useCallback(async () => {
		if (!shell) return;
		setChecking(true);
		try {
			const status = await shell.invoke('auto-update:check');
			setUpdateStatus(status as AutoUpdateStatus);
		} catch (e) {
			setUpdateStatus({ state: 'error', message: String(e) });
		} finally {
			setChecking(false);
		}
	}, [shell]);

	const handleDownloadUpdate = useCallback(async () => {
		if (!shell) return;
		setDownloading(true);
		try {
			const result = await shell.invoke('auto-update:download') as { ok: boolean; error?: string };
			if (!result.ok) {
				setUpdateStatus({ state: 'error', message: result.error || 'Download failed' });
			}
		} catch (e) {
			setUpdateStatus({ state: 'error', message: String(e) });
		} finally {
			setDownloading(false);
		}
	}, [shell]);

	const handleInstallUpdate = useCallback(async () => {
		if (!shell) return;
		try {
			await shell.invoke('auto-update:install');
		} catch (e) {
			console.error('Failed to install update:', e);
		}
	}, [shell]);

	const handleToggleAutoUpdate = useCallback(async () => {
		if (!shell) return;
		const newValue = !autoUpdateEnabled;
		setAutoUpdateEnabled(newValue);
		
		try {
			const settings = await shell.invoke('settings:get') as any;
			await shell.invoke('settings:set', {
				...settings,
				autoUpdate: {
					...settings.autoUpdate,
					enabled: newValue,
				},
			});
		} catch (e) {
			console.error('Failed to save autoUpdate setting:', e);
		}
	}, [shell, autoUpdateEnabled]);

	const handleToggleDifferential = useCallback(async () => {
		if (!shell) return;
		const newValue = !allowDifferential;
		setAllowDifferential(newValue);
		
		try {
			const settings = await shell.invoke('settings:get') as any;
			await shell.invoke('settings:set', {
				...settings,
				autoUpdate: {
					...settings.autoUpdate,
					allowDifferential: newValue,
				},
			});
		} catch (e) {
			console.error('Failed to save differential setting:', e);
		}
	}, [shell, allowDifferential]);

	const formatBytes = (bytes: number): string => {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
	};

	return (
		<div className="ref-settings-panel">
			<p className="ref-settings-lead">
				{t('settings.autoUpdate.lead')}
			</p>

			{/* 版本信息 */}
			<h2 className="ref-settings-subhead">{t('settings.autoUpdate.currentVersion')}</h2>
			<div className="ref-settings-agent-card">
				<div className="ref-settings-agent-card-row">
					<div>
						<div className="ref-settings-agent-card-title">
							Async IDE v{currentVersion}
						</div>
						<p className="ref-settings-agent-card-desc">
							{updateStatus.state === 'not-available' 
								? '当前已是最新版本' 
								: updateStatus.state === 'available' 
									? `新版本 v${updateStatus.info.version} 可用`
									: '检查更新以获取最新版本'}
						</p>
					</div>
					<button
						type="button"
						className="ref-settings-add-model"
						onClick={handleCheckForUpdates}
						disabled={checking || !autoUpdateEnabled}
					>
						{checking ? '检查中...' : '检查更新'}
					</button>
				</div>
			</div>

			{/* 更新状态 */}
			{updateStatus.state !== 'idle' && updateStatus.state !== 'not-available' && (
				<div className="ref-settings-agent-card" style={{ marginTop: 16 }}>
					{updateStatus.state === 'checking' && (
						<div className="ref-settings-agent-card-row">
							<div>
								<div className="ref-settings-agent-card-title">正在检查更新...</div>
								<p className="ref-settings-agent-card-desc">请稍候</p>
							</div>
						</div>
					)}

					{updateStatus.state === 'available' && (
						<div className="ref-settings-agent-card-row">
							<div style={{ flex: 1 }}>
								<div className="ref-settings-agent-card-title">
									发现新版本 v{updateStatus.info.version}
								</div>
								{updateStatus.info.releaseNotes && (
									<p className="ref-settings-agent-card-desc" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
										{updateStatus.info.releaseNotes}
									</p>
								)}
								<div style={{ marginTop: 12 }}>
									<button
										type="button"
										className="ref-settings-add-model"
										onClick={handleDownloadUpdate}
										disabled={downloading}
									>
										{downloading ? '下载中...' : '立即下载'}
									</button>
								</div>
							</div>
						</div>
					)}

					{updateStatus.state === 'downloading' && (
						<div className="ref-settings-agent-card-row">
							<div style={{ flex: 1 }}>
								<div className="ref-settings-agent-card-title">
									正在下载更新... {updateStatus.progress.percent.toFixed(1)}%
								</div>
								<div style={{ marginTop: 8, marginBottom: 8 }}>
									<div style={{ 
										width: '100%', 
										height: 4, 
										background: 'var(--void-bg-2, #e5e5e5)', 
										borderRadius: 2 
									}}>
										<div style={{ 
											width: `${updateStatus.progress.percent}%`, 
											height: '100%', 
											background: 'var(--void-primary, #3b82f6)', 
											borderRadius: 2,
											transition: 'width 0.3s ease'
										}} />
									</div>
								</div>
								<p className="ref-settings-agent-card-desc">
									{formatBytes(updateStatus.progress.transferred)} / {formatBytes(updateStatus.progress.total)}
									{updateStatus.progress.bytesPerSecond > 0 && (
										<span style={{ marginLeft: 8 }}>
											({formatBytes(updateStatus.progress.bytesPerSecond)}/s)
										</span>
									)}
								</p>
							</div>
						</div>
					)}

					{updateStatus.state === 'downloaded' && (
						<div className="ref-settings-agent-card-row">
							<div>
								<div className="ref-settings-agent-card-title">更新已下载完成</div>
								<p className="ref-settings-agent-card-desc">重启应用以应用更新</p>
								<div style={{ marginTop: 12 }}>
									<button
										type="button"
										className="ref-settings-add-model"
										onClick={handleInstallUpdate}
									>
										立即重启
									</button>
								</div>
							</div>
						</div>
					)}

					{updateStatus.state === 'error' && (
						<div className="ref-settings-agent-card-row">
							<div>
								<div className="ref-settings-agent-card-title" style={{ color: 'var(--void-danger, #ef4444)' }}>
									更新错误
								</div>
								<p className="ref-settings-agent-card-desc">{updateStatus.message}</p>
							</div>
						</div>
					)}
				</div>
			)}

			{/* 更新设置 */}
			<h2 className="ref-settings-subhead" style={{ marginTop: 24 }}>
				更新设置
			</h2>
			<div className="ref-settings-agent-card">
				<div className="ref-settings-agent-card-row">
					<div>
						<div className="ref-settings-agent-card-title">
							{t('settings.autoUpdate.enableAutoUpdate')}
						</div>
						<p className="ref-settings-agent-card-desc">
							{t('settings.autoUpdate.enableAutoUpdateDesc')}
						</p>
					</div>
					<button
						type="button"
						className={`ref-settings-toggle ${autoUpdateEnabled ? 'is-on' : ''}`}
						role="switch"
						aria-checked={autoUpdateEnabled}
						onClick={handleToggleAutoUpdate}
					>
						<span className="ref-settings-toggle-knob" />
					</button>
				</div>

				<div className="ref-settings-agent-card-row" style={{ marginTop: 16 }}>
					<div>
						<div className="ref-settings-agent-card-title">
							{t('settings.autoUpdate.allowDifferential')}
						</div>
						<p className="ref-settings-agent-card-desc">
							{t('settings.autoUpdate.allowDifferentialDesc')}
						</p>
					</div>
					<button
						type="button"
						className={`ref-settings-toggle ${allowDifferential ? 'is-on' : ''}`}
						role="switch"
						aria-checked={allowDifferential}
						onClick={handleToggleDifferential}
						disabled={!autoUpdateEnabled}
						style={{ opacity: autoUpdateEnabled ? 1 : 0.5, cursor: autoUpdateEnabled ? 'pointer' : 'not-allowed' }}
					>
						<span className="ref-settings-toggle-knob" />
					</button>
				</div>
			</div>
		</div>
	);
}
