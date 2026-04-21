import { describe, expect, it } from 'vitest';

import { buildTeamAvatarSeed } from './teamAvatarSeed';

describe('buildTeamAvatarSeed', () => {
	it('prefers assignmentKey so the same role keeps the same avatar across cards', () => {
		expect(
			buildTeamAvatarSeed({
				roleType: 'custom',
				assignmentKey: 'game_designer',
				avatarSeed: 'proposal-1:0:game_designer',
			})
		).toBe('custom:game_designer');
		expect(
			buildTeamAvatarSeed({
				roleType: 'custom',
				assignmentKey: 'game_designer',
				avatarSeed: 'task-42',
			})
		).toBe('custom:game_designer');
	});

	it('falls back to avatarSeed when there is no stable assignmentKey', () => {
		expect(
			buildTeamAvatarSeed({
				roleType: 'custom',
				avatarSeed: 'task-42',
			})
		).toBe('task-42');
	});
});
