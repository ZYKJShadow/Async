import type { HiringPlanCandidate, NationalityCode, RolePersonaSeed, RolePromptDraft } from './persona';
import { emptyPromptDraft } from './persona';
import type { OrgEmployee } from '../api/orgTypes';

export type ModelSource = 'local_model' | 'remote_runtime' | 'hybrid';

export type RoleProfileDraft = {
	id?: string;
	displayName: string;
	roleKey: string;
	customRoleTitle: string;
	nationalityCode?: NationalityCode | null;
	modelSource: ModelSource;
	localModelId: string;
	jobMission: string;
	domainContext: string;
	communicationNotes: string;
	managerEmployeeId?: string;
	createdByEmployeeId?: string;
	templatePromptKey?: string;
	promptDraft: RolePromptDraft;
	lastGeneratedPromptDraft?: RolePromptDraft | null;
	reason?: string;
	rejected?: boolean;
};

export function createEmptyRoleProfileDraft(
	partial?: Partial<RoleProfileDraft>,
	defaults?: Partial<RoleProfileDraft>
): RoleProfileDraft {
	const base: RoleProfileDraft = {
		displayName: '',
		roleKey: 'custom',
		customRoleTitle: '',
		nationalityCode: 'CN',
		modelSource: 'local_model',
		localModelId: '',
		jobMission: '',
		domainContext: '',
		communicationNotes: '',
		promptDraft: emptyPromptDraft(),
		lastGeneratedPromptDraft: null,
	};
	const merged = { ...base, ...defaults, ...partial };
	return {
		...merged,
		promptDraft: partial?.promptDraft ?? defaults?.promptDraft ?? base.promptDraft,
		lastGeneratedPromptDraft:
			partial?.lastGeneratedPromptDraft ?? defaults?.lastGeneratedPromptDraft ?? partial?.promptDraft ?? null,
	};
}

export function toPersonaSeed(draft: RoleProfileDraft, generatedBy: RolePersonaSeed['generatedBy']): RolePersonaSeed {
	return {
		nationalityCode: draft.nationalityCode ?? undefined,
		jobMission: draft.jobMission.trim(),
		domainContext: draft.domainContext.trim(),
		communicationNotes: draft.communicationNotes.trim(),
		hiringReason: draft.reason?.trim() || undefined,
		generatedBy,
	};
}

export function applyGeneratedPromptDraft(draft: RoleProfileDraft, promptDraft: RolePromptDraft): RoleProfileDraft {
	return {
		...draft,
		promptDraft,
		lastGeneratedPromptDraft: promptDraft,
	};
}

export function createRoleDraftFromHiringCandidate(candidate: HiringPlanCandidate): RoleProfileDraft {
	return createEmptyRoleProfileDraft({
		id: candidate.id,
		displayName: candidate.displayName,
		roleKey: candidate.roleKey,
		customRoleTitle: candidate.customRoleTitle ?? '',
		nationalityCode: candidate.nationalityCode ?? 'CN',
		modelSource: 'local_model',
		managerEmployeeId: candidate.managerEmployeeId,
		jobMission: candidate.jobMission ?? '',
		domainContext: candidate.domainContext ?? '',
		communicationNotes: candidate.communicationNotes ?? '',
		promptDraft: candidate.promptDraft,
		lastGeneratedPromptDraft: candidate.promptDraft,
		reason: candidate.reason,
	});
}

export function createRoleDraftFromOrgEmployee(employee: OrgEmployee, localModelId = ''): RoleProfileDraft {
	return createEmptyRoleProfileDraft({
		id: employee.id,
		displayName: employee.displayName,
		roleKey: employee.roleKey,
		customRoleTitle: employee.customRoleTitle ?? '',
		nationalityCode: employee.nationalityCode ?? 'CN',
		modelSource: 'local_model',
		localModelId,
		managerEmployeeId: employee.managerEmployeeId ?? undefined,
		createdByEmployeeId: employee.createdByEmployeeId ?? undefined,
		templatePromptKey: employee.templatePromptKey ?? undefined,
		jobMission: employee.personaSeed?.jobMission ?? '',
		domainContext: employee.personaSeed?.domainContext ?? '',
		communicationNotes: employee.personaSeed?.communicationNotes ?? '',
		promptDraft: {
			systemPrompt: employee.customSystemPrompt ?? '',
			roleSummary: '',
			speakingStyle: '',
			collaborationRules: '',
			handoffRules: '',
		},
		lastGeneratedPromptDraft: employee.customSystemPrompt
			? {
					systemPrompt: employee.customSystemPrompt,
					roleSummary: '',
					speakingStyle: '',
					collaborationRules: '',
					handoffRules: '',
			  }
			: null,
	});
}
