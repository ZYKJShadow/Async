import type {
	HiringPlanCandidate,
	MbtiType,
	NationalityCode,
	RolePersonaSeed,
	RolePromptDraft,
} from '../../../shared/aiEmployeesPersona';
import { MBTI_TYPES, NATIONALITY_CODES } from '../../../shared/aiEmployeesPersona';

export { MBTI_TYPES, NATIONALITY_CODES };
export type { HiringPlanCandidate, MbtiType, NationalityCode, RolePersonaSeed, RolePromptDraft };

export const NATIONALITY_OPTIONS: Array<{ code: NationalityCode; label: string; styleLabel: string }> = [
	{ code: 'CN', label: '中国', styleLabel: '直接、务实、强调推进' },
	{ code: 'US', label: '美国', styleLabel: '清晰、主动、结果导向' },
	{ code: 'UK', label: '英国', styleLabel: '克制、礼貌、条理化' },
	{ code: 'JP', label: '日本', styleLabel: '谨慎、细致、重配合' },
	{ code: 'KR', label: '韩国', styleLabel: '快速、明确、执行强' },
	{ code: 'DE', label: '德国', styleLabel: '结构化、严谨、标准清晰' },
	{ code: 'FR', label: '法国', styleLabel: '表达鲜明、重思辨' },
	{ code: 'SG', label: '新加坡', styleLabel: '高效、国际化、务实' },
];

export const MBTI_FAMILY_BY_TYPE: Record<MbtiType, 'analysts' | 'diplomats' | 'sentinels' | 'explorers'> = {
	INTJ: 'analysts',
	INTP: 'analysts',
	ENTJ: 'analysts',
	ENTP: 'analysts',
	INFJ: 'diplomats',
	INFP: 'diplomats',
	ENFJ: 'diplomats',
	ENFP: 'diplomats',
	ISTJ: 'sentinels',
	ISFJ: 'sentinels',
	ESTJ: 'sentinels',
	ESFJ: 'sentinels',
	ISTP: 'explorers',
	ISFP: 'explorers',
	ESTP: 'explorers',
	ESFP: 'explorers',
};

export const MBTI_LABELS: Record<MbtiType, { label: string; shortTraits: string[] }> = {
	INTJ: { label: '建筑师', shortTraits: ['战略', '冷静', '前瞻'] },
	INTP: { label: '逻辑学家', shortTraits: ['抽象', '好奇', '推演'] },
	ENTJ: { label: '指挥官', shortTraits: ['决断', '推进', '掌控'] },
	ENTP: { label: '辩论家', shortTraits: ['创意', '机敏', '试验'] },
	INFJ: { label: '提倡者', shortTraits: ['洞察', '愿景', '共情'] },
	INFP: { label: '调停者', shortTraits: ['理想', '真诚', '价值感'] },
	ENFJ: { label: '主人公', shortTraits: ['感染力', '组织', '带动'] },
	ENFP: { label: '竞选者', shortTraits: ['灵感', '外向', '鼓舞'] },
	ISTJ: { label: '物流师', shortTraits: ['可靠', '秩序', '执行'] },
	ISFJ: { label: '守卫者', shortTraits: ['稳妥', '细心', '支持'] },
	ESTJ: { label: '总经理', shortTraits: ['管理', '纪律', '交付'] },
	ESFJ: { label: '执政官', shortTraits: ['协调', '照顾', '共识'] },
	ISTP: { label: '鉴赏家', shortTraits: ['动手', '冷静', '排障'] },
	ISFP: { label: '探险家', shortTraits: ['审美', '柔韧', '体验'] },
	ESTP: { label: '企业家', shortTraits: ['果断', '现场', '行动'] },
	ESFP: { label: '表演者', shortTraits: ['活力', '互动', '感染'] },
};

export function isMbtiType(value: string): value is MbtiType {
	return (MBTI_TYPES as readonly string[]).includes(value);
}

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
