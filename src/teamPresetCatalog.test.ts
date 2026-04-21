import { describe, expect, it } from 'vitest';

import { getTeamPresetDefaults, getTeamSourceDefaults, inferTeamSource } from './teamPresetCatalog';

describe('getTeamPresetDefaults', () => {
	it('disables reviewer preflight by default for the engineering preset', () => {
		expect(getTeamPresetDefaults('engineering')).toMatchObject({
			requirePlanApproval: true,
			enablePreflightReview: false,
		});
	});
});

describe('team source helpers', () => {
	it('defaults new Team settings to the built-in source', () => {
		expect(inferTeamSource(undefined)).toBe('builtin');
		expect(getTeamSourceDefaults('builtin')).toMatchObject({
			requirePlanApproval: true,
			enablePreflightReview: false,
		});
	});

	it('keeps legacy preset-based Team settings on the custom source', () => {
		expect(
			inferTeamSource({
				useDefaults: true,
				presetId: 'engineering',
				experts: [],
			})
		).toBe('custom');
	});
});
