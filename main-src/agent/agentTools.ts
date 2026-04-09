/**
 * Agent 工具定义 — 类似 Cursor / Claude Code 的工具集。
 * 每个工具包含名称、描述和 JSON Schema 参数，供 OpenAI / Anthropic / Gemini 的 tool calling 使用。
 */

export type AgentToolDef = {
	name: string;
	description: string;
	parameters: {
		type: 'object';
		properties: Record<string, Record<string, unknown>>;
		required: string[];
	};
};

export type ToolCall = {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
};

export type ToolResult = {
	toolCallId: string;
	name: string;
	content: string;
	isError: boolean;
};

/** 只读工具：可安全并发执行，不修改文件系统或运行副作用命令（含 Claude Code 风格的 MCP 资源工具） */
export const READ_ONLY_AGENT_TOOL_NAMES = [
	'Read',
	'Glob',
	'Grep',
	'LSP',
	'ListMcpResourcesTool',
	'ReadMcpResourceTool',
] as const;

export function isReadOnlyAgentTool(name: string): boolean {
	return (READ_ONLY_AGENT_TOOL_NAMES as readonly string[]).includes(name);
}

export function agentToolsForComposerMode(mode: 'agent' | 'plan', all: AgentToolDef[] = AGENT_TOOLS): AgentToolDef[] {
	if (mode === 'plan') {
		return all.filter((d) => isReadOnlyAgentTool(d.name) || d.name === 'ask_plan_question');
	}
	return all.filter((d) => d.name !== 'ask_plan_question');
}

