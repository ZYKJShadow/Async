import { describe, expect, it } from 'vitest';
import { isSimpleGoal } from './simpleGoalDetector.js';

describe('isSimpleGoal', () => {
	it('returns true for short single-action questions', () => {
		expect(isSimpleGoal('What is TypeScript?')).toBe(true);
		expect(isSimpleGoal('Explain this function')).toBe(true);
		expect(isSimpleGoal('Refactor this file')).toBe(true);
		expect(isSimpleGoal('Write a hello world in Python')).toBe(true);
	});

	it('returns false for sequencing language', () => {
		expect(isSimpleGoal('First build the API, then write tests')).toBe(false);
		expect(isSimpleGoal('Step 1: design, step 2: implement')).toBe(false);
	});

	it('returns false for coordination language', () => {
		expect(isSimpleGoal('Collaborate with the backend team on this')).toBe(false);
		expect(isSimpleGoal('Coordinate the team to review each change')).toBe(false);
		expect(isSimpleGoal('Review each other before merging')).toBe(false);
		expect(isSimpleGoal('Work together to ship this feature')).toBe(false);
	});

	it('returns false for parallel execution language', () => {
		expect(isSimpleGoal('Build the frontend and backend in parallel')).toBe(false);
		expect(isSimpleGoal('Run tests concurrently')).toBe(false);
		expect(isSimpleGoal('Do these at the same time')).toBe(false);
	});

	it('returns false for multiple deliverables', () => {
		expect(isSimpleGoal('Build the API and then deploy it')).toBe(false);
		expect(isSimpleGoal('Create the design and implement the page')).toBe(false);
		expect(isSimpleGoal('Write docs and then build the landing page')).toBe(false);
	});

	it('returns false for long goals', () => {
		expect(isSimpleGoal('a'.repeat(201))).toBe(false);
	});

	it('returns true for descriptive uses of coordination words', () => {
		// Descriptive, not imperative — should remain simple
		expect(isSimpleGoal('How does microservice collaboration work?')).toBe(true);
		expect(isSimpleGoal('Explain what team coordination means')).toBe(true);
	});

	it('returns false for numbered lists', () => {
		expect(isSimpleGoal('1. Design the schema\n2. Build the API')).toBe(false);
		expect(isSimpleGoal('2) Implement authentication')).toBe(false);
	});

	it('handles CJK text correctly', () => {
		expect(isSimpleGoal('解释一下这段代码')).toBe(true);
		expect(isSimpleGoal('先写接口，再写测试')).toBe(false);
		expect(isSimpleGoal('大家一起协作完成这个功能')).toBe(false);
	});
});
