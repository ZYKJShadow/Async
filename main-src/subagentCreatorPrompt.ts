/** /create-subagent 向导：引导编写 Subagent 角色说明 */

export type SubagentCreatorScope = 'user' | 'project';

export function formatSubagentCreatorUserBubble(
	scope: SubagentCreatorScope,
	lang: 'zh-CN' | 'en',
	userNote: string
): string {
	const head =
		scope === 'project'
			? lang === 'en'
				? '[Create Subagent · This project]'
				: '[创建 Subagent · 本项目]'
			: lang === 'en'
				? '[Create Subagent · All projects]'
				: '[创建 Subagent · 所有项目]';
	const b = userNote.trim();
	return b ? `${head}\n${b}` : head;
}

export function buildSubagentCreatorSystemAppend(
	scope: SubagentCreatorScope,
	lang: 'zh-CN' | 'en',
	workspaceRoot: string | null
): string {
	const scopeBlock =
		scope === 'project'
			? lang === 'en'
				? `**Target: this project.** Prefer adding the subagent to workspace **.async/agent.json** or project-scoped agent settings in Async. Workspace root: \`${workspaceRoot ?? '(none)'}\`.`
				: `**目标：本项目。** 优先写入工作区 **.async/agent.json** 或 Async 中项目级 Subagents。工作区根：\`${workspaceRoot ?? '（无）'}\`。`
			: lang === 'en'
				? '**Target: all projects (user-level).** Describe adding the subagent via Async **Settings → Agent → Subagents** for global use.'
				: '**目标：所有项目（用户级）。** 说明如何通过 Async **设置 → Agent → Subagents** 添加全局子代理。';

	const toolBlock =
		lang === 'en'
			? `**Execution mode:** This turn runs in **Agent** with \`write_to_file\` and \`str_replace\`.
- If a workspace is open, you **must** persist the subagent by editing project files—typically merge into \`.async/agent.json\` \`subagents\` (or the project's agent JSON Async uses). Do **not** only paste JSON for the user to copy; use tools, then confirm paths.
- User-level / all-projects scope without workspace: tools cannot write app userData; state that clearly and give minimal manual registration steps—do not claim files were written.
- Project scope requires workspace.`
			: `**执行方式：** 本轮为 **Agent**，可使用 \`write_to_file\`、\`str_replace\`。
- 已打开工作区时，**必须**把 Subagent **写入磁盘**，通常合并进 \`.async/agent.json\` 的 \`subagents\`（或 Async 实际使用的项目级 agent 配置）。**禁止**只输出一大段 JSON 让用户自己复制粘贴；应用工具更新文件后再简要说明。
- **用户级** 且未打开工作区时，无法用工具写全局配置，需说明并请用户打开工作区或到设置中手动添加；不要假装已写入。
- **本项目** 范围必须有工作区。`;

	const core =
		lang === 'en'
			? `You are the **Subagent Creator** for Async. The user's notes appear after the scope tag.

${toolBlock}

Your job:
1. Clarify role name, delegation triggers, and boundaries only if missing.
2. When workspace is open, **apply** the subagent spec (name, one-line description, detailed instructions) into the correct JSON/files via tools.
3. Short note on how it appears in Async for the chosen scope.

${scopeBlock}`
			: `你是 Async 的 **Subagent 创建向导**。用户的说明在范围标签之后。

${toolBlock}

请完成：
1. 仅在信息不足时澄清角色名、委派时机、边界。
2. 工作区已打开时，用工具把 Subagent 规格（名称、一行描述、详细指令）**写入**对应 JSON/配置文件。
3. 用简短文字说明在 Async 所选范围下如何生效。

${scopeBlock}`;

	return `### Async · Subagent Creator（内置）\n\n${core}`;
}
