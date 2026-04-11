import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { VoidSelect } from '../../VoidSelect';
import { formatLocalModelPickLabel } from '../adapters/modelAdapter';
import type { LocalModelEntry } from '../sessionTypes';
import type { RoleProfileDraft } from '../domain/roleDraft';
import type { TFunction } from '../../i18n';
import { notifyAiEmployeesRequestFailed } from '../AiEmployeesNetworkToast';
import {
	apiCreateChatBinding,
	apiDeleteChatBinding,
	apiListChatBindings,
	type AiEmployeesConnection,
} from '../api/client';
import type { ChatBindingJson, ChatBindingProvider } from '../api/types';

export function RoleProfileEditor({
	t,
	draft,
	modelOptions,
	modelDisabled,
	onChange,
	fieldGroup = 'all',
}: {
	t: TFunction;
	draft: RoleProfileDraft;
	modelOptions: LocalModelEntry[];
	modelDisabled?: boolean;
	onChange: (patch: Partial<RoleProfileDraft>) => void;
	/** `identityModel`：姓名、职位、本地模型；`personaPrompts`：岗位叙述与协作规则；默认全部。 */
	fieldGroup?: 'all' | 'identityModel' | 'personaPrompts';
}) {
	const bindText =
		(key: keyof RoleProfileDraft) =>
		(ev: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
			onChange({ [key]: ev.target.value } as Partial<RoleProfileDraft>);
		};
	const bindPromptText =
		(key: 'collaborationRules' | 'handoffRules') =>
		(ev: ChangeEvent<HTMLTextAreaElement>) => {
			onChange({
				promptDraft: {
					...draft.promptDraft,
					[key]: ev.target.value,
				},
			});
		};

	const modelSelectDisabled = Boolean(modelDisabled) || modelOptions.length === 0;

	const modelSelectOptions = useMemo(
		() => [
			{ value: '', label: t('aiEmployees.localModelPick'), disabled: true as const },
			...modelOptions.map((option) => ({
				value: option.id,
				label: formatLocalModelPickLabel(option),
			})),
		],
		[modelOptions, t]
	);

	const showIdentity = fieldGroup === 'all' || fieldGroup === 'identityModel';
	const showPersona = fieldGroup === 'all' || fieldGroup === 'personaPrompts';

	return (
		<div className="ref-ai-employees-role-editor">
			<div className="ref-ai-employees-catalog-fields">
				{showIdentity ? (
					<>
						<label className="ref-ai-employees-catalog-field">
							<span>{t('aiEmployees.employeeDisplayName')}</span>
							<input className="ref-ai-employees-input" value={draft.displayName} onChange={bindText('displayName')} />
						</label>
						<label className="ref-ai-employees-catalog-field">
							<span>{t('aiEmployees.orgCustomTitle')}</span>
							<input className="ref-ai-employees-input" value={draft.customRoleTitle} onChange={bindText('customRoleTitle')} />
						</label>
						<label className="ref-settings-field ref-settings-field--compact ref-ai-employees-role-model-field">
							<span>{t('aiEmployees.role.localModel')}</span>
							<p className="ref-settings-field-hint ref-ai-employees-muted">{t('aiEmployees.modelSource.localOnlyBlurb')}</p>
							{modelOptions.length === 0 ? (
								<p className="ref-settings-field-hint ref-ai-employees-muted" role="status">
									{t('aiEmployees.localModelMissingHint')}
								</p>
							) : null}
							<VoidSelect
								className="ref-ai-employees-model-void-select"
								ariaLabel={t('aiEmployees.role.localModel')}
								value={draft.localModelId || ''}
								disabled={modelSelectDisabled}
								onChange={(next) => onChange({ localModelId: next })}
								options={modelSelectOptions}
							/>
						</label>
					</>
				) : null}
				{showPersona ? (
					<>
				<label className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.role.jobMission')}</span>
					<textarea className="ref-ai-employees-input ref-ai-employees-textarea" rows={3} value={draft.jobMission} onChange={bindText('jobMission')} />
				</label>
				<label className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.role.domainContext')}</span>
					<textarea className="ref-ai-employees-input ref-ai-employees-textarea" rows={3} value={draft.domainContext} onChange={bindText('domainContext')} />
				</label>
				<label className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.role.communicationNotes')}</span>
					<textarea className="ref-ai-employees-input ref-ai-employees-textarea" rows={3} value={draft.communicationNotes} onChange={bindText('communicationNotes')} />
				</label>
				<label className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.role.collaborationRules')}</span>
					<textarea
						className="ref-ai-employees-input ref-ai-employees-textarea"
						rows={3}
						value={draft.promptDraft.collaborationRules}
						onChange={bindPromptText('collaborationRules')}
					/>
				</label>
				<label className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.role.handoffRules')}</span>
					<textarea
						className="ref-ai-employees-input ref-ai-employees-textarea"
						rows={3}
						value={draft.promptDraft.handoffRules}
						onChange={bindPromptText('handoffRules')}
					/>
				</label>
					</>
				) : null}
			</div>
		</div>
	);
}

