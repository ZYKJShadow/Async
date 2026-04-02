import { useState } from 'react';
import { useI18n } from './i18n';

type Props = {
	workspaceOpen: boolean;
	onCancel: () => void;
	onConfirm: (scope: 'user' | 'project') => void;
};

export function SkillScopeDialog({ workspaceOpen, onCancel, onConfirm }: Props) {
	const { t } = useI18n();
	const [scope, setScope] = useState<'user' | 'project'>('user');

	const canContinue = scope === 'user' || (scope === 'project' && workspaceOpen);

	return (
		<div className="ref-skill-scope" role="dialog" aria-label={t('skillCreator.scopeAria')}>
			<div className="ref-skill-scope-head">
				<span className="ref-skill-scope-title">{t('skillCreator.scopeTitle')}</span>
			</div>
			<p className="ref-skill-scope-desc">{t('skillCreator.scopeDesc')}</p>
			<div className="ref-skill-scope-options" role="radiogroup">
				<button
					type="button"
					role="radio"
					aria-checked={scope === 'user'}
					className={`ref-skill-scope-opt ${scope === 'user' ? 'is-active' : ''}`}
					onClick={() => setScope('user')}
				>
					<span className="ref-skill-scope-opt-label">{t('skillCreator.scopeAllProjects')}</span>
					<span className="ref-skill-scope-opt-hint">{t('skillCreator.scopeAllHint')}</span>
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={scope === 'project'}
					className={`ref-skill-scope-opt ${scope === 'project' ? 'is-active' : ''}`}
					disabled={!workspaceOpen}
					title={!workspaceOpen ? t('skillCreator.scopeProjectNeedWs') : undefined}
					onClick={() => workspaceOpen && setScope('project')}
				>
					<span className="ref-skill-scope-opt-label">{t('skillCreator.scopeThisProject')}</span>
					<span className="ref-skill-scope-opt-hint">{t('skillCreator.scopeProjectHint')}</span>
				</button>
			</div>
			<div className="ref-skill-scope-foot">
				<button type="button" className="ref-skill-scope-btn ref-skill-scope-btn--ghost" onClick={onCancel}>
					{t('common.cancel')}
				</button>
				<button
					type="button"
					className="ref-skill-scope-btn ref-skill-scope-btn--primary"
					disabled={!canContinue}
					onClick={() => {
						if (canContinue) {
							onConfirm(scope);
						}
					}}
				>
					{t('common.continue')}
				</button>
			</div>
		</div>
	);
}
