import { useState } from 'react';
import { useI18n } from './i18n';

type Props = {
	workspaceOpen: boolean;
	onCancel: () => void;
	onConfirm: (scope: 'user' | 'project') => void;
};

/** /create-subagent 发送前：选择子代理适用范围（与 Skill / Rule 向导同款：先选中再高亮，再点继续） */
export function SubagentScopeDialog({ workspaceOpen, onCancel, onConfirm }: Props) {
	const { t } = useI18n();
	const [scope, setScope] = useState<'user' | 'project'>('user');

	const canContinue = scope === 'user' || (scope === 'project' && workspaceOpen);

	return (
		<div className="ref-skill-scope" role="dialog" aria-label={t('subagentWizard.scopeAria')}>
			<div className="ref-skill-scope-head">
				<span className="ref-skill-scope-title">{t('subagentWizard.scopeTitle')}</span>
			</div>
			<p className="ref-skill-scope-desc">{t('subagentWizard.scopeDesc')}</p>
			<div className="ref-skill-scope-options" role="radiogroup">
				<button
					type="button"
					role="radio"
					aria-checked={scope === 'user'}
					className={`ref-skill-scope-opt ${scope === 'user' ? 'is-active' : ''}`}
					onClick={() => setScope('user')}
				>
					<span className="ref-skill-scope-opt-label">{t('subagentWizard.scopeAllProjects')}</span>
					<span className="ref-skill-scope-opt-hint">{t('subagentWizard.scopeAllHint')}</span>
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={scope === 'project'}
					className={`ref-skill-scope-opt ${scope === 'project' ? 'is-active' : ''}`}
					disabled={!workspaceOpen}
					title={!workspaceOpen ? t('subagentWizard.scopeProjectNeedWs') : undefined}
					onClick={() => workspaceOpen && setScope('project')}
				>
					<span className="ref-skill-scope-opt-label">{t('subagentWizard.scopeThisProject')}</span>
					<span className="ref-skill-scope-opt-hint">{t('subagentWizard.scopeProjectHint')}</span>
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
