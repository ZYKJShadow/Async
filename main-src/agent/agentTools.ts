/**
 * Agent 工具定义。
 * 每个工具包含名称、描述和 JSON Schema 参数，供 OpenAI / Anthropic / Gemini 的 tool calling 使用。
 */

import type { AnthropicToolResultContent, AnthropicToolSchema } from '../llm/anthropicBeta.js';
import { buildAnthropicToolSchemas, buildOpenAIToolSchemas } from './toolSchemaCache.js';

export type AgentToolDef = {
	name: string;
	description: string;
	shouldDefer?: boolean;
	alwaysLoad?: boolean;
	maxResultSizeChars?: number;
	strict?: boolean;
	eagerInputStreaming?: boolean;
	isMcp?: boolean;
	schemaCacheKey?: string;
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
	structuredContent?: AnthropicToolResultContent;
	isError: boolean;
};

/** 只读工具：可安全并发执行，不修改文件系统或运行副作用命令（含 MCP 资源工具） */
export const READ_ONLY_AGENT_TOOL_NAMES = [
	'Read',
	'view_image',
	'Glob',
	'Grep',
	'LSP',
	'ListMcpResourcesTool',
	'ReadMcpResourceTool',
	'ToolSearch',
] as const;

export function isReadOnlyAgentTool(name: string): boolean {
	return (READ_ONLY_AGENT_TOOL_NAMES as readonly string[]).includes(name);
}

