import type { AppLocale } from './i18n';

export const AUTO_REPLY_LANGUAGE_RULE_ID = '__auto-reply-language__';

function normalizeLocale(raw: string | null | undefined): string {
	const value = String(raw ?? '').trim();
	if (!value) {
		return 'en';
	}
	try {
		return new Intl.Locale(value).toString();
	} catch {
		return value;
	}
}

function languageLabelForUi(locale: string, uiLocale: AppLocale): string {
	const normalized = normalizeLocale(locale).toLowerCase();
	if (normalized === 'zh-cn' || normalized.startsWith('zh-hans')) {
		return uiLocale === 'en' ? 'Simplified Chinese' : '简体中文';
	}
	if (normalized.startsWith('en')) {
		return uiLocale === 'en' ? 'English' : '英文';
	}
	try {
		const display = new Intl.DisplayNames([uiLocale], { type: 'language' });
		const base = normalized.split('-')[0] || normalized;
		return display.of(base) ?? normalizeLocale(locale);
	} catch {
		return normalizeLocale(locale);
	}
}

function buildRuleName(locale: string, uiLocale: AppLocale): string {
	const label = languageLabelForUi(locale, uiLocale);
	return uiLocale === 'en'
		? `Automatic language: respond in ${label}`
		: `自动语言：默认使用${label}回应`;
}

/**
 * Build the multi-line rule body.
 *
 * Why so verbose: the previous wording ("reply in {label}") was too narrow —
 * models read "reply" as "the final assistant bubble only" and happily produced
 * tool arguments (TodoWrite content/activeForm, ask_plan_question prompts, etc.)
 * and chain-of-thought in English. This expanded form spells out every channel
 * that should follow the user's language, and explicitly carves out the
 * technical tokens that MUST stay verbatim so the model doesn't translate file
 * paths or identifiers.
 */
function buildRuleContent(locale: string, uiLocale: AppLocale): string {
	const label = languageLabelForUi(locale, uiLocale);
	if (uiLocale === 'en') {
		return [
			`Use ${label} by default for every natural-language output you produce, including:`,
			`- the final user-facing reply;`,
			`- internal reasoning / thinking tokens;`,
			`- natural-language fields inside tool arguments (e.g. TodoWrite \`content\` and \`activeForm\`, ask_plan_question prompts and options, request_user_input prompts);`,
			`- comments inside code that are addressed to the user.`,
			`Keep technical tokens verbatim — file paths, CLI flags, identifiers, library / framework / tool names, error strings copied from logs, etc. — even when the surrounding sentence is in ${label}.`,
			`Switch to another language only when the user explicitly asks for it in the current turn.`,
		].join('\n');
	}
	return [
		`默认始终使用${label}进行所有自然语言输出，包括：`,
		`- 面向用户的最终回答；`,
		`- 内部思考与推理（thinking / reasoning）；`,
		`- 工具调用参数中的自然语言字段（例如 TodoWrite 的 \`content\` 与 \`activeForm\`、ask_plan_question 的题面与选项、request_user_input 的题面等）；`,
		`- 写给用户阅读的代码注释。`,
		`文件路径、命令行参数、代码标识符、库 / 框架 / 工具名、原样引用的日志或错误字符串等技术 token 即便出现在${label}句子里也保持原样，不要翻译。`,
		`仅当用户在当前轮次中明确要求切换语言时，才使用其他语言。`,
	].join('\n');
}

export function createAutoReplyLanguageRule(locale: string, uiLocale: AppLocale): {
	id: string;
	name: string;
	content: string;
	scope: 'always';
	enabled: true;
} {
	return {
		id: AUTO_REPLY_LANGUAGE_RULE_ID,
		name: buildRuleName(locale, uiLocale),
		content: buildRuleContent(locale, uiLocale),
		scope: 'always',
		enabled: true,
	};
}

export function buildAutoReplyLanguageRuleBlock(locale: string, uiLocale: AppLocale): string {
	const rule = createAutoReplyLanguageRule(locale, uiLocale);
	return `#### Rule: ${rule.name}\n${rule.content}`;
}
