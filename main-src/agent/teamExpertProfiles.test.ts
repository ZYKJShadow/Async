import { describe, expect, it, vi } from 'vitest';

const { listBuiltinTeamExpertsMock } = vi.hoisted(() => ({
	listBuiltinTeamExpertsMock: vi.fn(() => []),
}));

vi.mock('./builtinTeamCatalog.js', () => ({
	listBuiltinTeamExperts: listBuiltinTeamExpertsMock,
}));

import { resolveTeamExpertProfiles } from './teamExpertProfiles.js';

describe('resolveTeamExpertProfiles', () => {
	it('keeps the researcher available as a specialist assignment target', () => {
		const resolved = resolveTeamExpertProfiles(
			{
				useDefaults: false,
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
						id: 'researcher',
						name: 'Researcher',
						roleType: 'custom',
						assignmentKey: 'researcher',
						systemPrompt: 'research',
						enabled: true,
					},
					{
						id: 'frontend',
						name: 'Frontend',
						roleType: 'frontend',
						assignmentKey: 'frontend',
						systemPrompt: 'frontend',
						enabled: true,
					},
					{
						id: 'reviewer',
						name: 'Reviewer',
						roleType: 'reviewer',
						assignmentKey: 'reviewer',
						systemPrompt: 'reviewer',
						enabled: true,
					},
				],
			},
			[]
		);

		expect(resolved.teamLead?.assignmentKey).toBe('team_lead');
		expect(resolved.reviewer?.assignmentKey).toBe('reviewer');
		expect(resolved.specialists.map((expert) => expert.assignmentKey)).toEqual(['researcher', 'frontend']);
	});

	it('applies built-in role model overrides before the built-in global model', () => {
		listBuiltinTeamExpertsMock.mockReturnValue([
			{
				id: 'builtin-agents_orchestrator',
				name: 'Agents Orchestrator',
				roleType: 'team_lead',
				assignmentKey: 'team_lead',
				systemPrompt: 'lead',
				enabled: true,
			},
			{
				id: 'builtin-engineering_frontend_developer',
				name: 'Frontend Developer',
				roleType: 'frontend',
				assignmentKey: 'frontend',
				systemPrompt: 'frontend',
				enabled: true,
			},
			{
				id: 'builtin-engineering_backend_architect',
				name: 'Backend Architect',
				roleType: 'backend',
				assignmentKey: 'backend',
				systemPrompt: 'backend',
				enabled: true,
			},
		]);

		const resolved = resolveTeamExpertProfiles(
			{
				source: 'builtin',
				builtinGlobalModelId: 'gpt-global',
				builtinExpertModelOverrides: {
					'builtin-engineering_frontend_developer': 'gpt-frontend',
				},
			},
			[]
		);

		expect(resolved.teamLead?.preferredModelId).toBe('gpt-global');
		expect(resolved.specialists.find((expert) => expert.assignmentKey === 'frontend')?.preferredModelId).toBe(
			'gpt-frontend'
		);
		expect(resolved.specialists.find((expert) => expert.assignmentKey === 'backend')?.preferredModelId).toBe(
			'gpt-global'
		);
	});

	it('lets built-in team custom reviewers inherit the built-in global model', () => {
		listBuiltinTeamExpertsMock.mockReturnValue([
			{
				id: 'builtin-agents_orchestrator',
				name: 'Agents Orchestrator',
				roleType: 'team_lead',
				assignmentKey: 'team_lead',
				systemPrompt: 'lead',
				enabled: true,
			},
			{
				id: 'builtin-engineering_code_reviewer',
				name: 'Code Reviewer',
				roleType: 'reviewer',
				assignmentKey: 'reviewer',
				systemPrompt: 'reviewer',
				enabled: true,
			},
		]);

		const resolved = resolveTeamExpertProfiles(
			{
				source: 'builtin',
				builtinGlobalModelId: 'gpt-global',
				planReviewer: {
					id: 'plan-reviewer',
					name: 'Plan Reviewer',
					roleType: 'reviewer',
					assignmentKey: 'plan_reviewer',
					systemPrompt: 'plan review',
					enabled: true,
				},
			},
			[]
		);

		expect(resolved.planReviewer?.preferredModelId).toBe('gpt-global');
		expect(resolved.deliveryReviewer?.preferredModelId).toBe('gpt-global');
	});
});
