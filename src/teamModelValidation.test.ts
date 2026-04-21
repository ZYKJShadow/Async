import { describe, expect, it } from 'vitest';

import { findTeamRolesMissingModels } from './teamModelValidation';

describe('findTeamRolesMissingModels', () => {
	it('lets built-in team roles inherit the currently selected chat model', () => {
		expect(
			findTeamRolesMissingModels(
				{
					source: 'builtin',
					experts: [],
				},
				[{ id: 'gpt-5', providerId: 'provider-1', displayName: 'GPT-5', requestName: 'gpt-5' }]
			)
		).toEqual([]);
	});

	it('flags an invalid built-in team global model id', () => {
		expect(
			findTeamRolesMissingModels(
				{
					source: 'builtin',
					experts: [],
					builtinGlobalModelId: 'missing-model',
				},
				[{ id: 'gpt-5', providerId: 'provider-1', displayName: 'GPT-5', requestName: 'gpt-5' }]
			)
		).toEqual([
			{
				kind: 'builtin_global',
				key: 'builtin-global-model',
			},
		]);
	});

	it('flags invalid built-in role model overrides', () => {
		expect(
			findTeamRolesMissingModels(
				{
					source: 'builtin',
					experts: [],
					builtinExpertModelOverrides: {
						'builtin-engineering_frontend_developer': 'missing-model',
					},
				},
				[{ id: 'gpt-5', providerId: 'provider-1', displayName: 'GPT-5', requestName: 'gpt-5' }]
			)
		).toEqual([
			{
				kind: 'builtin_role',
				key: 'builtin-role:builtin-engineering_frontend_developer',
				expertId: 'builtin-engineering_frontend_developer',
			},
		]);
	});

	it('only flags explicit invalid preferred model ids', () => {
		expect(
			findTeamRolesMissingModels(
				{
					source: 'custom',
					experts: [
						{
							id: 'lead',
							name: 'Team Lead',
							roleType: 'team_lead',
							assignmentKey: 'team_lead',
							systemPrompt: 'lead',
							enabled: true,
						},
						{
							id: 'bad-model',
							name: 'Reviewer',
							roleType: 'reviewer',
							assignmentKey: 'reviewer',
							systemPrompt: 'review',
							preferredModelId: 'missing-model',
							enabled: true,
						},
					],
				},
				[{ id: 'gpt-5', providerId: 'provider-1', displayName: 'GPT-5', requestName: 'gpt-5' }]
			)
		).toEqual([
			{
				kind: 'role',
				key: 'role:bad-model',
				role: {
					id: 'bad-model',
					name: 'Reviewer',
					roleType: 'reviewer',
					assignmentKey: 'reviewer',
					systemPrompt: 'review',
					preferredModelId: 'missing-model',
					enabled: true,
				},
			},
		]);
	});
});
