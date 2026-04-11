import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from '../../i18n';
import { IconFileDoc, IconPlus, IconTrash } from '../../icons';
import { notifyAiEmployeesRequestFailed } from '../AiEmployeesNetworkToast';
import type { AiEmployeesConnection } from '../api/client';
import { apiListAgentSkills, apiSetAgentSkills } from '../api/client';
import type { OrgEmployee } from '../api/orgTypes';
import type { SkillJson } from '../api/types';

export function EmployeeSkillsTab({
	t,
	conn,
	workspaceId,
	employee,
	allSkills,
	onRefreshSkills,
}: {
	t: TFunction;
	conn: AiEmployeesConnection;
	workspaceId: string;
	employee: OrgEmployee;
	allSkills: SkillJson[];
	onRefreshSkills: () => void | Promise<void>;
}) {
	const agentId = employee.linkedRemoteAgentId;
	const [assigned, setAssigned] = useState<SkillJson[]>([]);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);

	const load = useCallback(async () => {
		if (!workspaceId || !agentId) {
			setAssigned([]);
			return;
		}
		setLoading(true);
		try {
			setAssigned(await apiListAgentSkills(conn, workspaceId, agentId));
		} catch (e) {
			notifyAiEmployeesRequestFailed(e);
			setAssigned([]);
		} finally {
			setLoading(false);
		}
	}, [agentId, conn, workspaceId]);

	useEffect(() => {
		void load();
	}, [load]);

	const assignedIds = useMemo(() => new Set(assigned.map((s) => s.id)), [assigned]);

	const availableToAdd = useMemo(() => allSkills.filter((s) => !assignedIds.has(s.id)), [allSkills, assignedIds]);

	const persistIds = useCallback(
		async (ids: string[]): Promise<boolean> => {
			if (!agentId) {
				return false;
			}
			setSaving(true);
			try {
				await apiSetAgentSkills(conn, workspaceId, agentId, { skill_ids: ids });
				await load();
				void onRefreshSkills();
				return true;
			} catch (e) {
				notifyAiEmployeesRequestFailed(e);
				return false;
			} finally {
				setSaving(false);
			}
		},
		[agentId, conn, load, onRefreshSkills, workspaceId]
	);

	const remove = async (skillId: string) => {
		const next = assigned.filter((s) => s.id !== skillId).map((s) => s.id);
		await persistIds(next);
	};

	const add = async (skillId: string) => {
		const next = [...assigned.map((s) => s.id), skillId];
		const ok = await persistIds(next);
		if (ok) {
			setPickerOpen(false);
		}
	};

	const pickerOverlay =
		pickerOpen &&
		(() => {
			const node = (
				<div className="ref-ai-employees-create-dialog-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !saving && setPickerOpen(false)}>
					<div className="ref-ai-employees-create-dialog ref-ai-employees-employee-skill-picker" role="dialog" aria-modal aria-labelledby="ref-ai-employees-emp-skill-picker-title">
						<h2 id="ref-ai-employees-emp-skill-picker-title" className="ref-ai-employees-create-dialog-title">
							{t('aiEmployees.employee.addSkillModalTitle')}
						</h2>
						<p className="ref-ai-employees-skill-create-desc">{t('aiEmployees.employee.addSkillModalDesc')}</p>
						<div className="ref-ai-employees-employee-skill-picker-list">
							{availableToAdd.map((skill) => (
								<button
									key={skill.id}
									type="button"
									className="ref-ai-employees-employee-skill-picker-row"
									disabled={saving}
									onClick={() => void add(skill.id)}
								>
									<IconFileDoc className="ref-ai-employees-employee-skill-picker-row-icon" />
									<span className="ref-ai-employees-employee-skill-picker-row-text">
										<span className="ref-ai-employees-employee-skill-picker-row-name">{skill.name}</span>
										{skill.description ? <span className="ref-ai-employees-muted ref-ai-employees-employee-skill-picker-row-desc">{skill.description}</span> : null}
									</span>
								</button>
							))}
							{availableToAdd.length === 0 ? <p className="ref-ai-employees-employee-skill-picker-empty">{t('aiEmployees.employee.allSkillsAssigned')}</p> : null}
						</div>
						<div className="ref-ai-employees-create-dialog-actions">
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" disabled={saving} onClick={() => setPickerOpen(false)}>
								{t('common.cancel')}
							</button>
						</div>
					</div>
				</div>
			);
			const host = typeof document !== 'undefined' ? document.getElementById('ref-ai-employees-inset-modal-host') : null;
			return host ? createPortal(node, host) : node;
		})();

	if (!agentId) {
		return <p className="ref-ai-employees-muted">{t('aiEmployees.employee.linkAgentFirst')}</p>;
	}

	return (
		<div className="ref-ai-employees-employee-skills">
			<div className="ref-ai-employees-employee-skills-intro">
				<div>
					<h3 className="ref-ai-employees-employee-skills-title">{t('aiEmployees.employee.skillsTab')}</h3>
					<p className="ref-ai-employees-muted ref-ai-employees-employee-skills-sub">{t('aiEmployees.employee.skillsIntro')}</p>
				</div>
				<button
					type="button"
					className="ref-ai-employees-btn ref-ai-employees-btn--sm ref-ai-employees-btn--secondary"
					disabled={saving || availableToAdd.length === 0}
					onClick={() => setPickerOpen(true)}
				>
					<IconPlus />
					{t('aiEmployees.employee.addSkill')}
				</button>
			</div>

			{loading ? <p className="ref-ai-employees-muted">…</p> : null}

			{!loading && assigned.length === 0 ? (
				<div className="ref-ai-employees-employee-skills-empty">
					<IconFileDoc className="ref-ai-employees-employee-skills-empty-icon" />
					<p className="ref-ai-employees-employee-skills-empty-title">{t('aiEmployees.employee.noSkills')}</p>
					<p className="ref-ai-employees-muted ref-ai-employees-employee-skills-empty-sub">{t('aiEmployees.employee.noSkillsSubtitle')}</p>
					{availableToAdd.length > 0 ? (
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-btn--sm" disabled={saving} onClick={() => setPickerOpen(true)}>
							<IconPlus />
							{t('aiEmployees.employee.addSkill')}
						</button>
					) : null}
				</div>
			) : null}

			{!loading && assigned.length > 0 ? (
				<ul className="ref-ai-employees-skill-card-list">
					{assigned.map((s) => (
						<li key={s.id} className="ref-ai-employees-skill-card">
							<span className="ref-ai-employees-skill-card-icon" aria-hidden>
								<IconFileDoc />
							</span>
							<div className="ref-ai-employees-skill-card-body">
								<span className="ref-ai-employees-skill-card-name">{s.name}</span>
								{s.description ? <span className="ref-ai-employees-muted ref-ai-employees-skill-card-desc">{s.description}</span> : null}
							</div>
							<button
								type="button"
								className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-btn--sm ref-ai-employees-skill-card-remove"
								disabled={saving}
								onClick={() => void remove(s.id)}
								title={t('aiEmployees.employee.removeSkill')}
							>
								<IconTrash />
							</button>
						</li>
					))}
				</ul>
			) : null}

			{pickerOverlay}
		</div>
	);
}