// ── IM 机器人绑定 UI ────────────────────────────────────────────────────────────

type ProviderMeta = {
	value: ChatBindingProvider;
	label: string;
	tokenLabel: string;
	tokenPlaceholder: string;
	tokenHint: string;
};

const IM_PROVIDERS: ProviderMeta[] = [
	{
		value: 'telegram',
		label: 'Telegram',
		tokenLabel: 'Bot Token',
		tokenPlaceholder: '110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
		tokenHint: 'aiEmployees.imBindings.telegramTokenHint',
	},
	{
		value: 'feishu',
		label: '飞书 (Feishu)',
		tokenLabel: 'App ID',
		tokenPlaceholder: 'cli_xxxxxxxxxx',
		tokenHint: 'aiEmployees.imBindings.feishuTokenHint',
	},
	{
		value: 'discord',
		label: 'Discord',
		tokenLabel: 'Bot Token',
		tokenPlaceholder: 'MTAxNjE...',
		tokenHint: 'aiEmployees.imBindings.discordTokenHint',
	},
];

/**
 * IM 机器人绑定面板。
 *
 * 每个 AI 员工可以绑定最多 3 个平台的机器人，但同时只能启用 1 个。
 * 绑定后，该员工即拥有自己的 IM 机器人身份，可以在对应平台上与外部用户互动。
 */
