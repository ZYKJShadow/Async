import { describe, expect, it } from 'vitest';
import { extractJsonObject, normalizeHiringPlan, normalizeRolePromptDraft } from './roleGeneration';

describe('roleGeneration', () => {
	it('extracts json from fenced model output', () => {
		const parsed = extractJsonObject('```json\n{"systemPrompt":"x","roleSummary":"","speakingStyle":"","collaborationRules":"","handoffRules":""}\n```');
		expect(normalizeRolePromptDraft(parsed).systemPrompt).toBe('x');
	});

	it('normalizes hiring candidates and caps the list length', () => {
		const parsed = normalizeHiringPlan({
			candidates: Array.from({ length: 7 }, (_, index) => ({
				id: `c${index}`,
				roleKey: 'frontend',
				displayName: `Role ${index}`,
				modelSource: 'hybrid',
				promptDraft: {
					systemPrompt: 'Do the job',
					roleSummary: '',
					speakingStyle: '',
					collaborationRules: '',
					handoffRules: '',
				},
			})),
		});
		expect(parsed).toHaveLength(6);
		expect(parsed[0].promptDraft.systemPrompt).toBe('Do the job');
	});
});
