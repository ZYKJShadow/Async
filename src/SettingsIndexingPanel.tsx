import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from './i18n';
import type { IndexingSettingsState } from './indexingSettingsTypes';
import type { AgentCustomization, AgentMemoryExtractionSettings } from './agentSettingsTypes';
import { defaultAgentCustomization } from './agentSettingsTypes';

type IndexingStats = {
	ok?: boolean;
	workspaceRoot?: string | null;
	indexDir?: string | null;
	fileCount?: number;
	symbolUniqueNames?: number;
	symbolIndexedFiles?: number;
	semanticChunks?: number;
	semanticBusy?: boolean;
};

type MemoryStats = {
	ok?: boolean;
	workspaceRoot?: string | null;
	memoryDir?: string | null;
	entrypointPath?: string | null;
	entrypointExists?: boolean;
	topicFiles?: number;
	entryCount?: number;
};

type ShellApi = NonNullable<Window['asyncShell']>;

type Props = {
	value: IndexingSettingsState;
	onChange: (next: IndexingSettingsState) => void;
	/** 切换单项时立即同步主进程（与关闭设置页时的全量保存配合） */
	onPersistPatch: (patch: Partial<IndexingSettingsState>) => void;
	shell: ShellApi | null;
	workspaceOpen: boolean;
	/** 会话记忆抽取阈值写入 `agent.memoryExtraction` */
	agentCustomization: AgentCustomization;
	onChangeAgentCustomization: (next: AgentCustomization) => void;
};

