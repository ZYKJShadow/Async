import { describe, expect, it } from 'vitest';
import { onboardingBlocksDashboard, resolveOnboardingStep } from './bootstrap';
import type { OrgBootstrapStatus } from '../api/orgTypes';

function st(partial: Partial<OrgBootstrapStatus>): OrgBootstrapStatus {
	return {
		companyName: null,
		hasOrgProfile: false,
		hasCeo: false,
		templatesConfirmed: false,
		onboardingCompleted: false,
		...partial,
	};
}

describe('bootstrap', () => {
	it('resolveOnboardingStep requires workspace id first', () => {
		expect(resolveOnboardingStep(st({}), false)).toBe('pick_workspace');
	});

	it('resolveOnboardingStep company before ceo', () => {
		expect(resolveOnboardingStep(st({ hasOrgProfile: false }), true)).toBe('company');
		expect(resolveOnboardingStep(st({ hasOrgProfile: true, companyName: '' }), true)).toBe('company');
		expect(resolveOnboardingStep(st({ hasOrgProfile: true, companyName: 'Acme' }), true)).toBe('ceo_profile');
	});

	it('resolveOnboardingStep roles then finish', () => {
		const base = st({
			hasOrgProfile: true,
			companyName: 'Acme',
			hasCeo: true,
			templatesConfirmed: false,
		});
		expect(resolveOnboardingStep(base, true)).toBe('team_setup');
		expect(
			resolveOnboardingStep(
				st({
					hasOrgProfile: true,
					companyName: 'Acme',
					hasCeo: true,
					templatesConfirmed: true,
					onboardingCompleted: false,
				}),
				true
			)
		).toBe('finish');
	});

	it('onboardingBlocksDashboard', () => {
		expect(onboardingBlocksDashboard(null)).toBe(false);
		expect(onboardingBlocksDashboard(st({ onboardingCompleted: true }))).toBe(false);
		expect(onboardingBlocksDashboard(st({ onboardingCompleted: false }))).toBe(true);
	});
});
