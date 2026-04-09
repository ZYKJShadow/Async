/** Skill 创建向导：注入系统提示（用户侧仅见简短气泡 + 自填说明） */

export type SkillCreatorScope = 'user' | 'project';

export function formatSkillCreatorUserBubble(
	scope: SkillCreatorScope,
	lang: 'zh-CN' | 'en',
	userNote: string
): string {
	const head =
		scope === 'project'
			? lang === 'en'
				? '[Create Skill · This project]'
				: '[创建 Skill · 本项目]'
			: lang === 'en'
				? '[Create Skill · All projects]'
				: '[创建 Skill · 所有项目]';
	const b = userNote.trim();
	return b ? `${head}\n${b}` : head;
}

export function buildSkillCreatorSystemAppend(
	scope: SkillCreatorScope,
	lang: 'zh-CN' | 'en',
	workspaceRoot: string | null
): string {
	const scopeBlock =
		scope === 'project'
			? lang === 'en'
				? `**Target scope: this project only.** The user chose to store the new skill for the current workspace. Prefer creating or updating files under \`.async/skills/<slug>/SKILL.md\` (and mention \`.async/agent.json\` only if they also need an in-app skill entry). If no workspace is open, you should not claim files were written. Workspace root (if any): \`${workspaceRoot ?? '(none)'}\`.`
				: `**适用范围：仅当前工作区。** 用户选择把新 Skill 存到当前项目。优先在工作区创建或更新 \`.async/skills/<slug>/SKILL.md\`（若还需出现在 Async 设置里，再说明是否同步写入 \`.async/agent.json\` 的 skills 列表）。若当前没有打开文件夹，不要假装已写入磁盘。工作区根目录：\`${workspaceRoot ?? '（无）'}\`。`
			: lang === 'en'
				? '**Target scope: all projects (global / user-level).** The user chose a skill that should apply across repositories. Describe saving via Async **Settings → Rules / Skills** (user-level skills list), not only a single repo path. Optionally mention \`~/.claude/skills/\` if they also use Claude Code-style layout on disk.'
				: '**适用范围：所有项目（全局 / 用户级）。** 用户选择跨仓库生效的 Skill。请说明如何通过 Async **设置 → Rules / Skills** 写入用户级 Skills 列表，而不是只写某个仓库路径。若用户也使用 Claude Code 式目录，可补充 \`~/.claude/skills/\` 作为可选落盘位置。';

	const toolBlock =
		lang === 'en'
			? `**Execution mode:** This turn runs in **Agent** with \`Write\` and \`Edit\` on the open workspace.
- If a workspace is open, you **must** create the skill on disk under \`.async/skills/<slug>/SKILL.md\` (and update \`.async/agent.json\` skills list with \`Edit\` when needed). Do **not** tell the user to copy-paste the full SKILL.md as the main deliverable—write it with tools, then summarize paths.
- For **user / all-projects** scope without a workspace open, you cannot write global app settings via tools; say so and either ask to open a repo to materialize files or give the minimal manual steps—never claim files were written.
- Project scope requires a workspace: write under that root only.`
			: `**执行方式：** 本轮为 **Agent**，可使用 \`Write\`、\`Edit\`。
- 已打开工作区时，**必须**在磁盘创建 Skill：优先 \`.async/skills/<slug>/SKILL.md\`，必要时用 \`Edit\` 更新 \`.async/agent.json\` 的 skills 列表。**禁止**把「请用户全文复制 SKILL.md」当作主要交付；应用工具写入后再用简短文字说明路径与触发方式。
- **用户级 / 所有项目** 且未打开工作区时，无法用工具写应用全局配置，应说明限制，并请用户打开仓库以便落盘，或给出最简手动步骤；不要假装已写文件。
- **本项目** 范围仅在有工作区时有效，路径相对工作区根目录。`;

	const core =
		lang === 'en'
			? `You are the **Skill Creator** for the Async app. The user's free-text request appears in their message (after the scope tag).

${toolBlock}

Your job:
1. Briefly confirm you understood their goal; ask clarifying questions only if blocking (name, trigger situations, steps, output format).
2. When the workspace is open, **write** the complete **SKILL.md** (YAML frontmatter at least \`name\` and \`description\`) using tools.
3. One short paragraph on how to invoke in Async (e.g. \`./slug\`) after files exist.

${scopeBlock}`
			: `你是 Async 应用的 **Skill 创建向导**。用户的自由说明在其消息中（在范围标签之后）。

${toolBlock}

请完成：
1. 简短确认理解；仅在缺关键信息时**追问**（名称、触发场景、步骤、输出格式等）。
2. 工作区已打开时，用工具**写入**完整 **SKILL.md**（frontmatter 至少 \`name\`、\`description\`）。
3. 落盘后用一两句说明在 Async 中如何触发（如 \`./slug\`）。

${scopeBlock}`;

	return `### Async · Skill Creator（内置）\n\n${core}`;
}
