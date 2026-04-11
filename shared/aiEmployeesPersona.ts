export const NATIONALITY_CODES = ['CN', 'US', 'UK', 'JP', 'KR', 'DE', 'FR', 'SG'] as const;

export type NationalityCode = (typeof NATIONALITY_CODES)[number];

export type RolePersonaSeed = {
	nationalityCode?: NationalityCode | null;
	jobMission?: string;
	domainContext?: string;
	communicationNotes?: string;
	collaborationRules?: string;
	handoffRules?: string;
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
	jobMission?: string;
	domainContext?: string;
	communicationNotes?: string;
	collaborationRules?: string;
	handoffRules?: string;
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
		nationalityCode?: NationalityCode | null;
	}>;
};

/** Payload for `aiEmployees:chat` — inbox dialogue with a bound local model. */
export type EmployeeChatHistoryTurn = {
	role: 'user' | 'assistant';
	content: string;
};

export type EmployeeChatInput = {
	requestId: string;
	modelId: string;
	displayName: string;
	roleKey: string;
	customRoleTitle?: string | null;
	customSystemPrompt?: string | null;
	jobMission?: string;
	domainContext?: string;
	communicationNotes?: string;
	collaborationRules?: string;
	handoffRules?: string;
	history: EmployeeChatHistoryTurn[];
};
