import { describe, expect, it } from 'vitest';
import {
	AUTO_REPLY_LANGUAGE_RULE_ID,
	buildAutoReplyLanguageRuleBlock,
	createAutoReplyLanguageRule,
} from '../../src/autoReplyLanguageRule.js';

describe('autoReplyLanguageRule', () => {
	it('zh-CN: covers all natural-language output channels and carves out technical tokens', () => {
		const rule = createAutoReplyLanguageRule('zh-CN', 'zh-CN');
		expect(rule.id).toBe(AUTO_REPLY_LANGUAGE_RULE_ID);
		expect(rule.scope).toBe('always');
		expect(rule.enabled).toBe(true);
		expect(rule.name).toBe('自动语言：默认使用简体中文回应');

		// Body must mention every channel that historically slipped through the
		// narrow "reply only" wording: thinking, tool args, code comments.
		expect(rule.content).toContain('简体中文');
		expect(rule.content).toContain('最终回答');
		expect(rule.content).toContain('thinking');
		expect(rule.content).toContain('TodoWrite');
		expect(rule.content).toContain('activeForm');
		expect(rule.content).toContain('ask_plan_question');
		expect(rule.content).toContain('代码注释');
		// Carve-out for technical tokens — must remain verbatim.
		expect(rule.content).toContain('文件路径');
		expect(rule.content).toContain('代码标识符');
		// Explicit user override escape hatch is preserved.
		expect(rule.content).toContain('明确要求');
	});

	it('zh-CN: block wraps the rule with a Markdown header that includes the rule name', () => {
		const block = buildAutoReplyLanguageRuleBlock('zh-CN', 'zh-CN');
		expect(block).toContain('#### Rule: 自动语言：默认使用简体中文回应');
		expect(block).toContain('TodoWrite');
		expect(block).toContain('文件路径');
	});

	it('en: produces an English version with the same coverage', () => {
		const rule = createAutoReplyLanguageRule('en', 'en');
		expect(rule.name).toBe('Automatic language: respond in English');
		expect(rule.content).toContain('English');
		expect(rule.content).toContain('reasoning');
		expect(rule.content).toContain('TodoWrite');
		expect(rule.content).toContain('activeForm');
		expect(rule.content).toContain('ask_plan_question');
		expect(rule.content).toContain('file paths');
		expect(rule.content).toContain('identifiers');
		expect(rule.content).toContain('explicitly');

		const block = buildAutoReplyLanguageRuleBlock('en', 'en');
		expect(block).toContain('#### Rule: Automatic language: respond in English');
		expect(block).toContain('TodoWrite');
		expect(block).toContain('file paths');
	});

	it('mixed UI / response language: zh-CN UI explaining English output uses zh-CN narration with English label', () => {
		const rule = createAutoReplyLanguageRule('en', 'zh-CN');
		// Name is zh-CN narration ("自动语言：默认使用…回应") with the English label injected.
		expect(rule.name).toBe('自动语言：默认使用英文回应');
		// Content keeps the zh-CN structural prose ("默认始终使用…")  with the English label.
		expect(rule.content).toContain('默认始终使用英文');
		expect(rule.content).toContain('TodoWrite');
	});
});
