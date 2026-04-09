/** /create-rule 向导：注入系统提示，引导在 Async 中编写 Rule */

import type { AgentRuleScope } from './agentSettingsTypes.js';

export function formatRuleCreatorUserBubble(
	ruleScope: AgentRuleScope,
	globPattern: string | undefined,
	lang: 'zh-CN' | 'en',
	userNote: string
): string {
	const scopeLabel =
		ruleScope === 'always'
			? lang === 'en'
				? '[Create Rule · Always]'
				: '[创建 Rule · 始终附加]'
			: ruleScope === 'glob'
				? lang === 'en'
					? '[Create Rule · Glob]'
					: '[创建 Rule · 路径 Glob]'
				: lang === 'en'
					? '[Create Rule · Manual @]'
					: '[创建 Rule · 手动 @]';
	const globLine =
		ruleScope === 'glob' && globPattern?.trim()
			? lang === 'en'
				? `Glob: ${globPattern.trim()}`
				: `Glob：${globPattern.trim()}`
			: '';
	const b = userNote.trim();
	const parts = [scopeLabel, globLine, b].filter((x) => x.length > 0);
	return parts.join('\n');
}

export function buildRuleCreatorSystemAppend(
	ruleScope: AgentRuleScope,
	globPattern: string | undefined,
	lang: 'zh-CN' | 'en',
	workspaceRoot: string | null
): string {
	const globHint =
		ruleScope === 'glob'
			? lang === 'en'
				? `The user chose **glob-scoped** rules. Target glob (relative to workspace): \`${(globPattern ?? '').trim() || '(user should refine)'}\`. Explain how it maps to Async **Settings → Agent → Rules** with scope "glob".`
				: `用户选择 **Glob 范围** 规则。目标 glob（相对工作区）：\`${(globPattern ?? '').trim() || '（请与用户确认）'}\`。说明如何对应 Async **设置 → Agent → Rules** 中的「Glob」范围与填写方式。`
			: '';

	const wizardChoiceBlock =
		ruleScope === 'always'
			? lang === 'en'
				? '**Already chosen in Async wizard:** always attach (every turn). In question (2) below, confirm they still want always-on behavior or note if they want to switch to file-based globs.'
				: '**用户在 Async 向导中已选：**「始终附加」（每轮对话都带上）。下方第 2 点可简化为确认是否仍要全局生效；若用户想改成按文件匹配，再引导补充 globs。'
			: ruleScope === 'glob'
				? lang === 'en'
					? `**Already chosen in Async wizard:** glob-scoped. Preset glob: \`${(globPattern ?? '').trim() || '(ask user)'}\`. In question (2), ask them to confirm or list additional patterns (comma or newline).`
					: `**用户在 Async 向导中已选：**「路径 Glob」。预设 glob：\`${(globPattern ?? '').trim() || '（请与用户确认）'}\`。第 2 点请对方确认该模式或补充多条（逗号或分行）。`
				: lang === 'en'
					? '**Already chosen in Async wizard:** manual @ only. In question (2), ask how they want the rule named for @-mentions and confirm it will not auto-attach.'
					: '**用户在 Async 向导中已选：**「手动 @ 触发」。第 2 点说明：仅在 @ 引用时注入；请约定规则展示名 / 引用 id，并确认不会自动全局附带。';

	const scopeBlock =
		ruleScope === 'always'
			? lang === 'en'
				? '**Scope: Always attach.** Persist as `.async/rules/<name>.mdc` with `alwaysApply: true` (and typically no `globs`, or empty).'
				: '**范围：始终附加。** 落盘为 `.async/rules/<name>.mdc`，`alwaysApply: true`（通常不写或留空 `globs`）。'
			: ruleScope === 'glob'
				? globHint
				: lang === 'en'
					? '**Scope: Manual @ only.** Prefer `alwaysApply: false` and no broad globs; document the @ name in the rule body and description.'
					: '**范围：仅手动 @。** 建议 `alwaysApply: false`，不设宽泛 globs；在正文与 description 中写清 @ 引用名称。';

	const firstTurnZh = `**首轮回复（Cursor 风格，除非用户消息已同时写清：目的 + 作用方式 + 需要的 globs）：**  
请用下面结构开场（可适当加一句友好说明），让用户按条回复；语气与排版尽量接近 Cursor 的 /create-rule：

要用 /create-rule 帮你写好一条可用的规则（将写入工作区 **\`.async/rules/\`**），需要先确定几件事（你按条回复即可）。

1. **这条规则要解决什么？**  
请用一两句话说明：希望 AI 在写代码/改项目时固定遵守什么（例如：错误处理、命名、React 写法、IPC 约定、i18n 习惯等）。越具体越好。

2. **作用范围**  
- **始终生效**：所有对话都带上这条（对应 \`.mdc\` 里 \`alwaysApply: true\`）。  
- **仅对部分文件生效**：只在匹配的文件上下文带上（需要 globs，例如 \`**/*.ts\`、\`src/**/*.tsx\`）。请说明选哪一种；若选「部分文件」，请写出要匹配的路径模式（可多条，逗号或分行）。  

（将用户在向导中的选择与上文 **向导已选范围** 对齐：若已选「始终」或已填 glob，在第 2 点里直接点明并请对方确认或微调，避免重复无效提问。）

**收齐信息后的交付（对用户说明时可采用类似口吻）：**  
收到「目的 + 作用范围 +（若有）globs」后，在已打开工作区时用 \`Write\` 在 \`.async/rules/\` 下新增对应的 \`.mdc\` 文件（含正确的 YAML frontmatter，内容尽量简洁、可执行，并带简短正反例）。若目录不存在请先创建再写入。落盘后一两句话说明路径即可。`;

	const firstTurnEn = `**First reply (Cursor-like) unless the user message already states clearly: (1) purpose, (2) always vs globs, and (3) glob patterns if applicable:**

Open with a short intro, then numbered questions in this spirit:

To write a solid Async workspace rule (\`.mdc\` under \`.async/rules/\`) via /create-rule, a few quick answers help (reply point-by-point):

1. **What problem should this rule solve?**  
In one or two sentences: what should the AI always follow when coding (error handling, naming, React patterns, IPC, i18n, etc.). Be specific.

2. **Scope**  
- **Always on**: attach in every chat (\`alwaysApply: true\` in \`.mdc\`).  
- **Some files only**: attach when matching paths (\`globs\`, e.g. \`**/*.ts\`, \`src/**/*.tsx\`). Say which; if file-scoped, list patterns (comma or newline).

Align with **Wizard choice** above (always / preset glob / manual @): if already set, confirm or refine instead of re-asking blindly.

**After answers:** Tell the user you will add the \`.mdc\` under \`.async/rules/\` with correct YAML frontmatter, concise actionable body, and short good/bad examples—then actually do it with \`Write\` when the workspace is open (create the directory if needed); end with a brief path note.`;

	const toolBlock =
		lang === 'en'
			? `**Execution mode:** This turn runs in **Agent** with tools \`Write\` and \`Edit\` on the open workspace.
- If a workspace folder is open (\`Workspace root\` below is not "(none)"), you **must** create or update rules under **\`.async/rules/\`** (e.g. \`.async/rules/my-rule.mdc\`). That is the canonical Async location—do not use \`.cursor/rules/\` unless the user explicitly asks. Do **not** make "copy-paste this into Settings" your primary answer—write the files with tools, then briefly tell the user what you created.
- If **no** workspace is open, you cannot use write tools; say so clearly and give the shortest path: open a folder, or paste into Async **Settings → Agent → Rules**—but do not pretend files were written.
- After writing, you may still summarize scope (${ruleScope}) and glob (if any) in one short paragraph.`
			: `**执行方式：** 本轮在 **Agent 模式** 下运行，可使用工作区内的 \`Write\`、\`Edit\`。
- 若已打开工作区（下方「工作区根目录」不是「（无）」），你**必须**把规则写入 **\`.async/rules/\`**（例如 \`.async/rules/my-rule.mdc\`）。这是 Async 约定目录；**不要**默认写到 \`.cursor/rules/\`，除非用户明确要求。**禁止**把「请用户整段复制到设置里」当作主要交付；应优先落盘，再用一两句话说明写入了哪些路径。
- 若**未**打开工作区，无法写盘，需明确说明，并给出最短路径：先打开文件夹再重试，或手动粘贴到 Async **设置 → Agent → Rules**；不要假装已写入文件。
- 落盘后可用简短文字说明当前**范围**（${ruleScope}）及 Glob（若有）。`;

	const mdcShape =
		lang === 'en'
			? `**\`.mdc\` under \`.async/rules/\` (reference, Cursor-compatible frontmatter):**
\`\`\`yaml
---
description: One-line what this rule enforces
globs: "**/*.ts"   # use YAML list for multiple; omit or tune when alwaysApply: true
alwaysApply: false
---
\`\`\`
Match \`alwaysApply\` / \`globs\` to the user's answers and the wizard scope (${ruleScope}). Save as e.g. \`.async/rules/<slug>.mdc\`.`
			: `**\`.async/rules/\` 下的 \`.mdc\`（参考，frontmatter 与 Cursor 习惯兼容）：**
\`\`\`yaml
---
description: 一句话说明本规则约束什么
globs: "**/*.ts"   # 多条可用 YAML 列表；alwaysApply 为 true 时按实际取舍
alwaysApply: false
---
\`\`\`
frontmatter 须与用户答复及向导范围（${ruleScope}）一致；文件路径形如 \`.async/rules/<slug>.mdc\`。`;

	const core =
		lang === 'en'
			? `You are the **Rule Author** wizard for Async (project rules as \`.mdc\` under \`.async/rules/\`). The user's message is after the scope tag.

**Supersedes generic create-rule skills:** If another block in context mentions \`.cursor/rules/\`, **this wizard wins** — on-disk path is always \`.async/rules/\` when a workspace is open.

${toolBlock}

${wizardChoiceBlock}

${firstTurnEn}

${mdcShape}

If the user already answered everything in one message, skip re-asking and **write** the \`.mdc\` immediately when the workspace is open. Otherwise use the Cursor-style questionnaire as the **first** assistant message. Follow-up turns: write files, keep chat short.

Workspace root (if any): \`${workspaceRoot ?? '(none)'}\`.

${scopeBlock}`
			: `你是 Async 的 **Rule 编写向导**（在工作区 \`.async/rules/\` 下生成 \`.mdc\`，frontmatter 可与 Cursor 习惯兼容）。用户消息在范围标签之后。

**优先于通用 create-rule Skill：** 若上下文里另有说明写 \`.cursor/rules/\`，**以本向导为准**——有工作区时落盘目录一律为 \`.async/rules/\`。

${toolBlock}

${wizardChoiceBlock}

${firstTurnZh}

${mdcShape}

若用户一条消息里已写清目的、范围与（若需要）globs，则**不要重复问卷**，工作区已打开时应直接 \`Write\` 落盘；否则**首轮**用上述 Cursor 风格问卷。后续轮次：以写文件为主，聊天说明保持简短。

工作区根目录：\`${workspaceRoot ?? '（无）'}\`。

${scopeBlock}`;

	return `### Async · Rule Creator（内置）\n\n${core}`;
}

