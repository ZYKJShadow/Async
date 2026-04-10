import { describe, expect, it } from 'vitest';
import { createEmptyRoleProfileDraft, createRoleDraftFromOrgEmployee, toPersonaSeed } from './roleDraft';

describe('roleDraft', () => {
	it('creates persona seed from role draft', () => {
		const draft = createEmptyRoleProfileDraft({
			nationalityCode: 'JP',
			jobMission: 'Own roadmap',
			domainContext: 'B2B saas',
			communicationNotes: 'Stay concise',
			promptDraft: {
				systemPrompt: 'Coordinate work',
				roleSummary: '',
				speakingStyle: '',
				collaborationRules: 'Escalate blockers early',
				handoffRules: 'Always include done and next owner',
			},
			reason: 'CEO proposed this role',
		});
		expect(toPersonaSeed(draft, 'ceo')).toEqual({
			nationalityCode: 'JP',
			jobMission: 'Own roadmap',
			domainContext: 'B2B saas',
			communicationNotes: 'Stay concise',
			collaborationRules: 'Escalate blockers early',
			handoffRules: 'Always include done and next owner',
			hiringReason: 'CEO proposed this role',
			generatedBy: 'ceo',
		});
	});

	it('hydrates persisted persona seed collaboration rules from org employee', () => {
		const draft = createRoleDraftFromOrgEmployee({
			id: 'emp-1',
			displayName: '产品负责人',
			roleKey: 'pm',
			customRoleTitle: '产品负责人',
			managerEmployeeId: 'lead-1',
			createdByEmployeeId: 'lead-1',
			isCeo: false,
			avatarAssetId: null,
			avatarUrl: null,
			templatePromptKey: 'pm',
			customSystemPrompt: 'Own product discovery',
			nationalityCode: 'CN',
			personaSeed: {
				jobMission: '定义路线图',
				domainContext: '企业协作',
				communicationNotes: '先结论后细节',
				collaborationRules: '与工程、测试保持周同步',
				handoffRules: '交接必须写明 done/risks/next_owner/next_action',
			},
			capabilities: {},
			status: 'active',
			sortOrder: 0,
			linkedRemoteAgentId: null,
			modelSource: 'local_model',
		});
		expect(draft.jobMission).toBe('定义路线图');
		expect(draft.domainContext).toBe('企业协作');
		expect(draft.communicationNotes).toBe('先结论后细节');
		expect(draft.promptDraft.collaborationRules).toBe('与工程、测试保持周同步');
		expect(draft.promptDraft.handoffRules).toBe('交接必须写明 done/risks/next_owner/next_action');
	});
});
