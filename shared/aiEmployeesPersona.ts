export const MBTI_TYPES = [
	'INTJ',
	'INTP',
	'ENTJ',
	'ENTP',
	'INFJ',
	'INFP',
	'ENFJ',
	'ENFP',
	'ISTJ',
	'ISFJ',
	'ESTJ',
	'ESFJ',
	'ISTP',
	'ISFP',
	'ESTP',
	'ESFP',
] as const;

export type MbtiType = (typeof MBTI_TYPES)[number];

export const NATIONALITY_CODES = ['CN', 'US', 'UK', 'JP', 'KR', 'DE', 'FR', 'SG'] as const;

export type NationalityCode = (typeof NATIONALITY_CODES)[number];

export type RolePersonaSeed = {
	nationalityCode?: NationalityCode | null;
	mbtiType?: MbtiType | null;
	jobMission?: string;
	domainContext?: string;
	communicationNotes?: string;
	hiringReason?: string;
	generatedBy?: 'user' | 'ceo' | 'system';
};

export type RolePromptDraft = {
	systemPrompt: string;
	roleSummary: string;
	speakingStyle: string;
	collaborationRules: string;
	handoffRules: string;
};

export type HiringPlanCandidate = {
	id: string;
	roleKey: string;
	customRoleTitle?: string;
	displayName: string;
	nationalityCode?: NationalityCode | null;
	mbtiType?: MbtiType | null;
	modelSource: 'local_model' | 'remote_runtime' | 'hybrid';
	managerEmployeeId?: string;
	reason: string;
	jobMission?: string;
	domainContext?: string;
	communicationNotes?: string;
	promptDraft: RolePromptDraft;
};

export type RolePromptGeneratorInput = {
	modelId: string;
	roleKey?: string;
	templatePromptKey?: string;
	displayName: string;
	customRoleTitle?: string;
	nationalityCode?: NationalityCode | null;
	mbtiType?: MbtiType | null;
	jobMission?: string;
	domainContext?: string;
	communicationNotes?: string;
	companyName?: string;
	managerSummary?: string;
};

export type HiringPlanGeneratorInput = {
	modelId: string;
	companyName: string;
	ceoDisplayName: string;
	ceoPersonaSeed?: RolePersonaSeed | null;
	ceoSystemPrompt: string;
	currentEmployees: Array<{
		id: string;
		displayName: string;
		roleKey: string;
		customRoleTitle?: string | null;
		isCeo: boolean;
		mbtiType?: MbtiType | null;
		nationalityCode?: NationalityCode | null;
	}>;
};
