import { describe, expect, it } from 'vitest';

import { getTeamPresetDefaults } from './teamPresetCatalog';

describe('getTeamPresetDefaults', () => {
	it('disables reviewer preflight by default for the engineering preset', () => {
		expect(getTeamPresetDefaults('engineering')).toMatchObject({
			requirePlanApproval: true,
			enablePreflightReview: false,
			enableResearchPhase: true,
		});
	});
});
