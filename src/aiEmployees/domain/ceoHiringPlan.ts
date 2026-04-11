import type { HiringPlanCandidate } from '../../../shared/aiEmployeesPersona';
import type { OrgEmployee } from '../api/orgTypes';
import { createRoleDraftFromHiringCandidate, type RoleProfileDraft } from './roleDraft';

/** Minimal shell surface for IPC `aiEmployees:generateHiringPlan`. */
export type CeoHiringPlanShell = {
	invoke: (channel: string, payload: unknown) => Promise<unknown>;
};

export async function invokeGenerateHiringPlanForOrg(
	shell: CeoHiringPlanShell,
	input: {
		modelId: string;
		companyName: string;
		ceoDisplayName: string;
		ceoPersonaSeed: OrgEmployee['personaSeed'];
		ceoSystemPrompt: string;
		userRequirements?: string;
		currentEmployees: OrgEmployee[];
	}
): Promise<{ ok: true; candidates: HiringPlanCandidate[] } | { ok: false; error: string }> {
	const result = (await shell.invoke('aiEmployees:generateHiringPlan', {
		modelId: input.modelId,
		companyName: input.companyName,
		ceoDisplayName: input.ceoDisplayName,
		ceoPersonaSeed: input.ceoPersonaSeed ?? null,
		ceoSystemPrompt: input.ceoSystemPrompt,
		...(input.userRequirements?.trim() ? { userRequirements: input.userRequirements.trim() } : {}),
		currentEmployees: input.currentEmployees.map((e) => ({
			id: e.id,
			displayName: e.displayName,
			roleKey: e.roleKey,
			customRoleTitle: e.customRoleTitle,
			isCeo: e.isCeo,
			nationalityCode: e.nationalityCode,
		})),
	})) as { ok?: boolean; candidates?: HiringPlanCandidate[]; error?: string };
	if (!result.ok || !result.candidates?.length) {
		return { ok: false, error: result.error ?? 'empty' };
	}
	return { ok: true, candidates: result.candidates };
}

/** Map hiring candidates to member drafts (excludes CEO), binding `localModelId`. */
export function mapHiringCandidatesToMemberDrafts(candidates: HiringPlanCandidate[], modelId: string): RoleProfileDraft[] {
	return candidates
		.filter((c) => c.roleKey !== 'ceo' && c.displayName?.trim())
		.map((c) => {
			const d = createRoleDraftFromHiringCandidate(c);
			d.localModelId = modelId;
			return d;
		});
}
