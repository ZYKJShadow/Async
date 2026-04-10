import { describe, expect, it } from 'vitest';
import { MBTI_TYPES } from '../../../shared/aiEmployeesPersona';
import { mbtiVisualRegistry } from './mbtiVisuals';

describe('mbtiVisualRegistry', () => {
	it('covers all 16 mbti types with labels and families', () => {
		expect(Object.keys(mbtiVisualRegistry).sort()).toEqual([...MBTI_TYPES].sort());
		for (const type of MBTI_TYPES) {
			expect(mbtiVisualRegistry[type].label.length).toBeGreaterThan(0);
			expect(mbtiVisualRegistry[type].shortTraits.length).toBeGreaterThan(0);
			expect(mbtiVisualRegistry[type].family).toBeTruthy();
		}
	});
});
