import type { OrgEmployee } from '../api/orgTypes';

export const HANDOFF_REPORT_TEMPLATE = ['done', 'risks', 'next_owner', 'next_action'] as const;

export type EmployeeCollaborationContract = {
	jobMission?: string;
	domainContext?: string;
	communicationNotes?: string;
	collaborationRules?: string;
	handoffRules?: string;
};

export type CollaborationLabelSet = {
	jobMission: string;
	domainContext: string;
	communicationNotes: string;
	collaborationRules: string;
	handoffRules: string;
	reportTemplate: string;
};

function clean(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getEmployeeCollaborationContract(
	employee?: Pick<OrgEmployee, 'personaSeed'> | null
): EmployeeCollaborationContract {
	return {
		jobMission: clean(employee?.personaSeed?.jobMission),
		domainContext: clean(employee?.personaSeed?.domainContext),
		communicationNotes: clean(employee?.personaSeed?.communicationNotes),
		collaborationRules: clean(employee?.personaSeed?.collaborationRules),
		handoffRules: clean(employee?.personaSeed?.handoffRules),
	};
}

export function hasEmployeeCollaborationContract(contract: EmployeeCollaborationContract): boolean {
	return Boolean(
		contract.jobMission ||
			contract.domainContext ||
			contract.communicationNotes ||
			contract.collaborationRules ||
			contract.handoffRules
	);
}

export function getPrimaryRuleHint(contract: EmployeeCollaborationContract): string | undefined {
	return contract.collaborationRules ?? contract.handoffRules ?? contract.jobMission ?? contract.domainContext;
}

export function describeCollaborationContract(
	contract: EmployeeCollaborationContract,
	labels: CollaborationLabelSet
): Array<{ label: string; value: string }> {
	const sections: Array<{ label: string; value: string }> = [];
	if (contract.jobMission) {
		sections.push({ label: labels.jobMission, value: contract.jobMission });
	}
	if (contract.domainContext) {
		sections.push({ label: labels.domainContext, value: contract.domainContext });
	}
	if (contract.communicationNotes) {
		sections.push({ label: labels.communicationNotes, value: contract.communicationNotes });
	}
	if (contract.collaborationRules) {
		sections.push({ label: labels.collaborationRules, value: contract.collaborationRules });
	}
	if (contract.handoffRules) {
		sections.push({ label: labels.handoffRules, value: contract.handoffRules });
	}
	return sections;
}

export function formatRuleDrivenMessageBody(
	baseText: string,
	contract: EmployeeCollaborationContract,
	labels: CollaborationLabelSet
): string {
	const sections = describeCollaborationContract(contract, labels);
	const parts = [clean(baseText), ...sections.map((section) => `${section.label}:\n${section.value}`)];
	if (sections.length > 0) {
		parts.push(`${labels.reportTemplate}:\n${HANDOFF_REPORT_TEMPLATE.join(' / ')}`);
	}
	return parts.filter((part): part is string => Boolean(part)).join('\n\n');
}
