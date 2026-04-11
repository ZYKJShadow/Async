import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { VoidSelect } from '../../VoidSelect';
import { formatLocalModelPickLabel } from '../adapters/modelAdapter';
import type { LocalModelEntry } from '../sessionTypes';
import type { RoleProfileDraft } from '../domain/roleDraft';
import type { TFunction } from '../../i18n';
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
}: {
	t: TFunction;
	draft: RoleProfileDraft;
	modelOptions: LocalModelEntry[];
	modelDisabled?: boolean;
	onChange: (patch: Partial<RoleProfileDraft>) => void;
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

	return (
		<div className="ref-ai-employees-role-editor">
			<div className="ref-ai-employees-catalog-fields">
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
			</div>
		</div>
	);
}

// ── IM 账号绑定 UI ─────────────────────────────────────────────────────────────

const IM_PROVIDERS: { value: ChatBindingProvider; label: string }[] = [
	{ value: 'telegram', label: 'Telegram' },
	{ value: 'feishu', label: '飞书 (Feishu)' },
	{ value: 'discord', label: 'Discord' },
];

/**
 * IM 联系方式绑定面板 — 显示员工已绑定的 IM 账号，并支持添加/删除。
 * 放置于角色编辑器旁侧，或嵌入详情抽屉。
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
	const [addOpen, setAddOpen] = useState(false);
	const [addProvider, setAddProvider] = useState<ChatBindingProvider>('telegram');
	const [addUserId, setAddUserId] = useState('');
	const [addHandle, setAddHandle] = useState('');
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const fetchBindings = useCallback(async () => {
		if (!workspaceId || !employeeId) return;
		setLoading(true);
		try {
			const list = await apiListChatBindings(conn, workspaceId, employeeId);
			setBindings(list);
		} catch {
			// ignore transient errors
		} finally {
			setLoading(false);
		}
	}, [conn, workspaceId, employeeId]);

	useEffect(() => {
		void fetchBindings();
	}, [fetchBindings]);

	const handleAdd = async () => {
		if (!addUserId.trim()) {
			setErr('external_user_id required');
			return;
		}
		setSaving(true);
		setErr(null);
		try {
			const binding = await apiCreateChatBinding(conn, workspaceId, employeeId, {
				provider: addProvider,
				external_user_id: addUserId.trim(),
				external_handle: addHandle.trim() || undefined,
			});
			setBindings((prev) => [...prev.filter((b) => b.provider !== addProvider), binding]);
			setAddOpen(false);
			setAddUserId('');
			setAddHandle('');
		} catch (e) {
			setErr(e instanceof Error ? e.message : 'save failed');
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (bindingId: string) => {
		try {
			await apiDeleteChatBinding(conn, workspaceId, employeeId, bindingId);
			setBindings((prev) => prev.filter((b) => b.id !== bindingId));
		} catch {
			// ignore
		}
	};

	return (
		<div className="ref-ai-employees-im-bindings">
			<div className="ref-ai-employees-im-bindings-head">
				<span className="ref-ai-employees-im-bindings-title">{t('aiEmployees.imBindings.title')}</span>
				<button
					type="button"
					className="ref-ai-employees-btn ref-ai-employees-btn--secondary ref-ai-employees-btn--sm"
					onClick={() => setAddOpen((v) => !v)}
				>
					{addOpen ? t('common.cancel') : t('aiEmployees.imBindings.add')}
				</button>
			</div>

			{addOpen ? (
				<div className="ref-ai-employees-im-bindings-form">
					<label className="ref-ai-employees-catalog-field">
						<span>{t('aiEmployees.imBindings.providerLabel')}</span>
						<select
							className="ref-ai-employees-input"
							value={addProvider}
							onChange={(e) => setAddProvider(e.target.value as ChatBindingProvider)}
						>
							{IM_PROVIDERS.map((p) => (
								<option key={p.value} value={p.value}>
									{p.label}
								</option>
							))}
						</select>
					</label>
					<label className="ref-ai-employees-catalog-field">
						<span>{t('aiEmployees.imBindings.externalUserIdLabel')}</span>
						<input
							className="ref-ai-employees-input"
							placeholder={t('aiEmployees.imBindings.externalUserIdPh')}
							value={addUserId}
							onChange={(e) => setAddUserId(e.target.value)}
						/>
					</label>
					<label className="ref-ai-employees-catalog-field">
						<span>{t('aiEmployees.imBindings.handleLabel')}</span>
						<input
							className="ref-ai-employees-input"
							placeholder={t('aiEmployees.imBindings.handlePh')}
							value={addHandle}
							onChange={(e) => setAddHandle(e.target.value)}
						/>
					</label>
					{err ? <p className="ref-ai-employees-error">{err}</p> : null}
					<div className="ref-ai-employees-form-actions">
						<button
							type="button"
							className="ref-ai-employees-btn ref-ai-employees-btn--primary"
							disabled={saving || !addUserId.trim()}
							onClick={() => void handleAdd()}
						>
							{saving ? t('common.saving') : t('common.save')}
						</button>
					</div>
				</div>
			) : null}

			{loading ? (
				<p className="ref-ai-employees-muted ref-ai-employees-im-bindings-loading">
					{t('common.loading')}
				</p>
			) : bindings.length === 0 ? (
				<p className="ref-ai-employees-muted ref-ai-employees-im-bindings-empty">
					{t('aiEmployees.imBindings.none')}
				</p>
			) : (
				<ul className="ref-ai-employees-im-bindings-list">
					{bindings.map((b) => (
						<li key={b.id} className="ref-ai-employees-im-bindings-item">
							<span className="ref-ai-employees-im-bindings-provider">{b.provider}</span>
							<span className="ref-ai-employees-im-bindings-uid">
								{b.external_handle ? `@${b.external_handle}` : b.external_user_id}
							</span>
							<span
								className={`ref-ai-employees-pill ref-ai-employees-pill--${b.status === 'active' ? 'ok' : 'warn'}`}
							>
								{b.status}
							</span>
							<button
								type="button"
								className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-btn--sm"
								onClick={() => void handleDelete(b.id)}
								aria-label={t('common.delete')}
							>
								×
							</button>
						</li>
					))}
				</ul>
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
