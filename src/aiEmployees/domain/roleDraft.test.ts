import { describe, expect, it } from 'vitest';
import { createEmptyRoleProfileDraft, toPersonaSeed } from './roleDraft';

describe('roleDraft', () => {
	it('creates persona seed from role draft', () => {
		const draft = createEmptyRoleProfileDraft({
			nationalityCode: 'JP',
			mbtiType: 'INFJ',
			jobMission: 'Own roadmap',
			domainContext: 'B2B saas',
			communicationNotes: 'Stay concise',
			reason: 'CEO proposed this role',
		});
		expect(toPersonaSeed(draft, 'ceo')).toEqual({
			nationalityCode: 'JP',
			mbtiType: 'INFJ',
			jobMission: 'Own roadmap',
			domainContext: 'B2B saas',
			communicationNotes: 'Stay concise',
			hiringReason: 'CEO proposed this role',
			generatedBy: 'ceo',
		});
	});
});