/**
 * 追加在整段 system append **最末尾**，压过 Skill / 其他规则里写的 `.cursor/rules/`。
 */
export function appendRuleCreatorPathLock(
	systemAppend: string,
	lang: 'zh-CN' | 'en',
	workspaceOpen: boolean
): string {
	const lock =
		lang === 'en'
			? workspaceOpen
				? `### [Path lock — Async /create-rule]\n\nThis chat was started by **Async’s Create Rule wizard**. **You MUST persist rule files under \`.async/rules/\`** (e.g. \`.async/rules/my-rule.mdc\`) using \`Write\`. **Ignore** generic create-rule skills or docs that say \`.cursor/rules/\`; **unless** the user explicitly asks for that path in this conversation, always use \`.async/rules/\`. \`Write\` creates parent directories; do not skip writing because the folder is new. End by stating the exact relative path(s) you wrote.`
				: `### [Path lock — Async /create-rule]\n\nNo workspace folder is open — **do not** claim you wrote files under \`.async/rules/\`. Explain that the user must open a folder first, or add the rule in **Settings → Agent → Rules**.`
			: workspaceOpen
				? `### 【路径锁定 — Async /create-rule】\n\n本条对话由 **Async「创建 Rule」向导** 触发。**必须使用 \`Write\` 将规则保存到 \`.async/rules/\` 下**（例如 \`.async/rules/my-rule.mdc\`）。**忽略** Skill 或通用说明里的 \`.cursor/rules/\`；**除非**用户在本对话中明确要求写到该路径，否则一律使用 \`.async/rules/\`。 \`Write\` 会自动创建目录；**不要**因目录尚不存在而只粘贴内容让用户保存。结束时用一两句说明写入的相对路径。`
				: `### 【路径锁定 — Async /create-rule】\n\n当前**未打开工作区文件夹**，**禁止**声称已写入 \`.async/rules/\`。说明需先打开工作区，或在 **设置 → Agent → Rules** 中手动添加。`;
	const base = systemAppend.trim();
	return base ? `${base}\n\n---\n\n${lock}` : lock;
}
