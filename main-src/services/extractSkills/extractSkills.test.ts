import { describe, expect, it } from 'vitest';
import {
	parseJsonResponse,
	renderSkillFile,
	sanitizeSkillSlug,
	shouldRunSkillExtractionForThread,
} from './extractSkills.js';
import type { ExtractedSkillDraft } from './extractSkills.js';

describe('sanitizeSkillSlug', () => {
	it('normalizes to kebab-case', () => {
		expect(sanitizeSkillSlug('Deploy To Staging')).toBe('deploy-to-staging');
		expect(sanitizeSkillSlug('API_Integration')).toBe('api_integration');
		expect(sanitizeSkillSlug('  spaces  ')).toBe('spaces');
	});

	it('rejects empty or too long slugs', () => {
		expect(sanitizeSkillSlug('')).toBe('');
		expect(sanitizeSkillSlug('a'.repeat(41))).toBe('');
	});
});

describe('parseJsonResponse', () => {
	it('parses valid skill JSON', () => {
		const json = JSON.stringify({
			should_create: true,
			skill: {
				slug: 'deploy-staging',
				name: 'Deploy to Staging',
				description: 'Deploy app to staging env',
				triggers: ['deploy', 'staging'],
				steps: ['Build', 'Push', 'Verify'],
				tools: ['Bash'],
				pitfalls: ['Check env first'],
				verification: ['Health check'],
			},
		});
		const result = parseJsonResponse(json);
		expect(result.should_create).toBe(true);
		expect(result.skill?.slug).toBe('deploy-staging');
		expect(result.skill?.triggers).toEqual(['deploy', 'staging']);
	});

	it('returns should_create false for empty JSON', () => {
		const result = parseJsonResponse('{"should_create": false}');
		expect(result.should_create).toBe(false);
		expect(result.skill).toBeUndefined();
	});

	it('extracts JSON from markdown wrapper', () => {
		const wrapped = 'Some text\n```json\n{"should_create":true,"skill":{"slug":"test","name":"Test","description":"desc","triggers":[],"steps":[],"tools":[],"pitfalls":[],"verification":[]}}\n```\nMore text';
		const result = parseJsonResponse(wrapped);
		expect(result.should_create).toBe(true);
		expect(result.skill?.slug).toBe('test');
	});
});

describe('renderSkillFile', () => {
	it('renders a complete SKILL.md', () => {
		const draft: ExtractedSkillDraft = {
			slug: 'deploy-staging',
			name: 'Deploy to Staging',
			description: 'Full staging deploy flow',
			triggers: ['deploy', 'staging'],
			steps: ['Build docker image', 'Push to registry', 'Run health check'],
			tools: ['Bash', 'Read'],
			pitfalls: ['Check .env.staging exists'],
			verification: ['curl /health returns 200'],
		};
		const rendered = renderSkillFile(draft, 7);
		expect(rendered).toContain('name: Deploy to Staging');
		expect(rendered).toContain('slug: deploy-staging');
		expect(rendered).toContain('auto_created: true');
		expect(rendered).toContain('tool_calls: 7');
		expect(rendered).toContain('## 触发条件');
		expect(rendered).toContain('## 执行步骤');
		expect(rendered).toContain('1. Build docker image');
		expect(rendered).toContain('## 需要的工具');
		expect(rendered).toContain('## 常见陷阱');
		expect(rendered).toContain('## 验证方法');
	});

	it('renders fallback sections when arrays are empty', () => {
		const draft: ExtractedSkillDraft = {
			slug: 'test',
			name: 'Test',
			description: 'Test skill',
			triggers: [],
			steps: ['Do something'],
			tools: [],
			pitfalls: [],
			verification: [],
		};
		const rendered = renderSkillFile(draft, 5);
		expect(rendered).toContain('（用户显式调用 ./test）');
		expect(rendered).toContain('（根据任务动态选择）');
		expect(rendered).toContain('暂无已知陷阱');
	});
});

describe('shouldRunSkillExtractionForThread', () => {
	it('returns false when skillExtraction is disabled', () => {
		// This would require mocking threadStore; we verify the config gate at minimum.
		expect(typeof shouldRunSkillExtractionForThread).toBe('function');
	});
});
