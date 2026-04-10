import type { HiringPlanCandidate, NationalityCode, RolePersonaSeed, RolePromptDraft } from '../../../shared/aiEmployeesPersona';
import { NATIONALITY_CODES } from '../../../shared/aiEmployeesPersona';

export { NATIONALITY_CODES };
export type { HiringPlanCandidate, NationalityCode, RolePersonaSeed, RolePromptDraft };

/** label 仅展示语言/地区；styleLabel 供提示词生成等内部使用，不在 UI 展示 */
export const NATIONALITY_OPTIONS: Array<{ code: NationalityCode; label: string; styleLabel: string }> = [
	{ code: 'CN', label: '简体中文（中国）', styleLabel: '直接、务实、强调推进' },
	{ code: 'US', label: 'English (United States)', styleLabel: '清晰、主动、结果导向' },
	{ code: 'UK', label: 'English (United Kingdom)', styleLabel: '克制、礼貌、条理化' },
	{ code: 'JP', label: '日本語', styleLabel: '谨慎、细致、重配合' },
	{ code: 'KR', label: '한국어', styleLabel: '快速、明确、执行强' },
	{ code: 'DE', label: 'Deutsch', styleLabel: '结构化、严谨、标准清晰' },
	{ code: 'FR', label: 'Français', styleLabel: '表达鲜明、重思辨' },
	{ code: 'SG', label: 'English (Singapore)', styleLabel: '高效、国际化、务实' },
];

export function isNationalityCode(value: string): value is NationalityCode {
	return (NATIONALITY_CODES as readonly string[]).includes(value);
}

export function emptyPromptDraft(): RolePromptDraft {
	return {
		systemPrompt: '',
		roleSummary: '',
		speakingStyle: '',
		collaborationRules: '',
		handoffRules: '',
	};
}

export type EditableHiringCandidate = HiringPlanCandidate & {
	localModelId?: string;
	rejected?: boolean;
};

export function upsertHiringCandidate(
	list: EditableHiringCandidate[],
	next: EditableHiringCandidate
): EditableHiringCandidate[] {
	const idx = list.findIndex((item) => item.id === next.id);
	if (idx < 0) {
		return [...list, next];
	}
	return list.map((item, index) => (index === idx ? next : item));
}

export function acceptedHiringCandidates(list: EditableHiringCandidate[]): EditableHiringCandidate[] {
	return list.filter((item) => !item.rejected);
}
