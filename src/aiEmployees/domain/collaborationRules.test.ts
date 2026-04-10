import { describe, expect, it } from 'vitest';
import {
	describeCollaborationContract,
	formatRuleDrivenMessageBody,
	getEmployeeCollaborationContract,
	getPrimaryRuleHint,
	HANDOFF_REPORT_TEMPLATE,
	hasEmployeeCollaborationContract,
} from './collaborationRules';

const labels = {
	jobMission: 'Job mission',
	domainContext: 'Domain context',
	communicationNotes: 'Communication notes',
	collaborationRules: 'Collaboration rules',
	handoffRules: 'Handoff rules',
	reportTemplate: 'Required handoff report',
};

describe('collaborationRules', () => {
	it('extracts persisted collaboration contract from org employee persona seed', () => {
		const contract = getEmployeeCollaborationContract({
			personaSeed: {
				jobMission: 'Drive delivery',
				domainContext: 'Async workspace',
				communicationNotes: 'Lead with the outcome',
				collaborationRules: 'Escalate blockers quickly',
				handoffRules: 'Always include next_owner',
			},
		});
		expect(contract).toEqual({
			jobMission: 'Drive delivery',
			domainContext: 'Async workspace',
			communicationNotes: 'Lead with the outcome',
			collaborationRules: 'Escalate blockers quickly',
			handoffRules: 'Always include next_owner',
		});
		expect(hasEmployeeCollaborationContract(contract)).toBe(true);
		expect(getPrimaryRuleHint(contract)).toBe('Escalate blockers quickly');
	});

	it('formats assignment body with rule sections and required handoff template', () => {
		const body = formatRuleDrivenMessageBody(
			'Implement the timeline panel.',
			{
				collaborationRules: 'Escalate blockers quickly',
				handoffRules: 'Always include next_owner',
			},
			labels
		);
		expect(describeCollaborationContract(
			{
				collaborationRules: 'Escalate blockers quickly',
				handoffRules: 'Always include next_owner',
			},
			labels
		)).toEqual([
			{ label: 'Collaboration rules', value: 'Escalate blockers quickly' },
			{ label: 'Handoff rules', value: 'Always include next_owner' },
		]);
		expect(body).toContain('Implement the timeline panel.');
		expect(body).toContain('Collaboration rules:\nEscalate blockers quickly');
		expect(body).toContain('Handoff rules:\nAlways include next_owner');
		expect(body).toContain(`Required handoff report:\n${HANDOFF_REPORT_TEMPLATE.join(' / ')}`);
	});
});
