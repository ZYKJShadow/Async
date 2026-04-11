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
	/** User-stated goals for the team (CEO-arrange onboarding); optional. */
	userRequirements?: string;
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

export type TeamMemberSummary = {
	id: string;
	displayName: string;
	roleTitle: string;
	jobMission?: string;
};

export type WorkspaceProjectSnapshot = {
	id: string;
	title: string;
	icon?: string;
	description?: string;
	boundaryKind: string;
	boundaryPath?: string;
	issueCount: number;
	doneCount: number;
	leadName?: string;
};

export type WorkspaceIssueSnapshot = {
	identifier?: string;
	title: string;
	status: string;
	priority?: string;
	assigneeName?: string;
	projectTitle?: string;
};

export type WorkspaceSkillSnapshot = {
	name: string;
	description?: string;
};

/** Live workspace state injected into the employee system prompt. */
export type WorkspaceContextSnapshot = {
	companyName?: string;
	projects: WorkspaceProjectSnapshot[];
	recentIssues: WorkspaceIssueSnapshot[];
	skills: WorkspaceSkillSnapshot[];
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
	/** Team members the employee can collaborate with. */
	teamMembers?: TeamMemberSummary[];
	/** Live workspace state so the employee is aware of projects, issues, and skills. */
	workspaceContext?: WorkspaceContextSnapshot;
	/** Local folder paths from project boundaries — enables agent mode with file tools. */
	boundaryLocalPaths?: string[];
};
