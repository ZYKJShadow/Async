import { apiFetch, AiEmployeesApiError, buildHttpUrl, type AiEmployeesConnection } from './client';
import type { OrgBootstrapStatus, OrgEmployee, OrgPromptTemplate } from './orgTypes';
import type { MbtiType, NationalityCode, RolePersonaSeed } from '../../../shared/aiEmployeesPersona';

export async function apiGetBootstrapStatus(conn: AiEmployeesConnection, workspaceId: string): Promise<OrgBootstrapStatus> {
	const r = await apiFetch(conn, '/api/bootstrap/status', { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	return (await r.json()) as OrgBootstrapStatus;
}

export async function apiPostBootstrapOrg(conn: AiEmployeesConnection, workspaceId: string, companyName: string): Promise<void> {
	const r = await apiFetch(conn, '/api/bootstrap/org', {
		method: 'POST',
		workspaceId,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ companyName }),
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
}

export async function apiPostBootstrapConfirmTemplates(conn: AiEmployeesConnection, workspaceId: string): Promise<void> {
	const r = await apiFetch(conn, '/api/bootstrap/confirm-templates', {
		method: 'POST',
		workspaceId,
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
}

export async function apiPostBootstrapComplete(conn: AiEmployeesConnection, workspaceId: string): Promise<void> {
	const r = await apiFetch(conn, '/api/bootstrap/complete', {
		method: 'POST',
		workspaceId,
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
}

export async function apiPostBootstrapReset(conn: AiEmployeesConnection, workspaceId: string): Promise<void> {
	const r = await apiFetch(conn, '/api/bootstrap/reset', {
		method: 'POST',
		workspaceId,
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
}

export async function apiListPromptTemplates(conn: AiEmployeesConnection, workspaceId: string): Promise<OrgPromptTemplate[]> {
	const r = await apiFetch(conn, '/api/prompt-templates/', { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { templates?: OrgPromptTemplate[] };
	return j.templates ?? [];
}

export async function apiListOrgEmployees(conn: AiEmployeesConnection, workspaceId: string): Promise<OrgEmployee[]> {
	const r = await apiFetch(conn, '/api/employees/', { workspaceId });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	const j = (await r.json()) as { employees?: OrgEmployee[] };
	return j.employees ?? [];
}

export type CreateOrgEmployeeInput = {
	displayName: string;
	roleKey?: string;
	customRoleTitle?: string;
	managerEmployeeId?: string;
	createdByEmployeeId?: string;
	isCeo?: boolean;
	templatePromptKey?: string;
	customSystemPrompt?: string;
	nationalityCode?: NationalityCode | null;
	mbtiType?: MbtiType | null;
	personaSeed?: RolePersonaSeed | null;
	capabilities?: string[];
	linkedRemoteAgentId?: string;
	modelSource?: 'local_model' | 'remote_runtime' | 'hybrid';
};

export async function apiCreateOrgEmployee(
	conn: AiEmployeesConnection,
	workspaceId: string,
	body: CreateOrgEmployeeInput
): Promise<OrgEmployee> {
	const r = await apiFetch(conn, '/api/employees/', {
		method: 'POST',
		workspaceId,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	return (await r.json()) as OrgEmployee;
}

export type PatchOrgEmployeeInput = Partial<{
	displayName: string;
	roleKey: string;
	customRoleTitle: string;
	clearCustomRoleTitle: boolean;
	managerEmployeeId: string;
	clearManager: boolean;
	createdByEmployeeId: string;
	isCeo: boolean;
	templatePromptKey: string;
	clearTemplatePromptKey: boolean;
	customSystemPrompt: string;
	clearCustomSystemPrompt: boolean;
	nationalityCode: NationalityCode | null;
	clearNationalityCode: boolean;
	mbtiType: MbtiType | null;
	clearMbtiType: boolean;
	personaSeed: RolePersonaSeed | null;
	clearPersonaSeed: boolean;
	capabilities: string[];
	status: string;
	sortOrder: number;
	linkedRemoteAgentId: string;
	clearLinkedRemoteAgent: boolean;
	modelSource: 'local_model' | 'remote_runtime' | 'hybrid';
}>;

export async function apiPatchOrgEmployee(
	conn: AiEmployeesConnection,
	workspaceId: string,
	employeeId: string,
	body: PatchOrgEmployeeInput
): Promise<OrgEmployee> {
	const r = await apiFetch(conn, `/api/employees/${employeeId}`, {
		method: 'PATCH',
		workspaceId,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	return (await r.json()) as OrgEmployee;
}

export function orgEmployeeAvatarSrc(conn: AiEmployeesConnection, employeeId: string): string {
	const path = `/api/employees/${employeeId}/avatar`;
	return buildHttpUrl(conn.apiBaseUrl, path);
}

export async function apiUploadOrgEmployeeAvatar(
	conn: AiEmployeesConnection,
	workspaceId: string,
	employeeId: string,
	file: File
): Promise<OrgEmployee> {
	const url = buildHttpUrl(conn.apiBaseUrl, `/api/employees/${employeeId}/avatar`);
	const headers = new Headers();
	if (conn.token.trim()) {
		headers.set('Authorization', `Bearer ${conn.token.trim()}`);
	}
	headers.set('X-Workspace-ID', workspaceId);
	const fd = new FormData();
	fd.append('file', file);
	const r = await fetch(url, { method: 'POST', headers, body: fd });
	if (!r.ok) {
		throw new AiEmployeesApiError(r.status, await r.text());
	}
	return (await r.json()) as OrgEmployee;
}