export function ImBindingsSection({
	t,
	conn,
	workspaceId,
	employeeId,
}: {
	t: TFunction;
	conn: AiEmployeesConnection;
	workspaceId: string;
	employeeId: string;
}) {
	const [bindings, setBindings] = useState<ChatBindingJson[]>([]);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	// Editing state for a specific provider
	const [editProvider, setEditProvider] = useState<ChatBindingProvider | null>(null);
	const [editToken, setEditToken] = useState('');

	const fetchBindings = useCallback(async () => {
		if (!workspaceId || !employeeId) return;
		setLoading(true);
		try {
			const list = await apiListChatBindings(conn, workspaceId, employeeId);
			setBindings(list);
		} catch {
			// ignore
		} finally {
			setLoading(false);
		}
	}, [conn, workspaceId, employeeId]);

	useEffect(() => {
		void fetchBindings();
	}, [fetchBindings]);

	const bindingByProvider = useMemo(() => {
		const map = new Map<ChatBindingProvider, ChatBindingJson>();
		for (const b of bindings) map.set(b.provider, b);
		return map;
	}, [bindings]);

	const handleSaveBinding = async (provider: ChatBindingProvider, token: string) => {
		if (!token.trim()) {
			setErr(t('aiEmployees.imBindings.tokenRequired'));
			return;
		}
		setSaving(true);
		setErr(null);
		try {
			// Upsert: backend does ON CONFLICT per (workspace, employee, provider)
			const binding = await apiCreateChatBinding(conn, workspaceId, employeeId, {
				provider,
				external_user_id: token.trim(),
				config: { bot_token: token.trim() },
			});
			setBindings((prev) => [...prev.filter((b) => b.provider !== provider), binding]);
			setEditProvider(null);
			setEditToken('');
		} catch (e) {
			notifyAiEmployeesRequestFailed(e);
		} finally {
			setSaving(false);
		}
	};

	const handleActivate = async (provider: ChatBindingProvider) => {
		const binding = bindingByProvider.get(provider);
		if (!binding) return;
		// Re-save with same data — the backend activates the most recent upsert.
		// To properly toggle, we'd need a PATCH endpoint; for now re-create triggers upsert.
		setSaving(true);
		try {
			const updated = await apiCreateChatBinding(conn, workspaceId, employeeId, {
				provider,
				external_user_id: binding.external_user_id,
				config: binding.config,
			});
			// Deactivate others client-side (server enforces via status logic)
			setBindings((prev) =>
				prev.map((b) =>
					b.provider === provider
						? updated
						: { ...b, status: 'disabled' as const }
				)
			);
		} catch (e) {
			notifyAiEmployeesRequestFailed(e);
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (provider: ChatBindingProvider) => {
		const binding = bindingByProvider.get(provider);
		if (!binding) return;
		try {
			await apiDeleteChatBinding(conn, workspaceId, employeeId, binding.id);
			setBindings((prev) => prev.filter((b) => b.provider !== provider));
		} catch (e) {
			notifyAiEmployeesRequestFailed(e);
		}
	};

	return (
		<div className="ref-ai-employees-im-bindings">
			<div className="ref-ai-employees-im-bindings-head">
				<span className="ref-ai-employees-im-bindings-title">{t('aiEmployees.imBindings.title')}</span>
			</div>
			<p className="ref-ai-employees-muted" style={{ margin: '4px 0 10px' }}>
				{t('aiEmployees.imBindings.desc')}
			</p>

			{loading ? (
				<p className="ref-ai-employees-muted">{t('common.loading')}</p>
			) : (
				<div className="ref-ai-employees-im-channel-list">
					{IM_PROVIDERS.map((pm) => {
						const existing = bindingByProvider.get(pm.value);
						const isActive = existing?.status === 'active';
						const isEditing = editProvider === pm.value;

						return (
							<div
								key={pm.value}
								className={`ref-ai-employees-im-channel-card ${isActive ? 'is-active' : ''}`}
							>
								<div className="ref-ai-employees-im-channel-card-head">
									<span className="ref-ai-employees-im-channel-card-name">{pm.label}</span>
									{existing ? (
										<span className={`ref-ai-employees-pill ref-ai-employees-pill--${isActive ? 'ok' : 'muted'}`}>
											{isActive ? t('aiEmployees.imBindings.statusActive') : t('aiEmployees.imBindings.statusDisabled')}
										</span>
									) : (
										<span className="ref-ai-employees-pill ref-ai-employees-pill--muted">
											{t('aiEmployees.imBindings.statusUnbound')}
										</span>
									)}
								</div>

								{existing && !isEditing ? (
									<div className="ref-ai-employees-im-channel-card-body">
										<span className="ref-ai-employees-muted" style={{ fontSize: 12 }}>
											{pm.tokenLabel}: {existing.external_user_id.slice(0, 12)}{'…'}
										</span>
										<div className="ref-ai-employees-im-channel-card-actions">
											{!isActive ? (
												<button
													type="button"
													className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-btn--sm"
													disabled={saving}
													onClick={() => void handleActivate(pm.value)}
												>
													{t('aiEmployees.imBindings.activate')}
												</button>
											) : null}
											<button
												type="button"
												className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-btn--sm"
												onClick={() => {
													setEditProvider(pm.value);
													setEditToken(existing.external_user_id);
													setErr(null);
												}}
											>
												{t('aiEmployees.imBindings.edit')}
											</button>
											<button
												type="button"
												className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-btn--sm"
												style={{ color: '#f85149' }}
												onClick={() => void handleDelete(pm.value)}
											>
												{t('aiEmployees.imBindings.unbind')}
											</button>
										</div>
									</div>
								) : null}

								{isEditing || !existing ? (
									<div className="ref-ai-employees-im-channel-card-form">
										<label className="ref-ai-employees-catalog-field" style={{ marginTop: 6 }}>
											<span>{pm.tokenLabel}</span>
											<input
												className="ref-ai-employees-input"
												type="password"
												autoComplete="off"
												placeholder={pm.tokenPlaceholder}
												value={isEditing ? editToken : ''}
												onChange={(e) => {
													if (!isEditing) {
														setEditProvider(pm.value);
													}
													setEditToken(e.target.value);
												}}
												onFocus={() => {
													if (!isEditing) {
														setEditProvider(pm.value);
														setEditToken('');
													}
												}}
											/>
											<span className="ref-ai-employees-field-hint ref-ai-employees-muted">
												{t(pm.tokenHint)}
											</span>
										</label>
										{err && editProvider === pm.value ? (
											<p className="ref-ai-employees-error">{err}</p>
										) : null}
										{isEditing ? (
											<div className="ref-ai-employees-form-actions" style={{ marginTop: 4 }}>
												<button
													type="button"
													className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-btn--sm"
													disabled={saving || !editToken.trim()}
													onClick={() => void handleSaveBinding(pm.value, editToken)}
												>
													{saving ? t('common.saving') : t('aiEmployees.imBindings.bind')}
												</button>
												<button
													type="button"
													className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-btn--sm"
													onClick={() => {
														setEditProvider(null);
														setEditToken('');
														setErr(null);
													}}
												>
													{t('common.cancel')}
												</button>
											</div>
										) : null}
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

export function RoleCustomSystemPromptField({
	t,
	value,
	onChange,
	disabled,
	generating,
	generateDisabled,
	onGenerate,
	onRestore,
	canRestore,
}: {
	t: TFunction;
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	generating?: boolean;
	/** 为 true 时禁用「生成」（例如未绑定本地模型） */
	generateDisabled?: boolean;
	onGenerate?: () => void;
	onRestore?: () => void;
	canRestore?: boolean;
}) {
	const showToolbar = Boolean(onGenerate || onRestore);
	return (
		<div className="ref-ai-employees-role-prompt-block">
			{showToolbar ? (
				<div className="ref-ai-employees-role-prompt-toolbar">
					{onGenerate ? (
						<p className="ref-settings-field-hint ref-ai-employees-muted ref-ai-employees-role-generate-hint">
							{t('aiEmployees.role.generateUsesBoundModel')}
						</p>
					) : null}
					<div className="ref-ai-employees-form-actions">
						{onGenerate ? (
							<button
								type="button"
								className="ref-ai-employees-btn ref-ai-employees-btn--secondary"
								onClick={onGenerate}
								disabled={disabled || generating || generateDisabled}
							>
								{generating ? t('aiEmployees.role.generatingPrompt') : t('aiEmployees.role.generatePrompt')}
							</button>
						) : null}
						{onRestore ? (
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost" onClick={onRestore} disabled={disabled || generating || !canRestore}>
								{t('aiEmployees.role.restorePrompt')}
							</button>
						) : null}
					</div>
				</div>
			) : null}
			<label className="ref-ai-employees-catalog-field">
				<span>{t('aiEmployees.orgCustomPrompt')}</span>
				<textarea
					className="ref-ai-employees-input ref-ai-employees-textarea"
					rows={10}
					value={value}
					disabled={disabled}
					onChange={(e) => onChange(e.target.value)}
				/>
			</label>
		</div>
	);
}
