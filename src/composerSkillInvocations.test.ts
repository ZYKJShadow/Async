import { describe, expect, it } from 'vitest';
import {
	filterSkillInvokeMenuItems,
	getLeadingSkillInvokeQuery,
	type SkillInvokeMenuItem,
} from './composerSkillInvocations';

const items: SkillInvokeMenuItem[] = [
	{ id: 'xlsx', slug: 'xlsx', name: 'Spreadsheet Suite', description: 'Edit Excel and CSV files' },
	{ id: 'pdf', slug: 'pdf', name: 'PDF Suite', description: 'Extract and analyze PDF content' },
	{ id: 'pptx', slug: 'pptx', name: 'Slides', description: 'Work with presentations' },
];

describe('composerSkillInvocations', () => {
	it('filterSkillInvokeMenuItems：按 slug 前缀、名称前缀和描述子串过滤', () => {
		expect(filterSkillInvokeMenuItems(items, 'xl').map((item) => item.slug)).toEqual(['xlsx']);
		expect(filterSkillInvokeMenuItems(items, 'spread').map((item) => item.slug)).toEqual(['xlsx']);
		expect(filterSkillInvokeMenuItems(items, 'analyze').map((item) => item.slug)).toEqual(['pdf']);
		expect(filterSkillInvokeMenuItems(items, '').map((item) => item.slug)).toEqual(['xlsx', 'pdf', 'pptx']);
	});

	it('getLeadingSkillInvokeQuery：光标仍在 ./slug token 内时返回查询词', () => {
		expect(getLeadingSkillInvokeQuery('./xlsx', './xl')).toBe('xl');
		expect(getLeadingSkillInvokeQuery('./pdf', './')).toBe('');
	});

	it('getLeadingSkillInvokeQuery：进入参数区或前缀不对齐时返回 null', () => {
		expect(getLeadingSkillInvokeQuery('./xlsx analyze', './xlsx ')).toBeNull();
		expect(getLeadingSkillInvokeQuery('./xlsx', '/x')).toBeNull();
	});
});
