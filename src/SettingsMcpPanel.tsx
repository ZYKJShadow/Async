/**
 * MCP (Model Context Protocol) 设置面板
 * 对标 Cursor 的 MCP 配置界面
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from './i18n';
import { VoidSelect } from './VoidSelect';
import type { McpServerConfig, McpServerStatus, McpServerTemplate } from './mcpTypes';
import { MCP_SERVER_TEMPLATES } from './mcpTypes';
import type { PluginRuntimeState } from './pluginRuntimeTypes';

function newId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function IconPlus({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 5v14M5 12h14" strokeLinecap="round" />
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

function IconPlay({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M5 3l14 9-14 9V3z" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconStop({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="6" y="6" width="12" height="12" rx="1" />
		</svg>
	);
}

function IconRefresh({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M1 4v6h6M23 20v-6h-6" strokeLinecap="round" />
			<path d="M20.49 9A9 9 0 005.64 5.64L1 10M3.51 15A9 9 0 0018.36 18.36L23 14" strokeLinecap="round" />
		</svg>
	);
}

function IconChevronDown({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M6 9l6 6 6-6" strokeLinecap="round" />
		</svg>
	);
}

function IconChevronRight({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M9 18l6-6-6-6" strokeLinecap="round" />
		</svg>
	);
}

function IconCheck({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconAlert({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="12" cy="12" r="10" />
			<path d="M12 8v4M12 16h.01" strokeLinecap="round" />
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

function StatusBadge({ status, error }: { status: McpServerStatus['status']; error?: string }) {
	const { t } = useI18n();
	
	const statusClass = {
		connected: 'ref-mcp-status--connected',
		connecting: 'ref-mcp-status--connecting',
		disconnected: 'ref-mcp-status--disconnected',
		error: 'ref-mcp-status--error',
	}[status];
	
	const statusText = {
		connected: t('mcp.status.connected'),
		connecting: t('mcp.status.connecting'),
		disconnected: t('mcp.status.disconnected'),
		error: t('mcp.status.error'),
	}[status];
	
	return (
		<span className={`ref-mcp-status ${statusClass}`} title={error}>
			{status === 'connected' ? <IconCheck /> : status === 'error' ? <IconAlert /> : null}
			<span>{statusText}</span>
		</span>
	);
}

type McpServerEditFormProps = {
	config: McpServerConfig;
	onChange: (config: McpServerConfig) => void;
	onSave: () => void;
	onCancel: () => void;
	onDelete?: () => void;
	isNew: boolean;
};

function McpServerEditForm({ config, onChange, onSave, onCancel, onDelete, isNew }: McpServerEditFormProps) {
	const { t } = useI18n();
	
	const [showEnv, setShowEnv] = useState(false);
	const [showHeaders, setShowHeaders] = useState(false);
	
	const envEntries = useMemo(() => {
		return Object.entries(config.env ?? {}).map(([k, v]) => ({ key: k, value: v }));
	}, [config.env]);
	
	const headerEntries = useMemo(() => {
		return Object.entries(config.headers ?? {}).map(([k, v]) => ({ key: k, value: v }));
	}, [config.headers]);
	
	const updateEnv = useCallback((idx: number, field: 'key' | 'value', val: string) => {
		const entries = [...envEntries];
		entries[idx] = { ...entries[idx], [field]: val };
		onChange({ ...config, env: Object.fromEntries(entries.filter(e => e.key.trim()).map(e => [e.key, e.value] as const)) });
	}, [config, onChange, envEntries]);
	
	const addEnvEntry = useCallback(() => {
		const entries = [...envEntries, { key: '', value: '' }];
		onChange({ ...config, env: Object.fromEntries(entries.filter(e => e.key.trim()).map(e => [e.key, e.value] as const)) });
		setShowEnv(true);
	}, [config, onChange, envEntries]);
	
	const removeEnvEntry = useCallback((idx: number) => {
		const entries = envEntries.filter((_, i) => i !== idx);
		onChange({ ...config, env: Object.fromEntries(entries.filter(e => e.key.trim()).map(e => [e.key, e.value] as const)) });
	}, [config, onChange, envEntries]);
	
	const updateHeader = useCallback((idx: number, field: 'key' | 'value', val: string) => {
		const entries = [...headerEntries];
		entries[idx] = { ...entries[idx], [field]: val };
		onChange({ ...config, headers: Object.fromEntries(entries.filter(e => e.key.trim()).map(e => [e.key, e.value] as const)) });
	}, [config, onChange, headerEntries]);
	
	const addHeaderEntry = useCallback(() => {
		const entries = [...headerEntries, { key: '', value: '' }];
		onChange({ ...config, headers: Object.fromEntries(entries.filter(e => e.key.trim()).map(e => [e.key, e.value] as const)) });
		setShowHeaders(true);
	}, [config, onChange, headerEntries]);
	
	const removeHeaderEntry = useCallback((idx: number) => {
		const entries = headerEntries.filter((_, i) => i !== idx);
		onChange({ ...config, headers: Object.fromEntries(entries.filter(e => e.key.trim()).map(e => [e.key, e.value] as const)) });
	}, [config, onChange, headerEntries]);
	
	return (
		<div className="ref-mcp-edit-form">
			<div className="ref-mcp-edit-row">
				<label className="ref-mcp-edit-field">
					<span>{t('mcp.form.name')}</span>
					<input
						value={config.name}
						onChange={(e) => onChange({ ...config, name: e.target.value })}
						placeholder={t('mcp.form.namePlaceholder')}
					/>
				</label>
			</div>
			
			<div className="ref-mcp-edit-row">
				<label className="ref-mcp-edit-field ref-mcp-edit-field--inline">
					<span>{t('mcp.form.enabled')}</span>
					<input
						type="checkbox"
						checked={config.enabled}
						onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
					/>
				</label>
				<label className="ref-mcp-edit-field ref-mcp-edit-field--inline">
					<span>{t('mcp.form.autoStart')}</span>
					<input
						type="checkbox"
						checked={config.autoStart ?? true}
						onChange={(e) => onChange({ ...config, autoStart: e.target.checked })}
					/>
				</label>
			</div>
			
			<div className="ref-mcp-edit-row">
				<label className="ref-mcp-edit-field">
					<span>{t('mcp.form.transport')}</span>
					<VoidSelect
						ariaLabel={t('mcp.form.transport')}
						value={config.transport}
						onChange={(v) => onChange({ ...config, transport: v as 'stdio' | 'sse' | 'http' })}
						options={[
							{ value: 'stdio', label: t('mcp.transport.stdio') },
							{ value: 'sse', label: t('mcp.transport.sse') },
							{ value: 'http', label: t('mcp.transport.http') },
						]}
					/>
				</label>
			</div>
			
			{config.transport === 'stdio' ? (
				<>
					<div className="ref-mcp-edit-row">
						<label className="ref-mcp-edit-field">
							<span>{t('mcp.form.command')}</span>
							<input
								value={config.command ?? ''}
								onChange={(e) => onChange({ ...config, command: e.target.value })}
								placeholder="npx"
							/>
						</label>
					</div>
					<div className="ref-mcp-edit-row">
						<label className="ref-mcp-edit-field">
							<span>{t('mcp.form.args')}</span>
							<input
								value={(config.args ?? []).join(' ')}
								onChange={(e) => onChange({ ...config, args: e.target.value.split(/\s+/).filter(Boolean) })}
								placeholder="-y @modelcontextprotocol/server-filesystem"
							/>
						</label>
					</div>
					<div className="ref-mcp-edit-row">
						<div className="ref-mcp-edit-expand">
							<button
								type="button"
								className="ref-mcp-edit-expand-btn"
								onClick={() => setShowEnv(!showEnv)}
							>
								{showEnv ? <IconChevronDown /> : <IconChevronRight />}
								<span>{t('mcp.form.env')}</span>
								{envEntries.length > 0 ? <span className="ref-mcp-edit-expand-count">{envEntries.length}</span> : null}
							</button>
							<button type="button" className="ref-mcp-edit-add-small" onClick={addEnvEntry}>
								<IconPlus />
							</button>
						</div>
						{showEnv ? (
							<div className="ref-mcp-edit-env-list">
								{envEntries.map((entry, idx) => (
									<div key={idx} className="ref-mcp-edit-env-row">
										<input
											value={entry.key}
											onChange={(e) => updateEnv(idx, 'key', e.target.value)}
											placeholder="API_KEY"
										/>
										<input
											value={entry.value}
											onChange={(e) => updateEnv(idx, 'value', e.target.value)}
											placeholder="your-api-key"
											type="password"
										/>
										<button type="button" className="ref-mcp-edit-env-remove" onClick={() => removeEnvEntry(idx)}>
											<IconTrash />
										</button>
									</div>
								))}
								{envEntries.length === 0 ? (
									<p className="ref-mcp-edit-env-empty">{t('mcp.form.envEmpty')}</p>
								) : null}
							</div>
						) : null}
					</div>
				</>
			) : (
				<>
					<div className="ref-mcp-edit-row">
						<label className="ref-mcp-edit-field">
							<span>{t('mcp.form.url')}</span>
							<input
								value={config.url ?? ''}
								onChange={(e) => onChange({ ...config, url: e.target.value })}
								placeholder={
									config.transport === 'http'
										? 'http://localhost:8080/mcp'
										: 'http://localhost:8080/sse'
								}
							/>
						</label>
					</div>
					<div className="ref-mcp-edit-row">
						<div className="ref-mcp-edit-expand">
							<button
								type="button"
								className="ref-mcp-edit-expand-btn"
								onClick={() => setShowHeaders(!showHeaders)}
							>
								{showHeaders ? <IconChevronDown /> : <IconChevronRight />}
								<span>{t('mcp.form.headers')}</span>
								{headerEntries.length > 0 ? <span className="ref-mcp-edit-expand-count">{headerEntries.length}</span> : null}
							</button>
							<button type="button" className="ref-mcp-edit-add-small" onClick={addHeaderEntry}>
								<IconPlus />
							</button>
						</div>
						{showHeaders ? (
							<div className="ref-mcp-edit-env-list">
								{headerEntries.map((entry, idx) => (
									<div key={idx} className="ref-mcp-edit-env-row">
										<input
											value={entry.key}
											onChange={(e) => updateHeader(idx, 'key', e.target.value)}
											placeholder="Authorization"
										/>
										<input
											value={entry.value}
											onChange={(e) => updateHeader(idx, 'value', e.target.value)}
											placeholder="Bearer xxx"
										/>
										<button type="button" className="ref-mcp-edit-env-remove" onClick={() => removeHeaderEntry(idx)}>
											<IconTrash />
										</button>
									</div>
								))}
								{headerEntries.length === 0 ? (
									<p className="ref-mcp-edit-env-empty">{t('mcp.form.headersEmpty')}</p>
								) : null}
							</div>
						) : null}
					</div>
				</>
			)}
			
			<div className="ref-mcp-edit-row">
				<label className="ref-mcp-edit-field">
					<span>{t('mcp.form.timeout')}</span>
					<span className="ref-mcp-edit-inline-value">
						<input
							type="number"
							value={config.timeout ?? 30000}
							onChange={(e) => onChange({ ...config, timeout: Number(e.target.value) || 30000 })}
							min={5000}
							max={300000}
							step={1000}
						/>
						<span className="ref-mcp-edit-unit">ms</span>
					</span>
				</label>
			</div>
			
			<div className="ref-mcp-edit-actions">
				<button type="button" className="ref-mcp-edit-save" onClick={onSave}>
					{t('common.save')}
				</button>
				<button type="button" className="ref-mcp-edit-cancel" onClick={onCancel}>
					{t('common.cancel')}
				</button>
				{!isNew && onDelete ? (
					<button type="button" className="ref-mcp-edit-delete" onClick={onDelete}>
						<IconTrash />
						<span>{t('common.delete')}</span>
					</button>
				) : null}
			</div>
		</div>
	);
}

type McpServerRowProps = {
	config: McpServerConfig;
	status: McpServerStatus | null;
	onStart: () => void;
	onStop: () => void;
	onRestart: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	readOnly?: boolean;
};

function McpServerRow({ config, status, onEdit, onStart, onStop, onRestart, onDelete, readOnly = false }: McpServerRowProps) {
	const { t } = useI18n();
	const [expanded, setExpanded] = useState(false);
	
	const currentStatus = status?.status ?? 'disconnected';
	const tools = status?.tools ?? [];
	
	return (
		<div className={`ref-mcp-server-row ${config.enabled ? '' : 'ref-mcp-server-row--disabled'}`}>
			<div className="ref-mcp-server-head">
				<div className="ref-mcp-server-info">
					<span className="ref-mcp-server-name">{config.name}</span>
					{config.pluginSourceName ? (
						<span className="ref-settings-plugins-badge">{config.pluginSourceName}</span>
					) : null}
					<span className="ref-mcp-server-transport">
						<IconPlug />
						<span>{config.transport}</span>
					</span>
					<StatusBadge status={currentStatus} error={status?.error} />
				</div>
				<div className="ref-mcp-server-actions">
					{currentStatus === 'connected' ? (
						<>
							<button type="button" className="ref-mcp-server-action" onClick={onStop} title={t('mcp.action.stop')}>
								<IconStop />
							</button>
							<button type="button" className="ref-mcp-server-action" onClick={onRestart} title={t('mcp.action.restart')}>
								<IconRefresh />
							</button>
						</>
					) : currentStatus === 'connecting' ? (
						<button type="button" className="ref-mcp-server-action" onClick={onStop} title={t('mcp.action.stop')}>
							<IconStop />
						</button>
					) : (
						<button type="button" className="ref-mcp-server-action" onClick={onStart} title={t('mcp.action.start')}>
							<IconPlay />
						</button>
					)}
					{!readOnly && onEdit ? (
						<button type="button" className="ref-mcp-server-action" onClick={onEdit} title={t('mcp.action.edit')}>
							<IconGear />
						</button>
					) : null}
					{!readOnly && onDelete ? (
						<button
							type="button"
							className="ref-mcp-server-action ref-mcp-server-action--delete"
							onClick={onDelete}
							title={t('common.delete')}
						>
							<IconTrash />
						</button>
					) : null}
				</div>
			</div>
			
			{tools.length > 0 ? (
				<div className="ref-mcp-server-tools">
					<button
						type="button"
						className="ref-mcp-server-tools-expand"
						onClick={() => setExpanded(!expanded)}
					>
						{expanded ? <IconChevronDown /> : <IconChevronRight />}
						<span>{t('mcp.toolsCount', { count: tools.length })}</span>
					</button>
					{expanded ? (
						<ul className="ref-mcp-server-tools-list">
							{tools.map((tool) => (
								<li key={tool.name} className="ref-mcp-server-tool-item">
									<span className="ref-mcp-server-tool-name">{tool.name}</span>
									{tool.description ? (
										<span className="ref-mcp-server-tool-desc">{tool.description}</span>
									) : null}
								</li>
							))}
						</ul>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function IconGear({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="12" cy="12" r="3" />
			<path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeLinecap="round" />
		</svg>
	);
}

function IconTemplate({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<path d="M3 9h18M9 21V9" strokeLinecap="round" />
		</svg>
	);
}

export type SettingsMcpPanelProps = {
	servers: McpServerConfig[];
	statuses: McpServerStatus[];
	onChangeServers: (servers: McpServerConfig[]) => void;
	onRefreshStatuses: () => void;
	onStartServer: (id: string) => void;
	onStopServer: (id: string) => void;
	onRestartServer: (id: string) => void;
	shell: NonNullable<Window['asyncShell']> | null;
};

export function SettingsMcpPanel({
	servers,
	statuses,
	onChangeServers,
	onRefreshStatuses,
	onStartServer,
	onStopServer,
	onRestartServer,
	shell,
}: SettingsMcpPanelProps) {
	const { t } = useI18n();
	
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editingConfig, setEditingConfig] = useState<McpServerConfig | null>(null);
	const [showTemplates, setShowTemplates] = useState(false);
	const [pluginServers, setPluginServers] = useState<McpServerConfig[]>([]);
	
	const statusMap = useMemo(() => {
		const map = new Map<string, McpServerStatus>();
		for (const s of statuses) {
			map.set(s.id, s);
		}
		return map;
	}, [statuses]);
	
	const startEdit = useCallback((config: McpServerConfig) => {
		setEditingId(config.id);
		setEditingConfig(config);
	}, []);
	
	const startNew = useCallback(() => {
		const newConfig: McpServerConfig = {
			id: newId(),
			name: '',
			enabled: true,
			transport: 'stdio',
			command: '',
			args: [],
			env: {},
			autoStart: true,
			timeout: 30000,
		};
		setEditingId(newConfig.id);
		setEditingConfig(newConfig);
	}, []);
	
	const cancelEdit = useCallback(() => {
		setEditingId(null);
		setEditingConfig(null);
	}, []);
	
	const saveEdit = useCallback(() => {
		if (!editingConfig) return;
		const existing = servers.findIndex(s => s.id === editingConfig.id);
		if (existing >= 0) {
			onChangeServers(servers.map((s, i) => i === existing ? editingConfig : s));
		} else {
			onChangeServers([...servers, editingConfig]);
		}
		setEditingId(null);
		setEditingConfig(null);
	}, [editingConfig, servers, onChangeServers]);
	
	const deleteServer = useCallback((id: string) => {
		onChangeServers(servers.filter(s => s.id !== id));
	}, [servers, onChangeServers]);
	
	const applyTemplate = useCallback((template: McpServerTemplate) => {
		const newConfig: McpServerConfig = {
			id: newId(),
			name: template.name,
			enabled: true,
			transport: template.transport,
			command: template.command ?? '',
			args: template.args ?? [],
			env: template.env ?? {},
			url: template.url ?? '',
			autoStart: true,
			timeout: 30000,
		};
		setEditingId(newConfig.id);
		setEditingConfig(newConfig);
		setShowTemplates(false);
	}, []);
	
	// Auto-refresh statuses on mount
	useEffect(() => {
		onRefreshStatuses();
	}, []);

	useEffect(() => {
		if (!shell) {
			setPluginServers([]);
			return;
		}
		let cancelled = false;
		const loadPluginServers = async () => {
			try {
				const runtime = (await shell.invoke('plugins:getRuntimeState')) as PluginRuntimeState;
				if (cancelled) {
					return;
				}
				setPluginServers(Array.isArray(runtime?.mcpServers) ? runtime.mcpServers : []);
			} catch {
				if (!cancelled) {
					setPluginServers([]);
				}
			}
		};
		void loadPluginServers();
		const unsubscribe = shell.subscribePluginsChanged?.(() => {
			void loadPluginServers();
		});
		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [shell]);
	
	return (
		<div className="ref-settings-panel ref-settings-panel--mcp">
			<p className="ref-settings-mcp-lead">{t('mcp.lead')}</p>
			
			<div className="ref-settings-mcp-toolbar">
				<button type="button" className="ref-settings-mcp-add" onClick={startNew}>
					<IconPlus />
					<span>{t('mcp.addServer')}</span>
				</button>
				<button type="button" className="ref-settings-mcp-templates" onClick={() => setShowTemplates(!showTemplates)}>
					<IconTemplate />
					<span>{t('mcp.templates')}</span>
					{showTemplates ? <IconChevronDown /> : <IconChevronRight />}
				</button>
				<button type="button" className="ref-settings-mcp-refresh" onClick={onRefreshStatuses} title={t('common.refresh')}>
					<IconRefresh />
				</button>
			</div>
			
			{showTemplates ? (
				<div className="ref-settings-mcp-templates-panel">
					<p className="ref-settings-mcp-templates-hint">{t('mcp.templatesHint')}</p>
					<ul className="ref-settings-mcp-templates-list">
						{MCP_SERVER_TEMPLATES.map((template) => (
							<li key={template.id} className="ref-settings-mcp-template-item">
								<button
									type="button"
									className="ref-settings-mcp-template-btn"
									onClick={() => applyTemplate(template)}
								>
									<span className="ref-settings-mcp-template-name">{template.name}</span>
									<span className="ref-settings-mcp-template-desc">{template.description}</span>
								</button>
							</li>
						))}
					</ul>
				</div>
			) : null}
			
			{editingId && editingConfig ? (
				<div className="ref-settings-mcp-edit-wrap">
					<h3 className="ref-settings-mcp-edit-title">
						{servers.some(s => s.id === editingId) ? t('mcp.editServer') : t('mcp.newServer')}
					</h3>
					<McpServerEditForm
						config={editingConfig}
						onChange={setEditingConfig}
						onSave={saveEdit}
						onCancel={cancelEdit}
						onDelete={() => {
							deleteServer(editingId);
							cancelEdit();
						}}
						isNew={!servers.some(s => s.id === editingId)}
					/>
				</div>
			) : null}
			
			<section className="ref-settings-mcp-servers">
				<h2 className="ref-settings-mcp-servers-title">{t('mcp.serversTitle')}</h2>
				{servers.length === 0 ? (
					<p className="ref-settings-mcp-empty">{t('mcp.noServers')}</p>
				) : (
					<ul className="ref-settings-mcp-servers-list">
						{servers.map((config) => (
							<li key={config.id}>
								<McpServerRow
									config={config}
									status={statusMap.get(config.id) ?? null}
									onEdit={() => startEdit(config)}
									onStart={() => onStartServer(config.id)}
									onStop={() => onStopServer(config.id)}
									onRestart={() => onRestartServer(config.id)}
									onDelete={() => deleteServer(config.id)}
								/>
							</li>
						))}
					</ul>
				)}
			</section>

			{pluginServers.length > 0 ? (
				<section className="ref-settings-mcp-servers">
					<h2 className="ref-settings-mcp-servers-title">{t('mcp.pluginServersTitle')}</h2>
					<p className="ref-settings-agent-section-desc">{t('mcp.pluginServersDesc')}</p>
					<ul className="ref-settings-mcp-servers-list">
						{pluginServers.map((config) => (
							<li key={config.id}>
								<McpServerRow
									config={config}
									status={statusMap.get(config.id) ?? null}
									onStart={() => onStartServer(config.id)}
									onStop={() => onStopServer(config.id)}
									onRestart={() => onRestartServer(config.id)}
									readOnly
								/>
							</li>
						))}
					</ul>
				</section>
			) : null}
			
			<div className="ref-settings-mcp-doc">
				<p>{t('mcp.docHint')}</p>
				<a href="https://modelcontextprotocol.io/introduction" target="_blank" rel="noopener noreferrer">
					{t('mcp.docLink')}
				</a>
			</div>
		</div>
	);
}