export function SettingsIndexingPanel({
	value,
	onChange,
	onPersistPatch,
	shell,
	workspaceOpen,
	agentCustomization,
	onChangeAgentCustomization,
}: Props) {
	const { t } = useI18n();
	const av = useMemo(
		() => ({ ...defaultAgentCustomization(), ...agentCustomization }),
		[agentCustomization]
	);
	const patchAgent = useCallback(
		(p: Partial<AgentCustomization>) => {
			onChangeAgentCustomization({ ...av, ...p });
		},
		[av, onChangeAgentCustomization]
	);
	const [stats, setStats] = useState<IndexingStats | null>(null);
	const [statsLoading, setStatsLoading] = useState(false);
	const [rebuildBusy, setRebuildBusy] = useState<'symbols' | 'semantic' | 'all' | null>(null);
	const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
	const [memoryLoading, setMemoryLoading] = useState(false);
	const [memoryRebuilding, setMemoryRebuilding] = useState(false);

	const refreshStats = useCallback(async () => {
		if (!shell) {
			return;
		}
		setStatsLoading(true);
		try {
			const r = (await shell.invoke('workspace:indexing:stats')) as IndexingStats;
			setStats(r?.ok ? r : null);
		} catch {
			setStats(null);
		} finally {
			setStatsLoading(false);
		}
	}, [shell]);

	const refreshMemoryStats = useCallback(async () => {
		if (!shell || !workspaceOpen) {
			setMemoryStats(null);
			return;
		}
		setMemoryLoading(true);
		try {
			const r = (await shell.invoke('workspace:memory:stats')) as MemoryStats;
			setMemoryStats(r?.ok ? r : null);
		} catch {
			setMemoryStats(null);
		} finally {
			setMemoryLoading(false);
		}
	}, [shell, workspaceOpen]);

	useEffect(() => {
		void refreshStats();
	}, [refreshStats, workspaceOpen, value.symbolIndexEnabled, value.semanticIndexEnabled]);

	useEffect(() => {
		void refreshMemoryStats();
	}, [refreshMemoryStats, workspaceOpen]);

	const patchToggle = (key: keyof IndexingSettingsState, on: boolean) => {
		const next = { ...value, [key]: on };
		onChange(next);
		onPersistPatch({ [key]: on });
	};

	const runRebuild = async (target: 'symbols' | 'semantic' | 'all') => {
		if (!shell || !workspaceOpen) {
			return;
		}
		setRebuildBusy(target);
		try {
			await shell.invoke('workspace:indexing:rebuild', { target });
			await refreshStats();
		} finally {
			setRebuildBusy(null);
		}
	};

	const runMemoryRebuild = async () => {
		if (!shell || !workspaceOpen) {
			return;
		}
		setMemoryRebuilding(true);
		try {
			await shell.invoke('workspace:memory:rebuild');
			await refreshMemoryStats();
		} finally {
			setMemoryRebuilding(false);
		}
	};

	const revealAbsolutePath = async (absPath: string | null | undefined) => {
		if (!shell || !absPath) {
			return;
		}
		await shell.invoke('shell:revealAbsolutePath', absPath);
	};

	return (
		<div className="ref-settings-panel ref-settings-panel--indexing">
			<p className="ref-settings-lead">{t('settings.indexing.lead')}</p>

			<h2 className="ref-settings-subhead">{t('settings.indexing.codeIndexTitle')}</h2>
			<div className="ref-settings-agent-card">
				<div className="ref-settings-agent-card-row">
					<div>
						<div className="ref-settings-agent-card-title">{t('settings.indexing.symbolIndex')}</div>
						<p className="ref-settings-agent-card-desc">{t('settings.indexing.symbolIndexDesc')}</p>
					</div>
					<button
						type="button"
						className={`ref-settings-toggle ${value.symbolIndexEnabled ? 'is-on' : ''}`}
						role="switch"
						aria-checked={value.symbolIndexEnabled}
						onClick={() => patchToggle('symbolIndexEnabled', !value.symbolIndexEnabled)}
					>
						<span className="ref-settings-toggle-knob" />
					</button>
				</div>
				<div className="ref-settings-agent-card-row" style={{ marginTop: 12 }}>
					<div>
						<div className="ref-settings-agent-card-title">{t('settings.indexing.semanticIndex')}</div>
						<p className="ref-settings-agent-card-desc">{t('settings.indexing.semanticIndexDesc')}</p>
					</div>
					<button
						type="button"
						className={`ref-settings-toggle ${value.semanticIndexEnabled ? 'is-on' : ''}`}
						role="switch"
						aria-checked={value.semanticIndexEnabled}
						onClick={() => patchToggle('semanticIndexEnabled', !value.semanticIndexEnabled)}
					>
						<span className="ref-settings-toggle-knob" />
					</button>
				</div>
			</div>

			<h2 className="ref-settings-subhead" style={{ marginTop: 24 }}>
				{t('settings.indexing.statsTitle')}
			</h2>
			<p className="ref-settings-proxy-hint">{t('settings.indexing.statsHint')}</p>
			<div className="ref-settings-indexing-stats">
				{!workspaceOpen ? (
					<p className="ref-settings-proxy-hint">{t('settings.indexing.noWorkspace')}</p>
				) : statsLoading ? (
					<p className="ref-settings-proxy-hint">{t('settings.indexing.statsLoading')}</p>
				) : stats ? (
					<ul className="ref-settings-indexing-stat-list">
						<li>
							{t('settings.indexing.indexDir')}: <strong>{stats.indexDir ?? '—'}</strong>
						</li>
						<li>
							{t('settings.indexing.statFiles')}: <strong>{stats.fileCount ?? 0}</strong>
						</li>
						<li>
							{t('settings.indexing.statSymbols')}:{' '}
							<strong>{stats.symbolUniqueNames ?? 0}</strong> ({t('settings.indexing.statSymbolFiles')}:{' '}
							{stats.symbolIndexedFiles ?? 0})
						</li>
						<li>
							{t('settings.indexing.statSemantic')}: <strong>{stats.semanticChunks ?? 0}</strong>
							{stats.semanticBusy ? ` (${t('settings.indexing.statSemanticBusy')})` : ''}
						</li>
					</ul>
				) : (
					<p className="ref-settings-proxy-hint">{t('settings.indexing.statsUnavailable')}</p>
				)}
			</div>
			<div className="ref-settings-indexing-actions">
				<button
					type="button"
					className="ref-settings-add-model"
					disabled={!shell || !workspaceOpen || statsLoading || rebuildBusy !== null || !value.symbolIndexEnabled}
					onClick={() => void runRebuild('symbols')}
				>
					{rebuildBusy === 'symbols' ? t('settings.indexing.rebuilding') : t('settings.indexing.rebuildSymbols')}
				</button>
				<button
					type="button"
					className="ref-settings-add-model"
					disabled={!shell || !workspaceOpen || statsLoading || rebuildBusy !== null || !value.semanticIndexEnabled}
					onClick={() => void runRebuild('semantic')}
				>
					{rebuildBusy === 'semantic' ? t('settings.indexing.rebuilding') : t('settings.indexing.rebuildSemantic')}
				</button>
				<button
					type="button"
					className="ref-settings-add-model"
					disabled={
						!shell ||
						!workspaceOpen ||
						statsLoading ||
						rebuildBusy !== null ||
						!value.symbolIndexEnabled ||
						!value.semanticIndexEnabled
					}
					onClick={() => void runRebuild('all')}
				>
					{rebuildBusy === 'all' ? t('settings.indexing.rebuilding') : t('settings.indexing.rebuildAll')}
				</button>
				<button
					type="button"
					className="ref-settings-set-default"
					disabled={!shell || !workspaceOpen || statsLoading}
					onClick={() => void refreshStats()}
				>
					{t('settings.indexing.refreshStats')}
				</button>
			</div>

			<h2 className="ref-settings-subhead" style={{ marginTop: 28 }}>
				{t('settings.indexing.memoryTitle')}
			</h2>
			<p className="ref-settings-proxy-hint">{t('settings.indexing.memoryLead')}</p>
			<div className="ref-settings-agent-card">
				<div className="ref-settings-agent-card-row">
					<div>
						<div className="ref-settings-agent-card-title">{t('settings.indexing.memoryLayoutTitle')}</div>
						<p className="ref-settings-agent-card-desc">{t('settings.indexing.memoryLayoutDesc')}</p>
					</div>
				</div>
				<div className="ref-settings-agent-card-row" style={{ marginTop: 12 }}>
					<div>
						<div className="ref-settings-agent-card-title">{t('settings.indexing.memoryAgentTitle')}</div>
						<p className="ref-settings-agent-card-desc">{t('settings.indexing.memoryAgentDesc')}</p>
					</div>
				</div>
			</div>
			<h2 className="ref-settings-subhead" style={{ marginTop: 24 }}>
				{t('settings.indexing.memoryStatsTitle')}
			</h2>
			<p className="ref-settings-proxy-hint">{t('settings.indexing.memoryStatsHint')}</p>
			<div className="ref-settings-indexing-stats">
				{!workspaceOpen ? (
					<p className="ref-settings-proxy-hint">{t('settings.indexing.noWorkspace')}</p>
				) : memoryLoading ? (
					<p className="ref-settings-proxy-hint">{t('settings.indexing.statsLoading')}</p>
				) : memoryStats ? (
					<ul className="ref-settings-indexing-stat-list">
						<li>
							{t('settings.indexing.memoryDir')}: <strong>{memoryStats.memoryDir ?? '—'}</strong>
						</li>
						<li>
							{t('settings.indexing.memoryEntrypoint')}: <strong>{memoryStats.entrypointPath ?? '—'}</strong>
						</li>
						<li>
							{t('settings.indexing.memoryTopicFiles')}: <strong>{memoryStats.topicFiles ?? 0}</strong>
						</li>
						<li>
							{t('settings.indexing.memoryIndexEntries')}: <strong>{memoryStats.entryCount ?? 0}</strong>
						</li>
					</ul>
				) : (
					<p className="ref-settings-proxy-hint">{t('settings.indexing.statsUnavailable')}</p>
				)}
			</div>
			<div className="ref-settings-indexing-actions">
				<button
					type="button"
					className="ref-settings-add-model"
					disabled={!shell || !workspaceOpen || memoryLoading || memoryRebuilding}
					onClick={() => void runMemoryRebuild()}
				>
					{memoryRebuilding ? t('settings.indexing.rebuilding') : t('settings.indexing.rebuildMemory')}
				</button>
				<button
					type="button"
					className="ref-settings-add-model"
					disabled={!shell || !workspaceOpen || memoryLoading || !memoryStats?.memoryDir}
					onClick={() => void revealAbsolutePath(memoryStats?.memoryDir)}
				>
					{t('settings.indexing.openMemoryDir')}
				</button>
				<button
					type="button"
					className="ref-settings-add-model"
					disabled={!shell || !workspaceOpen || memoryLoading || !memoryStats?.entrypointPath}
					onClick={() => void revealAbsolutePath(memoryStats?.entrypointPath)}
				>
					{t('settings.indexing.openMemoryEntrypoint')}
				</button>
				<button
					type="button"
					className="ref-settings-set-default"
					disabled={!shell || !workspaceOpen || memoryLoading || memoryRebuilding}
					onClick={() => void refreshMemoryStats()}
				>
					{t('settings.indexing.refreshMemoryStats')}
				</button>
			</div>

			<h2 className="ref-settings-subhead" style={{ marginTop: 28 }}>
				{t('agentBehavior.memoryExtractionTitle')}
			</h2>
			<p className="ref-settings-proxy-hint">{t('agentBehavior.memoryExtractionDesc')}</p>
			<div className="ref-settings-agent-card">
				<div className="ref-settings-agent-card-row">
					<div>
						<div className="ref-settings-agent-card-title">{t('agentBehavior.memoryExtractionEnabled')}</div>
					</div>
					<button
						type="button"
						className={`ref-settings-toggle ${av.memoryExtraction?.enabled !== false ? 'is-on' : ''}`}
						role="switch"
						aria-checked={av.memoryExtraction?.enabled !== false}
						onClick={() => {
							const cur: AgentMemoryExtractionSettings = { ...(av.memoryExtraction ?? {}) };
							const on = cur.enabled !== false;
							patchAgent({
								memoryExtraction: {
									...cur,
									enabled: on ? false : true,
								},
							});
						}}
					>
						<span className="ref-settings-toggle-knob" />
					</button>
				</div>
				<div className="ref-settings-agent-card-row" style={{ marginTop: 12, alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
					<label className="ref-settings-field ref-settings-field--compact">
						<span>{t('agentBehavior.memFirst')}</span>
						<input
							type="number"
							min={1}
							max={50}
							className="ref-settings-agent-number"
							disabled={av.memoryExtraction?.enabled === false}
							value={av.memoryExtraction?.minNonSystemMessagesBeforeFirst ?? 4}
							onChange={(e) => {
								const n = parseInt(e.target.value, 10);
								if (!Number.isFinite(n)) return;
								patchAgent({
									memoryExtraction: {
										...(av.memoryExtraction ?? {}),
										minNonSystemMessagesBeforeFirst: Math.min(50, Math.max(1, n)),
									},
								});
							}}
						/>
					</label>
					<label className="ref-settings-field ref-settings-field--compact">
						<span>{t('agentBehavior.memBetween')}</span>
						<input
							type="number"
							min={1}
							max={50}
							className="ref-settings-agent-number"
							disabled={av.memoryExtraction?.enabled === false}
							value={av.memoryExtraction?.minNonSystemMessagesBetween ?? 3}
							onChange={(e) => {
								const n = parseInt(e.target.value, 10);
								if (!Number.isFinite(n)) return;
								patchAgent({
									memoryExtraction: {
										...(av.memoryExtraction ?? {}),
										minNonSystemMessagesBetween: Math.min(50, Math.max(1, n)),
									},
								});
							}}
						/>
					</label>
					<label className="ref-settings-field ref-settings-field--compact">
						<span>{t('agentBehavior.memTools')}</span>
						<input
							type="number"
							min={0}
							max={50}
							className="ref-settings-agent-number"
							disabled={av.memoryExtraction?.enabled === false}
							value={av.memoryExtraction?.minToolCallsBetween ?? 3}
							onChange={(e) => {
								const n = parseInt(e.target.value, 10);
								if (!Number.isFinite(n)) return;
								patchAgent({
									memoryExtraction: {
										...(av.memoryExtraction ?? {}),
										minToolCallsBetween: Math.min(50, Math.max(0, n)),
									},
								});
							}}
						/>
					</label>
				</div>
			</div>
		</div>
	);
}
