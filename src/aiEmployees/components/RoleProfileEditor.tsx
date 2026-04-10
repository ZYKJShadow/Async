import type { ChangeEvent } from 'react';
import { useMemo } from 'react';
import { VoidSelect } from '../../VoidSelect';
import { formatLocalModelPickLabel } from '../adapters/modelAdapter';
import type { LocalModelEntry } from '../sessionTypes';
import type { RoleProfileDraft } from '../domain/roleDraft';
import type { TFunction } from '../../i18n';

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
