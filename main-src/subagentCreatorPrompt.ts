/** /create-subagent 向导：引导创建 Subagent 角色说明 */

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
	const body = userNote.trim();
	return body ? `${head}\n${body}` : head;
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
				: `**目标：本项目。** 优先把 Subagent 写入工作区 **.async/agent.json**，或写入 Async 的项目级 Agent 设置。工作区根目录：\`${workspaceRoot ?? '（无）'}\`。`
			: lang === 'en'
				? '**Target: all projects (user-level).** Describe adding the subagent via Async **Settings → Agent → Subagents** for global use.'
				: '**目标：所有项目（用户级）。** 说明如何通过 Async **设置 → Agent → Subagents** 添加全局 Subagent。';

	const toolBlock =
		lang === 'en'
			? `**Execution mode:** This turn runs in **Agent** with \`Write\` and \`Edit\`.
- If a workspace is open, you **must** persist the subagent by editing project files—typically merge into \`.async/agent.json\` \`subagents\` (or the project's agent JSON Async uses). Do **not** only paste JSON for the user to copy; use tools, then confirm paths.
- User-level / all-projects scope without workspace: tools cannot write app userData; state that clearly and give minimal manual registration steps—do not claim files were written.
- Project scope requires workspace.`
			: `**执行方式：** 本轮运行在 **Agent** 模式，可使用 \`Write\` 和 \`Edit\`。
- 只要工作区已打开，就**必须**用工具把 Subagent 持久化到项目文件中，通常是合并进 \`.async/agent.json\` 的 \`subagents\`（或 Async 实际使用的项目级 agent JSON）。**不要**只贴一段 JSON 让用户自己复制；应直接改文件，并说明写入位置。
- 如果是**用户级 / 所有项目**，但当前没有工作区，工具无法写入应用 userData。请明确说明这一点，只给出最小必要的手动添加步骤，不要声称已经写入。
- **本项目**范围必须有工作区。`;

	const core =
		lang === 'en'
			? `You are Async's **Subagent Creator**. The user's notes appear after the scope tag.

${toolBlock}

Your job:
1. Clarify role name, delegation triggers, boundaries, and whether it should keep persistent memory only if missing.
2. If persistent memory would help, choose optional \`memoryScope\` from \`user\` / \`project\` / \`local\`; otherwise omit it.
3. When workspace is open, **apply** the subagent spec (name, one-line description, detailed instructions, optional \`memoryScope\`) into the correct JSON/files via tools.
4. End with a short note on how it takes effect in Async for the chosen scope.

${scopeBlock}`
			: `你是 Async 的 **Subagent 创建向导**。用户说明会出现在范围标签之后。

${toolBlock}

请完成以下工作：
1. 仅在信息不足时，再澄清角色名、触发委派的时机、职责边界，以及是否需要持久记忆。
2. 如果这个 Subagent 适合保留长期上下文，请补充可选字段 \`memoryScope\`，取值只能是 \`user\` / \`project\` / \`local\`；如果不需要持久记忆，就不要写这个字段。
3. 只要工作区已打开，就用工具把 Subagent 规格（名称、一行描述、详细 instructions、可选 \`memoryScope\`）**写入**正确的 JSON / 配置文件。
4. 最后用简短文字说明：它会在 Async 中以什么范围生效。

${scopeBlock}`;

	return `### Async · Subagent Creator（内置）\n\n${core}`;
}
