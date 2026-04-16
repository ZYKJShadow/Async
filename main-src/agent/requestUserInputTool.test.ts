import { describe, expect, it } from 'vitest';
import {
	extractRequestUserInputAnswers,
	normalizeRequestUserInputArgs,
} from './requestUserInputTool.js';

describe('normalizeRequestUserInputArgs', () => {
	it('accepts up to three structured questions', () => {
		const out = normalizeRequestUserInputArgs({
			questions: [
				{
					id: 'scope',
					header: 'Scope',
					question: 'Which area should I prioritize first?',
					options: [
						{ label: 'UI polish', description: 'Improve visuals and layout consistency first.' },
						{ label: 'Refactor', description: 'Clean up structure before more features.' },
						{ label: 'Performance', description: 'Focus on speed and responsiveness first.' },
					],
				},
				{
					id: 'constraints',
					header: 'Constraints',
					question: 'What is the main delivery constraint?',
					options: [
						{ label: 'Fastest path', description: 'Prefer the quickest shippable approach.' },
						{ label: 'Lowest risk', description: 'Favor safer, smaller changes.' },
					],
				},
			],
		});

		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.questions).toHaveLength(2);
		expect(out.questions[0]?.options).toHaveLength(3);
		expect(out.questions[1]?.options).toHaveLength(2);
	});

	it('rejects invalid payloads without valid questions', () => {
		const out = normalizeRequestUserInputArgs({
			questions: [{ id: 'broken', header: '', question: '', options: [] }],
		});

		expect(out.ok).toBe(false);
	});
});

describe('extractRequestUserInputAnswers', () => {
	it('extracts answer values from tool result json', () => {
		expect(
			extractRequestUserInputAnswers(
				JSON.stringify({
					answers: {
						scope: 'UI polish',
						constraints: 'Lowest risk',
					},
				})
			)
		).toEqual(['UI polish', 'Lowest risk']);
	});
});
