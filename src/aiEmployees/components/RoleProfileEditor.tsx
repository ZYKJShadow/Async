import type { ChangeEvent } from 'react';
import { MbtiAvatar, mbtiVisualRegistry } from '../domain/mbtiVisuals';
import { MBTI_TYPES, NATIONALITY_OPTIONS } from '../domain/persona';
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
	const meta = draft.mbtiType ? mbtiVisualRegistry[draft.mbtiType] : null;

	const bindText =
		(key: keyof RoleProfileDraft) =>
		(ev: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
			onChange({ [key]: ev.target.value } as Partial<RoleProfileDraft>);
		};

	return (
		<div className="ref-ai-employees-role-editor">
			<div className="ref-ai-employees-role-editor-hero">
				<MbtiAvatar mbtiType={draft.mbtiType} size={88} />
				<div className="ref-ai-employees-role-editor-hero-copy">
					<strong>{draft.mbtiType ? `${draft.mbtiType} · ${meta?.label ?? ''}` : t('aiEmployees.role.mbti')}</strong>
					<div className="ref-ai-employees-muted">
						{meta?.shortTraits.join(' · ') || t('aiEmployees.role.mbtiHint')}
					</div>
				</div>
			</div>

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
								{option.label} · {option.styleLabel}
							</option>
						))}
					</select>
				</label>
				<label className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.role.mbti')}</span>
					<select className="ref-ai-employees-workspace-select" value={draft.mbtiType ?? ''} onChange={bindText('mbtiType')}>
						<option value="">{t('aiEmployees.managerNone')}</option>
						{MBTI_TYPES.map((type) => (
							<option key={type} value={type}>
								{type} · {mbtiVisualRegistry[type].label}
							</option>
						))}
					</select>
				</label>
				<label className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.modelSource')}</span>
					<select className="ref-ai-employees-workspace-select" value={draft.modelSource} onChange={bindText('modelSource')}>
						<option value="local_model">{t('aiEmployees.modelSource.local')}</option>
						<option value="remote_runtime">{t('aiEmployees.modelSource.remote')}</option>
						<option value="hybrid">{t('aiEmployees.modelSource.hybrid')}</option>
					</select>
				</label>
				<label className="ref-ai-employees-catalog-field">
					<span>{t('aiEmployees.role.localModel')}</span>
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
				</label>
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
