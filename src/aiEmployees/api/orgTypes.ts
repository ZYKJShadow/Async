/** 与 async-agent-proxy `/api/bootstrap/*`、`/api/employees/*` 对齐 */

import type { MbtiType, NationalityCode, RolePersonaSeed } from '../../../shared/aiEmployeesPersona';

export type OrgBootstrapStatus = {
	companyName: string | null;
	hasOrgProfile: boolean;
	hasCeo: boolean;
	templatesConfirmed: boolean;
	onboardingCompleted: boolean;
};

export type OrgPromptTemplate = {
	key: string;
	title: string;
	systemPrompt: string;
	sortOrder: number;
};

export type OrgEmployee = {
	id: string;
	displayName: string;
	roleKey: string;
	customRoleTitle?: string | null;
	managerEmployeeId?: string | null;
	createdByEmployeeId?: string | null;
	isCeo: boolean;
	avatarAssetId?: string | null;
	avatarUrl?: string | null;
	templatePromptKey?: string | null;
	customSystemPrompt?: string | null;
	nationalityCode?: NationalityCode | null;
	mbtiType?: MbtiType | null;
	personaSeed?: RolePersonaSeed | null;
	capabilities: unknown;
	status: string;
	sortOrder: number;
	linkedRemoteAgentId?: string | null;
	modelSource: 'local_model' | 'remote_runtime' | 'hybrid';
};
