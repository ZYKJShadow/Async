import type { ChangeEvent } from 'react';
import { NATIONALITY_OPTIONS } from '../domain/persona';
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
	modelOptions: { id: string; displayName: string }[];
	modelDisabled?: boolean;
	onChange: (patch: Partial<RoleProfileDraft>) => void;
}) {
	const bindText =
		(key: keyof RoleProfileDraft) =>
		(ev: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
			onChange({ [key]: ev.target.value } as Partial<RoleProfileDraft>);
		};

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
				<label className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.role.nationality')}</span>
					<select
						className="ref-ai-employees-workspace-select"
						value={draft.nationalityCode ?? ''}
						onChange={bindText('nationalityCode')}
					>
						<option value="">{t('aiEmployees.managerNone')}</option>
						{NATIONALITY_OPTIONS.map((option) => (
							<option key={option.code} value={option.code}>
								{option.label}
							</option>
						))}
					</select>
				</label>
				<div className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.role.localModel')}</span>
					<p className="ref-ai-employees-field-hint ref-ai-employees-muted">{t('aiEmployees.modelSource.localOnlyBlurb')}</p>
					<select
						className="ref-ai-employees-workspace-select"
						value={draft.localModelId}
						onChange={bindText('localModelId')}
						disabled={modelDisabled}
					>
						<option value="">{t('aiEmployees.localModelUseDefault')}</option>
						{modelOptions.map((option) => (
							<option key={option.id} value={option.id}>
								{option.displayName}
							</option>
						))}
					</select>
				</div>
				<label className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.role.jobMission')}</span>
					<textarea
						className="ref-ai-employees-input ref-ai-employees-textarea"
						rows={3}
						value={draft.jobMission}
						onChange={bindText('jobMission')}
					/>
				</label>
				<label className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.role.domainContext')}</span>
					<textarea
						className="ref-ai-employees-input ref-ai-employees-textarea"
						rows={3}
						value={draft.domainContext}
						onChange={bindText('domainContext')}
					/>
				</label>
				<label className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.role.communicationNotes')}</span>
					<textarea
						className="ref-ai-employees-input ref-ai-employees-textarea"
						rows={3}
						value={draft.communicationNotes}
						onChange={bindText('communicationNotes')}
					/>
				</label>
			</div>
		</div>
	);
}

export function RolePromptReview({
	t,
	draft,
	generating,
	error,
	onPromptChange,
	onGenerate,
	onRestore,
}: {
	t: TFunction;
	draft: RoleProfileDraft;
	generating: boolean;
	error?: string | null;
	onPromptChange: (value: string) => void;
	onGenerate: () => void;
	onRestore: () => void;
}) {
	return (
		<div className="ref-ai-employees-role-prompt-review">
			<div className="ref-ai-employees-role-prompt-toolbar">
				<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={onGenerate} disabled={generating}>
					{generating ? t('aiEmployees.role.generatingPrompt') : t('aiEmployees.role.generatePrompt')}
				</button>
				<button
					type="button"
					className="ref-ai-employees-btn ref-ai-employees-btn--ghost"
					onClick={onRestore}
					disabled={generating || !draft.lastGeneratedPromptDraft}
				>
					{t('aiEmployees.role.restorePrompt')}
				</button>
			</div>
			{error ? (
				<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
					{error}
				</div>
			) : null}
			<label className="ref-ai-employees-catalog-field">
				<span>{t('aiEmployees.orgCustomPrompt')}</span>
				<textarea
					className="ref-ai-employees-input ref-ai-employees-textarea"
					rows={10}
					value={draft.promptDraft.systemPrompt}
					onChange={(e) => onPromptChange(e.target.value)}
				/>
			</label>
			<div className="ref-ai-employees-role-prompt-grid">
				<div>
					<strong>{t('aiEmployees.role.promptSummary')}</strong>
					<p>{draft.promptDraft.roleSummary || '—'}</p>
				</div>
				<div>
					<strong>{t('aiEmployees.role.promptSpeaking')}</strong>
					<p>{draft.promptDraft.speakingStyle || '—'}</p>
				</div>
				<div>
					<strong>{t('aiEmployees.role.promptCollaboration')}</strong>
					<p>{draft.promptDraft.collaborationRules || '—'}</p>
				</div>
				<div>
					<strong>{t('aiEmployees.role.promptHandoff')}</strong>
					<p>{draft.promptDraft.handoffRules || '—'}</p>
				</div>
			</div>
		</div>
	);
}