export const AGENT_TOOLS: AgentToolDef[] = [
	{
		name: 'Read',
		description:
			'Read a text file under the workspace. Returns content with line numbers (padded line number, pipe, then line). Prefer this over shell cat/type/Get-Content. **file_path** may be absolute if it stays inside the workspace, or relative to the workspace root. By default reads up to 2000 lines starting at line **offset** (1-based); use **limit** for a smaller window or paginate with **offset** on huge files.',
		parameters: {
			type: 'object',
			properties: {
				file_path: {
					type: 'string',
					description: 'Path to the file: workspace-relative, or absolute if under the workspace root.',
				},
				offset: {
					type: 'number',
					description: '1-based starting line to read. Default 1.',
				},
				limit: {
					type: 'number',
					description:
						'Maximum number of lines to return. If omitted, reads up to 2000 lines from offset. Capped at 2000 per call.',
				},
			},
			required: ['file_path'],
		},
	},
	{
		name: 'Write',
		description:
			'Create a new file or completely overwrite an existing file. For small targeted edits on existing files, prefer **Edit**. When asked to persist Async/Cursor-style project rules as `.mdc` files, use `.async/rules/` under the workspace unless the user specifies another path.',
		parameters: {
			type: 'object',
			properties: {
				file_path: {
					type: 'string',
					description: 'Path to the file: workspace-relative, or absolute if under the workspace root.',
				},
				content: { type: 'string', description: 'Full file contents to write' },
			},
			required: ['file_path', 'content'],
		},
	},
	{
		name: 'Edit',
		description:
			'Edit a file by replacing **old_string** with **new_string**. When **replace_all** is false (default), **old_string** must match exactly once. When **replace_all** is true, every occurrence is replaced. If the match is not unique, read more context with **Read** and retry with a longer snippet.',
		parameters: {
			type: 'object',
			properties: {
				file_path: {
					type: 'string',
					description: 'Path to the file: workspace-relative, or absolute if under the workspace root.',
				},
				old_string: {
					type: 'string',
					description: 'Exact text to find (including whitespace and line breaks).',
				},
				new_string: {
					type: 'string',
					description: 'Replacement text (may be empty to delete).',
				},
				replace_all: {
					type: 'boolean',
					description: 'If true, replace every occurrence of old_string; if false, require a single match.',
				},
			},
			required: ['file_path', 'old_string', 'new_string'],
		},
	},
	{
		name: 'Glob',
		description:
			'Find files by glob pattern under the workspace (e.g. `**/*.ts`, `src/**/*.tsx`). Returns workspace-relative paths, sorted, up to 100 matches. Does not search file contents — use **Grep** for that.',
		parameters: {
			type: 'object',
			properties: {
				pattern: {
					type: 'string',
					description: 'Glob pattern (minimatch syntax), relative to the workspace root.',
				},
				path: {
					type: 'string',
					description:
						'Optional subdirectory under the workspace to search in; omit to search from the workspace root.',
				},
			},
			required: ['pattern'],
		},
	},
	{
		name: 'Grep',
		description:
			'A powerful search tool built on ripgrep.\n\nUsage:\n- ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` via Bash; this tool is wired for workspace-safe search.\n- Supports full regex (e.g. "log.*Error", "function\\s+\\w+").\n- Filter files with **glob** (e.g. "*.js", "*.{ts,tsx}") or **type** (e.g. "js", "py", "rust").\n- **output_mode**: "content" shows matching lines (with optional context via -A/-B/-C/context), "files_with_matches" lists paths only (default), "count" shows per-file match counts.\n- Use the **Agent** tool for open-ended searches that need many rounds.\n- Pattern syntax follows ripgrep (not GNU grep): brace literals may need escaping.\n- For patterns spanning lines, set **multiline** to true.\n- Optional **symbol**: when true, search exported symbol names (substring) via the workspace symbol index instead of grepping file contents.',
		parameters: {
			type: 'object',
			properties: {
				pattern: {
					type: 'string',
					description: 'Regular expression to search for in file contents (unless symbol is true)',
				},
				path: {
					type: 'string',
					description:
						'Optional path relative to workspace root: file or directory to search in. Omit to search from the workspace root.',
				},
				glob: {
					type: 'string',
					description:
						'Glob pattern(s) to filter files (e.g. "*.js", "*.{ts,tsx}"). Space-separated; comma-separated allowed when not using brace expansion.',
				},
				output_mode: {
					type: 'string',
					enum: ['content', 'files_with_matches', 'count'],
					description:
						'"content" shows matching lines (supports context and line numbers), "files_with_matches" lists file paths only (default), "count" shows per-file match counts.',
				},
				'-B': {
					type: 'number',
					description: 'Lines of context before each match (ripgrep -B). Only for output_mode "content".',
				},
				'-A': {
					type: 'number',
					description: 'Lines of context after each match (ripgrep -A). Only for output_mode "content".',
				},
				'-C': {
					type: 'number',
					description: 'Lines of context before and after each match (ripgrep -C). Only for output_mode "content".',
				},
				context: {
					type: 'number',
					description: 'Same as -C when set (takes precedence over -B/-A pairing). Only for output_mode "content".',
				},
				'-n': {
					type: 'boolean',
					description: 'Include line numbers in content output (ripgrep -n). Default true for output_mode "content".',
				},
				'-i': {
					type: 'boolean',
					description: 'Case-insensitive search (ripgrep -i).',
				},
				type: {
					type: 'string',
					description: 'File type filter (ripgrep --type), e.g. js, py, rust, go, java.',
				},
				head_limit: {
					type: 'number',
					description:
						'Cap output lines or entries (per mode). Default 250; pass 0 for unlimited (use sparingly).',
				},
				offset: {
					type: 'number',
					description: 'Skip this many lines/entries before applying head_limit (pagination). Default 0.',
				},
				multiline: {
					type: 'boolean',
					description: 'Multiline mode: . matches newlines (ripgrep -U --multiline-dotall). Default false.',
				},
				symbol: {
					type: 'boolean',
					description:
						'If true, search exported symbol names (substring match) via the symbol index instead of grepping file contents.',
				},
			},
			required: ['pattern'],
		},
	},
	{
		name: 'Bash',
		description:
			'Run a shell command in the workspace directory (on Windows the runtime uses PowerShell for the same purpose). Use for tests, installs, builds, git, etc. Do not use Bash for reading or discovering source files when **Read**, **Glob**, or **Grep** can do the job. Do not use Bash to run `grep` or `rg` for codebase search — use **Grep**. 120-second timeout.',
		parameters: {
			type: 'object',
			properties: {
				command: { type: 'string', description: 'The command line to execute' },
			},
			required: ['command'],
		},
	},
	{
		name: 'LSP',
		description:
			'Language-server intelligence for the workspace, routed by **file extension** to LSP servers loaded like **Claude Code**: plugin dirs under `<asyncData>/plugins/<name>/` or `<workspace>/.async/plugins/<name>/` with **`.lsp.json`** or **`plugin.json` → `lspServers`** (each server: **command**, optional **args**, required **extensionToLanguage** map). Legacy **`lsp.servers`** in settings.json is still merged. TS/JS additionally works if **typescript-language-server** is discoverable under the app or workspace `node_modules` (optional).\n\nOperations: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls, getDiagnostics. Use **filePath** plus 1-based **line**/**character** except **getDiagnostics**/**workspaceSymbol** (optional line/char).\n\nIf nothing matches the file extension, add a plugin or legacy server entry. If an LSP method fails, fall back to **Read** / **Grep** / **Bash**.',
		parameters: {
			type: 'object',
			properties: {
				operation: {
					type: 'string',
					enum: [
						'goToDefinition',
						'findReferences',
						'hover',
						'documentSymbol',
						'workspaceSymbol',
						'goToImplementation',
						'prepareCallHierarchy',
						'incomingCalls',
						'outgoingCalls',
						'getDiagnostics',
					],
					description: 'Which LSP operation to run.',
				},
				filePath: {
					type: 'string',
					description:
						'Path to the file: workspace-relative, or absolute if under the workspace root. Required for all operations (including workspaceSymbol, which still anchors context on this file).',
				},
				line: {
					type: 'number',
					description: '1-based line number (required for cursor-based operations).',
				},
				character: {
					type: 'number',
					description: '1-based character offset on the line (required for cursor-based operations).',
				},
			},
			required: ['operation', 'filePath'],
		},
	},
	{
		name: 'Agent',
		description:
			'Spawn a focused sub-agent (Claude Code–style). Use for scoped, autonomous work: deep codebase exploration, refactors isolated to a module, or keeping your main context clean. The sub-agent runs a full tool loop and returns its final text (or runs in background when configured like Claude Code fork). Set subagent_type to "explore" for read-only exploration; use a custom name from user subagent settings for tailored instructions. Omit subagent_type with background-fork enabled in settings (or set run_in_background) to run async: tool returns immediately while work continues. Nested Agent calls are blocked. Maximum nesting depth is 1.',
		parameters: {
			type: 'object',
			properties: {
				prompt: {
					type: 'string',
					description: 'Instructions for the sub-agent (Claude Code `Agent` tool: `prompt`)',
				},
				subagent_type: {
					type: 'string',
					description:
						'Optional: "explore" for read-only exploration; or match a configured subagent name/id for tailored instructions. Omit when using background fork (settings / env) for async execution.',
				},
				context: {
					type: 'string',
					description: 'Optional paths, constraints, or background for the sub-agent',
				},
				run_in_background: {
					type: 'boolean',
					description:
						'If true, sub-agent runs in the background: tool returns immediately with a short notice; streamed nested activity still appears; user gets a completion toast. Same spirit as Claude Code async Agent when fork is enabled.',
				},
			},
			required: ['prompt'],
		},
	},
	{
		name: 'ListMcpResourcesTool',
		description:
			'List available resources from configured MCP (Model Context Protocol) servers. Each returned resource includes standard MCP resource fields plus a **server** field indicating which configured server it belongs to.\n\nParameters:\n- **server** (optional): id or display name of a specific MCP server; omit to return resources from all connected servers.\n\nRequires MCP servers to be connected (enabled in settings).',
		parameters: {
			type: 'object',
			properties: {
				server: {
					type: 'string',
					description:
						'Optional. MCP server id or display name; if omitted, resources from every connected server are listed.',
				},
			},
			required: [],
		},
	},
	{
		name: 'ReadMcpResourceTool',
		description:
			'Read a specific resource from an MCP server by **server** name and resource **uri**.\n\nParameters:\n- **server** (required): MCP server id or display name as configured.\n- **uri** (required): the resource URI to read.\n\nCall **ListMcpResourcesTool** first when you need to discover URIs.',
		parameters: {
			type: 'object',
			properties: {
				server: {
					type: 'string',
					description: 'MCP server id or display name from which to read the resource.',
				},
				uri: { type: 'string', description: 'The resource URI to read.' },
			},
			required: ['server', 'uri'],
		},
	},
	{
		name: 'TodoWrite',
		description:
			'Update the todo list for the current session. Use proactively to track progress on complex multi-step tasks. Always provide the COMPLETE updated todo list (not just changes). Maintain exactly one task as in_progress at all times. Provide both content (imperative form) and activeForm (present continuous form) for each task.',
		parameters: {
			type: 'object',
			properties: {
				todos: {
					type: 'array',
					description: 'The complete updated todo list. Each call replaces the entire list.',
					items: {
						type: 'object',
						properties: {
							content: {
								type: 'string',
								description: 'Task description in imperative form (e.g. "Add unit tests for auth module")',
							},
							status: {
								type: 'string',
								enum: ['pending', 'in_progress', 'completed'],
								description: 'Current task status. Exactly one task should be in_progress at a time.',
							},
							activeForm: {
								type: 'string',
								description: 'Present continuous form shown during execution (e.g. "Adding unit tests")',
							},
						},
						required: ['content', 'status', 'activeForm'],
					},
				},
			},
			required: ['todos'],
		},
	},
	{
		name: 'ask_plan_question',
		description:
			'Plan mode only: ask the user ONE multiple-choice clarification. Keep the old Plan UX shape: provide exactly 4 options total, where the first 3 are concrete recommendations and the 4th is an Other/custom option for free text. The app shows a picker and custom input; your next turn receives the user answer as this tool\'s result text. Call at most one per assistant turn; wait for the result before asking another or drafting `# Plan:`. Do not duplicate the same question in markdown.',
		parameters: {
			type: 'object',
			properties: {
				question: {
					type: 'string',
					description: 'Single concrete question (1–2 short sentences), same language as the user.',
				},
				options: {
					type: 'array',
					description:
						'Exactly 4 options: the first 3 are concrete answer choices, and the 4th must be Other/custom so the user can type their own answer. Each item may be a string label, or an object { id, label }.',
					items: {
						oneOf: [
							{ type: 'string' },
							{
								type: 'object',
								properties: {
									id: { type: 'string' },
									label: { type: 'string' },
								},
								required: ['label'],
							},
						],
					},
				},
			},
			required: ['question', 'options'],
		},
	},
];

export function toOpenAITools(defs: AgentToolDef[]) {
	return defs.map((d) => ({
		type: 'function' as const,
		function: {
			name: d.name,
			description: d.description,
			parameters: d.parameters,
		},
	}));
}

export function toAnthropicTools(defs: AgentToolDef[]) {
	return defs.map((d) => ({
		name: d.name,
		description: d.description,
		input_schema: d.parameters as Record<string, unknown>,
	}));
}
