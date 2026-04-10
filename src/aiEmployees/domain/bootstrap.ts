import type { OrgBootstrapStatus } from '../api/orgTypes';

export type AiEmployeesOnboardingStep =
	| 'pick_workspace'
	| 'company'
	| 'ceo_profile'
	| 'ceo_prompt_review'
	| 'team_setup'
	| 'team_review'
	| 'finish';

/** 根据后端 bootstrap 状态推导向导步骤（阻塞式首启） */
export function resolveOnboardingStep(status: OrgBootstrapStatus, hasWorkspaceId: boolean): AiEmployeesOnboardingStep {
	if (!hasWorkspaceId) {
		return 'pick_workspace';
	}
	const hasCompany = status.hasOrgProfile && Boolean(status.companyName?.trim());
	if (!hasCompany) {
		return 'company';
	}
	if (!status.hasCeo) {
		return 'ceo_profile';
	}
	if (!status.templatesConfirmed) {
		return 'team_setup';
	}
	if (!status.onboardingCompleted) {
		return 'finish';
	}
	return 'finish';
}

export function onboardingBlocksDashboard(status: OrgBootstrapStatus | null): boolean {
	if (!status) {
		return false;
	}
	return !status.onboardingCompleted;
}
