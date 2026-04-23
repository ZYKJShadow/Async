/**
 * MCP (Model Context Protocol) 设置面板
 * 对标 Cursor 的 MCP 配置界面
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from './i18n';
import { formatMcpCommandPreview, serializeMcpArgs, serializeMcpKeyValueEntries } from './mcpFormUtils';
import { SettingsMcpJsonEditor } from './SettingsMcpJsonEditor';
import { VoidSelect } from './VoidSelect';
import type { McpServerConfig, McpServerStatus, McpServerTemplate } from './mcpTypes';
import { MCP_SERVER_TEMPLATES } from './mcpTypes';
import type { PluginRuntimeState } from './pluginRuntimeTypes';

type PluginMcpOverrideMap = Record<string, { enabled?: boolean; autoStart?: boolean }>;
type DisplayMcpStatus = Exclude<McpServerStatus['status'], 'disconnected'>;

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

function StatusBadge({ status, error }: { status: DisplayMcpStatus; error?: string }) {
	const { t } = useI18n();
	
	const statusClass = {
		not_started: 'ref-mcp-status--not-started',
		connected: 'ref-mcp-status--connected',
		connecting: 'ref-mcp-status--connecting',
		stopped: 'ref-mcp-status--stopped',
		error: 'ref-mcp-status--error',
		disabled: 'ref-mcp-status--disabled',
	}[status];
	
	const statusText = {
		not_started: t('mcp.status.notStarted'),
		connected: t('mcp.status.connected'),
		connecting: t('mcp.status.connecting'),
		stopped: t('mcp.status.stopped'),
		error: t('mcp.status.error'),
		disabled: t('mcp.status.disabled'),
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

type DraftArgEntry = {
	id: string;
	value: string;
};

type DraftKeyValueEntry = {
	id: string;
	key: string;
	value: string;
};

const MCP_ARG_PLACEHOLDERS = ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\workspace'];
const MCP_STDIO_EXAMPLE = {
	command: 'npx',
	args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\YourProject'],
};

function createDraftArgEntries(args: readonly string[] | undefined): DraftArgEntry[] {
	return (args ?? []).map((value) => ({ id: newId(), value }));
}

function createDraftKeyValueEntries(entries: Record<string, string> | undefined): DraftKeyValueEntry[] {
	return Object.entries(entries ?? {}).map(([key, value]) => ({ id: newId(), key, value }));
}

function McpServerEditForm({ config, onChange, onSave, onCancel, onDelete, isNew }: McpServerEditFormProps) {
	const { t } = useI18n();
	
	const [showEnv, setShowEnv] = useState(false);
	const [showHeaders, setShowHeaders] = useState(false);
	const [argEntries, setArgEntries] = useState<DraftArgEntry[]>(() => createDraftArgEntries(config.args));
	const [envEntries, setEnvEntries] = useState<DraftKeyValueEntry[]>(() => createDraftKeyValueEntries(config.env));
	const [headerEntries, setHeaderEntries] = useState<DraftKeyValueEntry[]>(() => createDraftKeyValueEntries(config.headers));

	useEffect(() => {
		setArgEntries(createDraftArgEntries(config.args));
		const nextEnvEntries = createDraftKeyValueEntries(config.env);
		const nextHeaderEntries = createDraftKeyValueEntries(config.headers);
		setEnvEntries(nextEnvEntries);
		setHeaderEntries(nextHeaderEntries);
		setShowEnv(nextEnvEntries.length > 0);
		setShowHeaders(nextHeaderEntries.length > 0);
	}, [config.id]);

	const commitArgs = useCallback(
		(nextEntries: DraftArgEntry[]) => {
			setArgEntries(nextEntries);
			onChange({ ...config, args: serializeMcpArgs(nextEntries.map((entry) => entry.value)) });
		},
		[config, onChange]
	);

	const commitEnvEntries = useCallback(
		(nextEntries: DraftKeyValueEntry[]) => {
			setEnvEntries(nextEntries);
			onChange({
				...config,
				env: serializeMcpKeyValueEntries(nextEntries.map(({ key, value }) => ({ key, value }))),
			});
		},
		[config, onChange]
	);

	const commitHeaderEntries = useCallback(
		(nextEntries: DraftKeyValueEntry[]) => {
			setHeaderEntries(nextEntries);
			onChange({
				...config,
				headers: serializeMcpKeyValueEntries(nextEntries.map(({ key, value }) => ({ key, value }))),
			});
		},
		[config, onChange]
	);

	const updateArg = useCallback(
		(idx: number, value: string) => {
			const nextEntries = [...argEntries];
			nextEntries[idx] = { ...nextEntries[idx], value };
			commitArgs(nextEntries);
		},
		[argEntries, commitArgs]
	);

	const addArgEntry = useCallback(() => {
		commitArgs([...argEntries, { id: newId(), value: '' }]);
	}, [argEntries, commitArgs]);

	const removeArgEntry = useCallback(
		(idx: number) => {
			commitArgs(argEntries.filter((_, i) => i !== idx));
		},
		[argEntries, commitArgs]
	);

	const updateEnv = useCallback(
		(idx: number, field: 'key' | 'value', val: string) => {
			const nextEntries = [...envEntries];
			nextEntries[idx] = { ...nextEntries[idx], [field]: val };
			commitEnvEntries(nextEntries);
		},
		[commitEnvEntries, envEntries]
	);

	const addEnvEntry = useCallback(() => {
		setShowEnv(true);
		commitEnvEntries([...envEntries, { id: newId(), key: '', value: '' }]);
	}, [commitEnvEntries, envEntries]);

	const removeEnvEntry = useCallback(
		(idx: number) => {
			commitEnvEntries(envEntries.filter((_, i) => i !== idx));
		},
		[commitEnvEntries, envEntries]
	);

	const updateHeader = useCallback(
		(idx: number, field: 'key' | 'value', val: string) => {
			const nextEntries = [...headerEntries];
			nextEntries[idx] = { ...nextEntries[idx], [field]: val };
			commitHeaderEntries(nextEntries);
		},
		[commitHeaderEntries, headerEntries]
	);

	const addHeaderEntry = useCallback(() => {
		setShowHeaders(true);
		commitHeaderEntries([...headerEntries, { id: newId(), key: '', value: '' }]);
	}, [commitHeaderEntries, headerEntries]);

	const removeHeaderEntry = useCallback(
		(idx: number) => {
			commitHeaderEntries(headerEntries.filter((_, i) => i !== idx));
		},
		[commitHeaderEntries, headerEntries]
	);

	const commandPreview = useMemo(() => {
		return formatMcpCommandPreview(config.command, argEntries.map((entry) => entry.value));
	}, [argEntries, config.command]);
	
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
						<div className="ref-mcp-edit-field">
							<div className="ref-mcp-edit-list-head">
								<span className="ref-mcp-edit-list-title">{t('mcp.form.args')}</span>
								{argEntries.length > 0 ? <span className="ref-mcp-edit-expand-count">{argEntries.length}</span> : null}
								<button
									type="button"
									className="ref-mcp-edit-add-small"
									onClick={addArgEntry}
									title={t('mcp.form.argsAdd')}
									aria-label={t('mcp.form.argsAdd')}
								>
									<IconPlus />
								</button>
							</div>
							<p className="ref-settings-field-hint ref-mcp-edit-help">{t('mcp.form.argsHint')}</p>
							<div className="ref-mcp-edit-example" aria-label={t('mcp.form.exampleTitle')}>
								<span className="ref-mcp-edit-example-title">{t('mcp.form.exampleTitle')}</span>
								<div className="ref-mcp-edit-example-row">
									<span className="ref-mcp-edit-example-label">{t('mcp.form.command')}</span>
									<code>{MCP_STDIO_EXAMPLE.command}</code>
								</div>
								{MCP_STDIO_EXAMPLE.args.map((arg, idx) => (
									<div key={`${arg}-${idx}`} className="ref-mcp-edit-example-row">
										<span className="ref-mcp-edit-example-label">{t('mcp.form.exampleArg', { index: idx + 1 })}</span>
										<code>{arg}</code>
									</div>
								))}
							</div>
							<div className="ref-mcp-edit-env-list">
								{argEntries.map((entry, idx) => (
									<div key={entry.id} className="ref-mcp-edit-env-row">
										<input
											value={entry.value}
											onChange={(e) => updateArg(idx, e.target.value)}
											placeholder={MCP_ARG_PLACEHOLDERS[idx] ?? t('mcp.form.argsItemPlaceholder')}
										/>
										<button
											type="button"
											className="ref-mcp-edit-env-remove"
											onClick={() => removeArgEntry(idx)}
											title={t('mcp.form.argsRemove')}
											aria-label={t('mcp.form.argsRemove')}
										>
											<IconTrash />
										</button>
									</div>
								))}
								{argEntries.length === 0 ? <p className="ref-mcp-edit-env-empty">{t('mcp.form.argsEmpty')}</p> : null}
							</div>
							{commandPreview ? (
								<div className="ref-mcp-edit-command-preview">
									<span className="ref-mcp-edit-command-preview-label">{t('mcp.form.commandPreview')}</span>
									<code>{commandPreview}</code>
								</div>
							) : null}
						</div>
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
							<button
								type="button"
								className="ref-mcp-edit-add-small"
								onClick={addEnvEntry}
								title={t('mcp.form.envAdd')}
								aria-label={t('mcp.form.envAdd')}
							>
								<IconPlus />
							</button>
						</div>
						{showEnv ? (
							<div className="ref-mcp-edit-env-list">
								{envEntries.map((entry, idx) => (
									<div key={entry.id} className="ref-mcp-edit-env-row">
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
										<button
											type="button"
											className="ref-mcp-edit-env-remove"
											onClick={() => removeEnvEntry(idx)}
											title={t('mcp.form.envRemove')}
											aria-label={t('mcp.form.envRemove')}
										>
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
							<button
								type="button"
								className="ref-mcp-edit-add-small"
								onClick={addHeaderEntry}
								title={t('mcp.form.headersAdd')}
								aria-label={t('mcp.form.headersAdd')}
							>
								<IconPlus />
							</button>
						</div>
						{showHeaders ? (
							<div className="ref-mcp-edit-env-list">
								{headerEntries.map((entry, idx) => (
									<div key={entry.id} className="ref-mcp-edit-env-row">
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
										<button
											type="button"
											className="ref-mcp-edit-env-remove"
											onClick={() => removeHeaderEntry(idx)}
											title={t('mcp.form.headersRemove')}
											aria-label={t('mcp.form.headersRemove')}
										>
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
	onToggleEnabled?: (next: boolean) => void;
	toggleBusy?: boolean;
	onEdit?: () => void;
	onDelete?: () => void;
	readOnly?: boolean;
	pendingAction?: 'start' | 'stop' | 'restart';
	actionError?: string | null;
};

function deriveDisplayMcpStatus(
	config: McpServerConfig,
	status: McpServerStatus | null,
	pendingAction?: 'start' | 'stop' | 'restart'
): DisplayMcpStatus {
	if (pendingAction === 'start' || pendingAction === 'restart') {
		return 'connecting';
	}
	if (pendingAction === 'stop') {
		return 'stopped';
	}
	if (!config.enabled) {
		return 'disabled';
	}
	if (!status) {
		return 'not_started';
	}
	switch (status.status) {
		case 'connected':
		case 'connecting':
		case 'error':
		case 'disabled':
		case 'not_started':
		case 'stopped':
			return status.status;
		case 'disconnected':
		default:
			return 'stopped';
	}
}

function McpServerRow({
	config,
	status,
	onEdit,
	onStart,
	onStop,
	onRestart,
	onToggleEnabled,
	toggleBusy = false,
	onDelete,
	readOnly = false,
	pendingAction,
	actionError,
}: McpServerRowProps) {
	const { t } = useI18n();
	const [expanded, setExpanded] = useState(false);
	
	const currentStatus = deriveDisplayMcpStatus(config, status, pendingAction);
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
					{onToggleEnabled ? (
						<label className="ref-mcp-server-toggle" title={t('mcp.form.enabled')}>
							<input
								type="checkbox"
								checked={config.enabled}
								disabled={toggleBusy || !!pendingAction}
								onChange={(e) => onToggleEnabled(e.target.checked)}
							/>
							<span>{t('mcp.form.enabled')}</span>
						</label>
					) : null}
					{config.enabled && !pendingAction
						? currentStatus === 'connected' ? (
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
							) : currentStatus === 'disabled' ? null : (
								<button type="button" className="ref-mcp-server-action" onClick={onStart} title={t('mcp.action.start')}>
									<IconPlay />
								</button>
							)
						: null}
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

			{actionError ? (
				<div className="ref-mcp-server-error">
					<IconAlert />
					<span>{actionError}</span>
				</div>
			) : null}
			
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
	onStartServer: _onStartServer,
	onStopServer: _onStopServer,
	onRestartServer: _onRestartServer,
	shell,
}: SettingsMcpPanelProps) {
	const { t } = useI18n();
	
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editingConfig, setEditingConfig] = useState<McpServerConfig | null>(null);
	const [showTemplates, setShowTemplates] = useState(false);
	const [editMode, setEditMode] = useState<'visual' | 'json'>('visual');
	const [pluginServers, setPluginServers] = useState<McpServerConfig[]>([]);
	const [pendingPluginToggleIds, setPendingPluginToggleIds] = useState<string[]>([]);
	const [pendingActions, setPendingActions] = useState<Record<string, 'start' | 'stop' | 'restart'>>({});
	const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
	
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

	const clearActionError = useCallback((id: string) => {
		setActionErrors((prev) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});
	}, []);

	const handleStartServer = useCallback(
		async (id: string) => {
			clearActionError(id);
			setPendingActions((prev) => ({ ...prev, [id]: 'start' }));
			try {
				const result = (await shell?.invoke('mcp:startServer', id)) as { ok?: boolean; error?: string } | undefined;
				if (result?.ok === false && result.error) {
					setActionErrors((prev) => ({ ...prev, [id]: result.error! }));
				}
			} finally {
				setPendingActions((prev) => {
					const next = { ...prev };
					delete next[id];
					return next;
				});
				await onRefreshStatuses();
			}
		},
		[shell, onRefreshStatuses, clearActionError]
	);

	const handleStopServer = useCallback(
		async (id: string) => {
			clearActionError(id);
			setPendingActions((prev) => ({ ...prev, [id]: 'stop' }));
			try {
				const result = (await shell?.invoke('mcp:stopServer', id)) as { ok?: boolean; error?: string } | undefined;
				if (result?.ok === false && result.error) {
					setActionErrors((prev) => ({ ...prev, [id]: result.error! }));
				}
			} finally {
				setPendingActions((prev) => {
					const next = { ...prev };
					delete next[id];
					return next;
				});
				await onRefreshStatuses();
			}
		},
		[shell, onRefreshStatuses, clearActionError]
	);

	const handleRestartServer = useCallback(
		async (id: string) => {
			clearActionError(id);
			setPendingActions((prev) => ({ ...prev, [id]: 'restart' }));
			try {
				const result = (await shell?.invoke('mcp:restartServer', id)) as { ok?: boolean; error?: string } | undefined;
				if (result?.ok === false && result.error) {
					setActionErrors((prev) => ({ ...prev, [id]: result.error! }));
				}
			} finally {
				setPendingActions((prev) => {
					const next = { ...prev };
					delete next[id];
					return next;
				});
				await onRefreshStatuses();
			}
		},
		[shell, onRefreshStatuses, clearActionError]
	);
	
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

	const listPluginServers = useCallback(async (): Promise<McpServerConfig[]> => {
		if (!shell) {
			return [];
		}
		try {
			const runtime = (await shell.invoke('plugins:getRuntimeState')) as PluginRuntimeState;
			return Array.isArray(runtime?.mcpServers) ? runtime.mcpServers : [];
		} catch {
			return [];
		}
	}, [shell]);

	const togglePluginServerEnabled = useCallback(async (config: McpServerConfig, enabled: boolean) => {
		if (!shell) {
			return;
		}
		setPendingPluginToggleIds((prev) => (prev.includes(config.id) ? prev : [...prev, config.id]));
		try {
			const current = (await shell.invoke('settings:get')) as { pluginMcpOverrides?: PluginMcpOverrideMap } | undefined;
			const nextOverrides: PluginMcpOverrideMap = { ...(current?.pluginMcpOverrides ?? {}) };
			nextOverrides[config.id] = {
				...(nextOverrides[config.id] ?? {}),
				enabled,
			};
			await shell.invoke('settings:set', { pluginMcpOverrides: nextOverrides });
			if (enabled) {
				await onRefreshStatuses();
			} else {
				await handleStopServer(config.id);
			}
			setPluginServers(await listPluginServers());
		} finally {
			setPendingPluginToggleIds((prev) => prev.filter((id) => id !== config.id));
		}
	}, [listPluginServers, onRefreshStatuses, handleStopServer, shell]);
	
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
			const next = await listPluginServers();
			if (!cancelled) {
				setPluginServers(next);
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
	}, [listPluginServers, shell]);
	
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
				<div className="ref-settings-mcp-mode-switch">
					<button
						type="button"
						className={editMode === 'visual' ? 'ref-settings-mcp-mode--active' : ''}
						onClick={() => setEditMode('visual')}
					>
						{t('mcp.visualMode')}
					</button>
					<button
						type="button"
						className={editMode === 'json' ? 'ref-settings-mcp-mode--active' : ''}
						onClick={() => setEditMode('json')}
					>
						{t('mcp.jsonMode')}
					</button>
				</div>
			</div>
			
			{showTemplates && editMode === 'visual' ? (
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

			{editMode === 'json' ? (
				<SettingsMcpJsonEditor
					servers={servers}
					onChangeServers={onChangeServers}
					templates={MCP_SERVER_TEMPLATES}
				/>
			) : null}
			
			{editingId && editingConfig && editMode === 'visual' ? (
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
			
			{editMode === 'visual' ? (
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
										onStart={() => handleStartServer(config.id)}
										onStop={() => handleStopServer(config.id)}
										onRestart={() => handleRestartServer(config.id)}
										onDelete={() => deleteServer(config.id)}
										pendingAction={pendingActions[config.id]}
										actionError={actionErrors[config.id] ?? null}
									/>
								</li>
							))}
						</ul>
					)}
				</section>
			) : null}

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
									onStart={() => handleStartServer(config.id)}
									onStop={() => handleStopServer(config.id)}
									onRestart={() => handleRestartServer(config.id)}
									onToggleEnabled={(next) => void togglePluginServerEnabled(config, next)}
									toggleBusy={pendingPluginToggleIds.includes(config.id)}
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