export function agentToolsForComposerMode(
	mode: 'agent' | 'plan' | 'team',
	all: AgentToolDef[] = AGENT_TOOLS
): AgentToolDef[] {
	if (mode === 'plan') {
		return all.filter(
			(d) =>
				(isReadOnlyAgentTool(d.name) && d.name !== 'ToolSearch') ||
				d.name === 'ask_plan_question' ||
				d.name === 'request_user_input' ||
				d.name === 'plan_submit_draft'
		);
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
		name: 'view_image',
		description:
			'Load a local image file from the workspace for model inspection. Prefer this over **Browser** when the target is an existing local PNG/JPG/JPEG/GIF/WEBP file rather than a webpage. Accepts a workspace-relative path, or an absolute path if it stays inside the workspace root.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path to the image file: workspace-relative, or absolute if under the workspace root.',
				},
				detail: {
					type: 'string',
					description:
						'Optional detail override. The only supported value is `original`; omit it for default behavior.',
				},
			},
			required: ['path'],
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
			'Run a shell command in the workspace directory (on Windows the runtime uses PowerShell for the same purpose). Use for tests, installs, builds, git, etc. Do not use Bash for reading or discovering source files when **Read**, **Glob**, or **Grep** can do the job. Do not use Bash to run `grep` or `rg` for codebase search — use **Grep**. Default timeout is 120 seconds; set **timeout_ms** for slower installs/downloads.',
		parameters: {
			type: 'object',
			properties: {
				command: { type: 'string', description: 'The command line to execute' },
				timeout_ms: {
					type: 'number',
					description:
						'Optional max milliseconds to wait for the command to finish. Default 120000, max 600000.',
				},
			},
			required: ['command'],
		},
	},
	{
		name: 'Terminal',
		description:
			"Interact with the app's shared Universal Terminal sessions. Sessions are persistent pty processes (the user's real shell) that survive even when no terminal window is open. Use this when you need an interactive session, want to drive a long-running or REPL-style command, or need to keep terminal state (cwd, env, background processes) across calls. For one-shot commands, prefer **Bash** unless you specifically need a saved Universal Terminal profile. You can also enumerate saved Universal Terminal profiles, then open one in the background by profile id or name. This is the supported way to reuse saved SSH profiles without opening the terminal window.\n\nActions: **open** (spawn a new session, optionally from a saved profile, returns id), **write** (send keystrokes/data; include \\r or \\n to submit a line), **read** (return the tail of the output buffer), **list** (enumerate active sessions), **list_profiles** (enumerate saved terminal profiles, including SSH), **resize** (change cols/rows), **close** (kill session), **run** (one-shot convenience for local/non-interactive shells), **exec** (execute a one-shot command through a saved SSH profile with no visible terminal window). For **run**/**exec**, set **run_in_background** to return immediately with a session id; if a foreground wait times out, the session is kept so you can continue with **read**/**close**.",
		parameters: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: ['open', 'write', 'read', 'list', 'list_profiles', 'resize', 'close', 'run', 'exec'],
					description: 'Which terminal operation to perform.',
				},
				session_id: {
					type: 'string',
					description: 'Session id returned by open/list. Required for write/read/resize/close.',
				},
				data: {
					type: 'string',
					description:
						'For write: raw bytes to send to the pty. Include \\r or \\n to submit a command. Control chars like \\x03 (Ctrl-C) are allowed.',
				},
				command: {
					type: 'string',
					description: 'For run/exec: the command line to execute in a one-shot session.',
				},
				profile_id: {
					type: 'string',
					description:
						'For open: optional saved terminal profile id or exact profile name. For exec: required saved SSH profile id or exact profile name. Use list_profiles first to discover SSH/local profiles. When set, the profile decides shell/args/env/auth behavior and no terminal window is shown.',
				},
				cwd: {
					type: 'string',
					description:
						'For open/run without profile_id: initial working directory. Workspace-relative or absolute inside the workspace. Defaults to the workspace root.',
				},
				shell: {
					type: 'string',
					description:
						'For open/run without profile_id: shell executable path. Defaults to the platform shell (cmd.exe on Windows, $SHELL on Unix).',
				},
				title: {
					type: 'string',
					description: 'For open: human-readable title shown in the terminal window tab.',
				},
				cols: {
					type: 'number',
					description: 'For open/resize: column count. Defaults to 120.',
				},
				rows: {
					type: 'number',
					description: 'For open/resize: row count. Defaults to 30.',
				},
				max_bytes: {
					type: 'number',
					description:
						'For read: maximum bytes to return from the tail of the session buffer. Default 16384, max 262144.',
				},
				timeout_ms: {
					type: 'number',
					description:
						'For run/exec: max milliseconds to wait for the command to exit before killing it. Default 120000, max 600000.',
				},
				run_in_background: {
					type: 'boolean',
					description:
						'For run/exec: if true, start the command and return immediately with a session id. Use read/list/close to monitor it later.',
				},
			},
			required: ['action'],
		},
	},
	{
		name: 'Browser',
		description:
			'Control the app\'s dedicated browser window for the current Async session. Use this to open or steer pages, read visible page content, capture webpage screenshots, click or fill page elements, wait for selectors to appear, and inspect/update browser networking settings (User-Agent, Accept-Language, extra request headers, proxy) plus optional in-page fingerprint spoofing (navigator/screen/WebGL/Canvas/WebRTC) via `set_config.fingerprint`.',
		parameters: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: [
						'get_config',
						'get_state',
						'navigate',
						'read_page',
						'screenshot_page',
						'click_element',
						'input_text',
						'wait_for_selector',
						'close_sidebar',
						'reload',
						'stop',
						'go_back',
						'go_forward',
						'close_tab',
						'set_config',
						'reset_config',
					],
					description: 'Browser action to perform.',
				},
				url: {
					type: 'string',
					description:
						'For navigate: a URL or plain search text. Search text is opened as a Bing search, matching the browser UI behavior.',
				},
				new_tab: {
					type: 'boolean',
					description: 'For navigate: open the target in a new tab instead of reusing the active tab.',
				},
				tab_id: {
					type: 'string',
					description:
						'Optional tab id for reload/stop/go_back/go_forward/close_tab/read_page/screenshot_page/click_element/input_text/wait_for_selector. Omit to target the active tab.',
				},
				selector: {
					type: 'string',
					description:
						'For read_page: optional CSS selector to extract from instead of the whole page body. For click_element, input_text, and wait_for_selector: required CSS selector to target.',
				},
				include_html: {
					type: 'boolean',
					description: 'For read_page: include truncated HTML for the selected root element in addition to visible text.',
				},
				max_chars: {
					type: 'number',
					description: 'For read_page: maximum visible text characters to return. Default about 12000, capped by the app.',
				},
				wait_for_load: {
					type: 'boolean',
					description:
						'For read_page, screenshot_page, click_element, input_text, and wait_for_selector: wait for the current page load to settle before operating. Default true.',
				},
				text: {
					type: 'string',
					description:
						'For input_text: the text value to place into the matched element. This replaces the current value or text content.',
				},
				press_enter: {
					type: 'boolean',
					description:
						'For input_text: after filling the value, dispatch Enter key events and submit the nearest form when possible.',
				},
				visible: {
					type: 'boolean',
					description:
						'For wait_for_selector: if true, require the matched element to be visible with non-zero size.',
				},
				file_path: {
					type: 'string',
					description:
						'For screenshot_page: optional output path. Workspace-relative or absolute inside the workspace. If omitted, the app saves to `.async/browser-captures/` when a workspace is open, otherwise to a temp folder.',
				},
				timeout_ms: {
					type: 'number',
					description:
						'For read_page, screenshot_page, wait_for_selector, click_element, and input_text: optional timeout for the browser-side operation.',
				},
				userAgent: {
					type: 'string',
					description: 'For set_config: override User-Agent. Pass an empty string to clear it.',
				},
				acceptLanguage: {
					type: 'string',
					description: 'For set_config: override Accept-Language. Pass an empty string to clear it.',
				},
				extraHeadersText: {
					type: 'string',
					description:
						'For set_config: extra request headers as plain text, one `Header-Name: value` per line. Pass an empty string to clear all custom headers.',
				},
				blockTrackers: {
					type: 'boolean',
					description: 'For set_config: enable or disable blocking of common ad and tracking domains. Default true.',
				},
				proxyMode: {
					type: 'string',
					enum: ['system', 'direct', 'custom'],
					description: 'For set_config: choose system proxy, no proxy, or custom proxy rules.',
				},
				proxyRules: {
					type: 'string',
					description: 'For set_config: Electron proxyRules string. Required when the resulting proxyMode is custom.',
				},
				proxyBypassRules: {
					type: 'string',
					description: 'For set_config: optional Electron proxyBypassRules string.',
				},
				fingerprint: {
					type: 'object',
					description:
						'For set_config: optional partial fingerprint overrides injected on each top-level navigation (`dom-ready`). Omit to leave fingerprint unchanged. Pass `{}` to clear all overrides. Unset sub-fields keep their previous values; use empty string on string fields to drop that override.',
					properties: {
						platform: { type: 'string', description: 'navigator.platform, e.g. Win32, MacIntel, Linux x86_64' },
						languages: {
							type: 'string',
							description: 'Comma-separated navigator.languages list, e.g. "en-US, en".',
						},
						hardwareConcurrency: { type: 'number', description: 'navigator.hardwareConcurrency (integer).' },
						deviceMemory: { type: 'number', description: 'navigator.deviceMemory in GB (integer).' },
						screenWidth: { type: 'number', description: 'screen.width / availWidth when height is set.' },
						screenHeight: { type: 'number', description: 'screen.height; availHeight uses height minus offset.' },
						availHeightOffset: {
							type: 'number',
							description: 'Pixels subtracted from screenHeight for screen.availHeight (taskbar). Default 40 in the injected script.',
						},
						devicePixelRatio: { type: 'number', description: 'window.devicePixelRatio (0.5–4).' },
						colorDepth: { type: 'number', description: 'screen.colorDepth / pixelDepth.' },
						timezone: { type: 'string', description: 'IANA timezone name for Intl.DateTimeFormat resolvedOptions spoofing.' },
						timezoneOffsetMinutes: {
							type: 'number',
							description: 'Value returned by Date.getTimezoneOffset() (minutes from UTC).',
						},
						webglVendor: { type: 'string', description: 'UNMASKED_VENDOR_WEBGL string from WebGL getParameter.' },
						webglRenderer: { type: 'string', description: 'UNMASKED_RENDERER_WEBGL string from WebGL getParameter.' },
						canvasNoiseSeed: {
							type: 'number',
							description: 'Positive integer seed; enables subtle 2D canvas noise on toDataURL/toBlob for fingerprint diversity.',
						},
						audioNoiseSeed: {
							type: 'number',
							description: 'Positive integer seed; enables subtle AudioContext oscillator path noise.',
						},
						webrtcPolicy: {
							type: 'string',
							enum: ['default', 'block'],
							description: '`block` disables RTCPeerConnection in the page; `default` leaves WebRTC unchanged.',
						},
						maskWebdriver: {
							type: 'boolean',
							description: 'Force navigator.webdriver to false when true; set false to opt out while keeping other overrides.',
						},
					},
				},
			},
			required: ['action'],
		},
	},
	{
		name: 'BrowserCapture',
		description:
			'Capture HTTP traffic from Async\'s built-in browser for the current app session. Typical flow: start capture, use the Browser tool to navigate and interact, then list captured requests and inspect a specific request in detail.',
		parameters: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: ['get_state', 'start', 'stop', 'clear', 'list_requests', 'get_request'],
					description: 'Browser capture action to perform.',
				},
				clear_existing: {
					type: 'boolean',
					description:
						'For start: clear previously captured requests before arming capture. Default true.',
				},
				tab_id: {
					type: 'string',
					description: 'For list_requests: optional browser tab id to filter captured requests.',
				},
				query: {
					type: 'string',
					description:
						'For list_requests: optional case-insensitive substring filter applied to method, URL, content type, and error text.',
				},
				status: {
					type: 'number',
					description: 'For list_requests: optional exact HTTP status code filter.',
				},
				offset: {
					type: 'number',
					description: 'For list_requests: number of matching items to skip before returning results. Default 0.',
				},
				limit: {
					type: 'number',
					description:
						'For list_requests: maximum number of items to return. Default 50, capped at 200.',
				},
				seq: {
					type: 'number',
					description:
						'For get_request: captured request sequence number, as returned by list_requests.',
				},
				request_id: {
					type: 'string',
					description:
						'For get_request: stable captured request id, as returned by list_requests. Takes precedence over seq.',
				},
			},
			required: ['action'],
		},
	},
	{
		name: 'LSP',
		description:
			'Language-server intelligence for the workspace, routed by **file extension** to LSP servers declared in plugin dirs under `<asyncData>/plugins/<name>/` or `<workspace>/.async/plugins/<name>/` with **`.lsp.json`** or **`plugin.json` → `lspServers`** (each server: **command**, optional **args**, required **extensionToLanguage** map). Legacy **`lsp.servers`** in settings.json is still merged. TS/JS additionally works if **typescript-language-server** is discoverable under the app or workspace `node_modules` (optional).\n\nOperations: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls, getDiagnostics. Use **filePath** plus 1-based **line**/**character** except **getDiagnostics**/**workspaceSymbol** (optional line/char).\n\nIf nothing matches the file extension, add a plugin or legacy server entry. If an LSP method fails, fall back to **Read** / **Grep** / **Bash**.',
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
			'Spawn a focused sub-agent. Use for scoped, autonomous work: deep codebase exploration, refactors isolated to a module, or keeping your main context clean. The sub-agent runs a full tool loop and returns its final text. With background fork enabled, omitting subagent_type (or setting run_in_background) lets work continue asynchronously while the tool returns immediately. Set subagent_type to "explore" for read-only exploration; use a custom name from user subagent settings for tailored instructions. Set fork_context to true to copy the current visible thread history into the child agent. Nested Agent calls are blocked. Maximum nesting depth is 1.',
		parameters: {
			type: 'object',
			properties: {
				prompt: {
					type: 'string',
					description: 'Instructions for the sub-agent (`prompt`)',
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
						'If true, the sub-agent runs in the background: the tool returns immediately with a short notice, nested activity still streams, and the user gets a completion toast when it finishes.',
				},
				fork_context: {
					type: 'boolean',
					description:
						'If true, copy the current visible conversation history into the spawned agent before adding the new task message.',
				},
			},
			required: ['prompt'],
		},
	},
	{
		name: 'send_input',
		description:
			'Send a follow-up message to an existing sub-agent. Use interrupt=true to stop its current run and handle the new message immediately.',
		parameters: {
			type: 'object',
			properties: {
				target: {
					type: 'string',
					description: 'Agent id returned or shown for the target sub-agent.',
				},
				message: {
					type: 'string',
					description: 'Plain text message to deliver to the target sub-agent.',
				},
				interrupt: {
					type: 'boolean',
					description: 'If true, abort the current run and prioritize this new message.',
				},
			},
			required: ['target', 'message'],
		},
	},
	{
		name: 'wait_agent',
		description:
			'Wait for one or more sub-agents to finish. Returns the final statuses that completed before the timeout.',
		parameters: {
			type: 'object',
			properties: {
				targets: {
					type: 'array',
					items: { type: 'string' },
					description: 'One or more agent ids to wait for.',
				},
				timeout_ms: {
					type: 'number',
					description: 'Optional timeout in milliseconds. Defaults to 30000.',
				},
			},
			required: ['targets'],
		},
	},
	{
		name: 'resume_agent',
		description:
			'Resume a paused or previously closed sub-agent when it has stored context and can continue.',
		parameters: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					description: 'Agent id to resume.',
				},
			},
			required: ['id'],
		},
	},
	{
		name: 'close_agent',
		description:
			'Close a running or resumable sub-agent and any of its descendants.',
		parameters: {
			type: 'object',
			properties: {
				target: {
					type: 'string',
					description: 'Agent id to close.',
				},
			},
			required: ['target'],
		},
	},
	{
		name: 'request_user_input',
		description:
			'Ask the user for 1-3 short structured answers. Each question must include an id, a short header, the question text, and 2-3 recommended options. The UI automatically adds a freeform "Other" field for each question, and the tool result returns a JSON object mapping question ids to the user\'s final answers.',
		parameters: {
			type: 'object',
			properties: {
				questions: {
					type: 'array',
					description: '1-3 structured questions to ask the user.',
					items: {
						type: 'object',
						properties: {
							id: {
								type: 'string',
								description: 'Stable snake_case id used in the returned answers object.',
							},
							header: {
								type: 'string',
								description: 'Short header label shown in the UI.',
							},
							question: {
								type: 'string',
								description: 'Single user-facing question.',
							},
							options: {
								type: 'array',
								description: '2-3 recommended options shown before the automatic Other field.',
								items: {
									type: 'object',
									properties: {
										label: {
											type: 'string',
											description: 'Short option label.',
										},
										description: {
											type: 'string',
											description: 'One sentence explaining the tradeoff or impact of selecting it.',
										},
									},
									required: ['label', 'description'],
								},
							},
						},
						required: ['id', 'header', 'question', 'options'],
					},
				},
			},
			required: ['questions'],
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
		name: 'ToolSearch',
		description:
			'Search deferred tools that are not currently loaded into the model-visible tool list. Use this when you need an MCP integration but do not yet know the exact `mcp__server__tool` name. Matching tools are loaded for the next assistant turn so you can call them directly after this tool returns.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Keywords for the capability you need, such as "github issues", "postgres query", or "browser automation".',
				},
				server: {
					type: 'string',
					description: 'Optional MCP server id/name fragment to narrow the search before matching tools.',
				},
				limit: {
					type: 'number',
					description: 'Maximum number of matching tools to load. Default 8, maximum 12.',
				},
			},
			required: [],
		},
	},
	{
		name: 'begin_outcome',
		description:
			'Mark the boundary between the preflight phase (thinking, exploration, tool calls) and the outcome phase (your final answer / summary / file edits / commands). Call this tool exactly once, immediately before you start producing the final answer for the user. After calling this tool you may proceed to write the summary markdown, perform Edit / Write, or output command fences — all of those will be rendered outside the preflight shell. Do NOT call this tool while you are still exploring or thinking; the very first call wins and cannot be reversed in the same turn. Skip this tool entirely if your reply has no exploration phase (e.g. a one-shot answer with no tools).',
		parameters: {
			type: 'object',
			properties: {},
			required: [],
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
			'Planning clarification tool: ask the user ONE multiple-choice clarification. Keep the old Plan UX shape: provide exactly 4 options total, where the first 3 are concrete recommendations and the 4th is an Other/custom option for free text. The app shows a picker and custom input; your next turn receives the user answer as this tool\'s result text. Call at most one per assistant turn; wait for the result before asking another question or drafting the final plan / task routing. Do not duplicate the same question in markdown.',
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
	{
		name: 'plan_submit_draft',
		description:
			'Submit the structured plan draft for Plan mode. Must be called exactly once when the plan is ready.',
		parameters: {
			type: 'object',
			properties: {
				title: { type: 'string', description: 'Concise plan title.' },
				goal: { type: 'string', description: 'One or two sentence goal summary.' },
				scopeContext: {
					type: 'array',
					items: { type: 'string' },
					description: 'Key scope or context bullets.',
				},
				executionOverview: {
					type: 'array',
					items: { type: 'string' },
					description: 'High-level sequencing or milestone bullets.',
				},
				implementationSteps: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							title: { type: 'string' },
							description: { type: 'string' },
						},
						required: ['title', 'description'],
					},
					description: 'Ordered implementation steps.',
				},
				todos: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							content: { type: 'string' },
							status: { type: 'string', enum: ['pending', 'completed'] },
						},
						required: ['content'],
					},
					description: 'Checklist items for the plan.',
				},
				filesToChange: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							path: { type: 'string' },
							action: { type: 'string', enum: ['Edit', 'New', 'Delete'] },
							description: { type: 'string' },
						},
						required: ['path', 'action', 'description'],
					},
					description: 'Planned file changes.',
				},
				risksAndEdgeCases: {
					type: 'array',
					items: { type: 'string' },
					description: 'Important risks and edge cases.',
				},
				openQuestions: {
					type: 'array',
					items: { type: 'string' },
					description: 'Outstanding open questions.',
				},
			},
			required: ['title', 'goal', 'implementationSteps', 'todos'],
		},
	},
];

export function toOpenAITools(defs: AgentToolDef[]) {
	return buildOpenAIToolSchemas(defs);
}

export function toAnthropicTools(
	defs: AgentToolDef[],
	options?: {
		deferToolNames?: Iterable<string>;
		includeExperimentalBetaFields?: boolean;
	}
): AnthropicToolSchema[] {
	return buildAnthropicToolSchemas(defs, options);
}
