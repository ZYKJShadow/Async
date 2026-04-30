/**
 * `Playwright` Agent 工具实现：通过 CDP 桥接驱动内置浏览器的 webview，
 * 配合人形光标 + 拟人化时序，让 AI 自动化测试在用户眼前可视化执行。
 *
 * 该模块是工具层入口，与 toolExecutor 的其他工具（Browser、BrowserCapture）平级。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Locator, Page } from 'playwright-core';
import { acquirePageForHost, getPlaywrightStatus } from './playwrightBridge.js';
import {
	humanClick,
	humanHover,
	humanPressKey,
	humanScroll,
	humanType,
} from './humanizedActions.js';

export type PlaywrightToolCall = {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
};

export type PlaywrightToolResult = {
	toolCallId: string;
	name: string;
	content: string;
	isError: boolean;
};

type ResolveLocatorOpts = {
	role?: string;
	roleName?: string;
	roleExact?: boolean;
	text?: string;
	textExact?: boolean;
	label?: string;
	placeholder?: string;
	testId?: string;
	selector?: string;
	nth?: number;
};

function pickLocator(page: Page, opts: ResolveLocatorOpts): Locator {
	let loc: Locator | null = null;
	const validRoles = [
		'button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'tab', 'menuitem',
		'option', 'heading', 'img', 'list', 'listitem', 'navigation', 'main', 'banner',
		'contentinfo', 'dialog', 'tooltip', 'alert', 'status', 'searchbox', 'switch', 'slider',
	];
	if (opts.role && validRoles.includes(opts.role)) {
		loc = page.getByRole(opts.role as Parameters<Page['getByRole']>[0], {
			name: opts.roleName,
			exact: opts.roleExact,
		});
	} else if (opts.testId) {
		loc = page.getByTestId(opts.testId);
	} else if (opts.label) {
		loc = page.getByLabel(opts.label);
	} else if (opts.placeholder) {
		loc = page.getByPlaceholder(opts.placeholder);
	} else if (opts.text) {
		loc = page.getByText(opts.text, { exact: opts.textExact });
	} else if (opts.selector) {
		loc = page.locator(opts.selector);
	}
	if (!loc) {
		throw new Error(
			'必须提供 selector / role / text / label / placeholder / testId 中的至少一个用于定位元素。'
		);
	}
	if (typeof opts.nth === 'number' && Number.isFinite(opts.nth)) {
		loc = loc.nth(opts.nth);
	}
	return loc;
}

function readArg<T>(args: Record<string, unknown>, ...keys: string[]): T | undefined {
	for (const k of keys) {
		if (Object.prototype.hasOwnProperty.call(args, k)) return args[k] as T;
	}
	return undefined;
}

function readBoolArg(args: Record<string, unknown>, ...keys: string[]): boolean | undefined {
	const raw = readArg<unknown>(args, ...keys);
	if (raw === undefined) return undefined;
	if (raw === true || raw === 'true') return true;
	if (raw === false || raw === 'false') return false;
	return undefined;
}

function readStringArg(args: Record<string, unknown>, ...keys: string[]): string | undefined {
	const raw = readArg<unknown>(args, ...keys);
	return typeof raw === 'string' ? raw : undefined;
}

function readNumberArg(args: Record<string, unknown>, ...keys: string[]): number | undefined {
	const raw = readArg<unknown>(args, ...keys);
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
	if (typeof raw === 'string') {
		const n = Number(raw);
		if (Number.isFinite(n)) return n;
	}
	return undefined;
}

function buildLocatorOpts(args: Record<string, unknown>): ResolveLocatorOpts {
	return {
		role: readStringArg(args, 'role'),
		roleName: readStringArg(args, 'role_name', 'roleName', 'name'),
		roleExact: readBoolArg(args, 'role_exact', 'roleExact'),
		text: readStringArg(args, 'text'),
		textExact: readBoolArg(args, 'text_exact', 'textExact'),
		label: readStringArg(args, 'label'),
		placeholder: readStringArg(args, 'placeholder'),
		testId: readStringArg(args, 'test_id', 'testId'),
		selector: readStringArg(args, 'selector'),
		nth: readNumberArg(args, 'nth'),
	};
}

function jsonResult(call: PlaywrightToolCall, payload: unknown): PlaywrightToolResult {
	return {
		toolCallId: call.id,
		name: call.name,
		content: JSON.stringify(payload, null, 2),
		isError: false,
	};
}

function errorResult(call: PlaywrightToolCall, message: string): PlaywrightToolResult {
	return {
		toolCallId: call.id,
		name: call.name,
		content: `Error: ${message}`,
		isError: true,
	};
}

function describeLocatorTarget(opts: ResolveLocatorOpts): string {
	if (opts.role) return `${opts.role}${opts.roleName ? ` "${opts.roleName}"` : ''}`;
	if (opts.testId) return `[data-testid="${opts.testId}"]`;
	if (opts.label) return `label "${opts.label}"`;
	if (opts.placeholder) return `placeholder "${opts.placeholder}"`;
	if (opts.text) return `text "${opts.text}"`;
	if (opts.selector) return opts.selector;
	return '<element>';
}

async function snapshotPage(page: Page, maxChars: number): Promise<{
	title: string;
	url: string;
	tree: string;
}> {
	// 通过 CDP 拿可访问性树（Page.accessibility 在 newer Playwright 已不暴露）。
	type AxNode = {
		nodeId?: string;
		role?: { value?: string };
		name?: { value?: string };
		value?: { value?: string };
		childIds?: string[];
		ignored?: boolean;
	};
	let nodes: AxNode[] = [];
	try {
		const session = await page.context().newCDPSession(page);
		const resp = (await session.send('Accessibility.getFullAXTree')) as { nodes?: AxNode[] };
		nodes = resp.nodes ?? [];
		await session.detach().catch(() => {});
	} catch {
		nodes = [];
	}
	const byId = new Map<string, AxNode>();
	for (const n of nodes) {
		if (n.nodeId) byId.set(n.nodeId, n);
	}
	const childSet = new Set<string>();
	for (const n of nodes) for (const c of n.childIds ?? []) childSet.add(c);
	const roots = nodes.filter((n) => n.nodeId && !childSet.has(n.nodeId));

	function render(node: AxNode | undefined, depth: number, lines: string[]): void {
		if (!node || node.ignored) {
			for (const c of node?.childIds ?? []) render(byId.get(c), depth, lines);
			return;
		}
		const role = node.role?.value ?? '';
		const name = node.name?.value ? ` "${node.name.value}"` : '';
		const value = node.value?.value ? ` =${JSON.stringify(node.value.value)}` : '';
		if (role && role !== 'none' && role !== 'presentation') {
			lines.push(`${'  '.repeat(depth)}- ${role}${name}${value}`);
			for (const c of node.childIds ?? []) render(byId.get(c), depth + 1, lines);
		} else {
			for (const c of node.childIds ?? []) render(byId.get(c), depth, lines);
		}
	}
	const lines: string[] = [];
	for (const r of roots) render(r, 0, lines);
	let tree = lines.join('\n');
	if (!tree) tree = '(empty accessibility tree)';
	if (tree.length > maxChars) tree = tree.slice(0, maxChars) + '\n... [truncated]';
	return { title: await page.title().catch(() => ''), url: page.url(), tree };
}

function buildScreenshotPath(workspaceRoot: string | null): { full: string; rel: string | null } {
	const fileName = `pw-${new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')}.png`;
	if (workspaceRoot) {
		const rel = path.posix.join('.async', 'pw-captures', fileName);
		const full = path.resolve(workspaceRoot, rel);
		return { full, rel };
	}
	return { full: path.join(os.tmpdir(), 'async-pw-captures', fileName), rel: null };
}

export async function executePlaywrightTool(
	call: PlaywrightToolCall,
	ctx: { hostId: number; workspaceRoot: string | null }
): Promise<PlaywrightToolResult> {
	const action = String(call.arguments.action ?? '').trim();
	if (!action) return errorResult(call, 'action is required');

	if (action === 'status') {
		const s = await getPlaywrightStatus();
		return jsonResult(call, s);
	}

	let resolved: Awaited<ReturnType<typeof acquirePageForHost>>;
	try {
		resolved = await acquirePageForHost({
			hostId: ctx.hostId,
			tabId: readStringArg(call.arguments, 'tab_id', 'tabId'),
		});
	} catch (e) {
		return errorResult(call, e instanceof Error ? e.message : String(e));
	}
	const { page } = resolved;

	try {
		switch (action) {
			case 'navigate': {
				const url = readStringArg(call.arguments, 'url');
				if (!url) return errorResult(call, 'url is required for navigate');
				const waitUntilRaw = readStringArg(call.arguments, 'wait_until', 'waitUntil') ?? 'load';
				const waitUntil = (['load', 'domcontentloaded', 'networkidle', 'commit'] as const).includes(
					waitUntilRaw as 'load'
				)
					? (waitUntilRaw as 'load' | 'domcontentloaded' | 'networkidle' | 'commit')
					: 'load';
				const timeoutMs = readNumberArg(call.arguments, 'timeout_ms', 'timeoutMs') ?? 30_000;
				const resp = await page.goto(url, { waitUntil, timeout: timeoutMs });
				return jsonResult(call, {
					ok: true,
					url: page.url(),
					status: resp?.status() ?? null,
					title: await page.title().catch(() => ''),
				});
			}
			case 'click': {
				const opts = buildLocatorOpts(call.arguments);
				const loc = pickLocator(page, opts);
				const target = describeLocatorTarget(opts);
				const labelText = readStringArg(call.arguments, 'label_text', 'cursorLabel') ?? `点击 ${target}`;
				const point = await humanClick(page, loc, { label: labelText });
				return jsonResult(call, { ok: true, target, point });
			}
			case 'hover': {
				const opts = buildLocatorOpts(call.arguments);
				const loc = pickLocator(page, opts);
				const target = describeLocatorTarget(opts);
				const labelText = readStringArg(call.arguments, 'label_text', 'cursorLabel') ?? `悬停 ${target}`;
				const point = await humanHover(page, loc, { label: labelText });
				return jsonResult(call, { ok: true, target, point });
			}
			case 'fill': {
				const opts = buildLocatorOpts(call.arguments);
				const loc = pickLocator(page, opts);
				const text = readStringArg(call.arguments, 'text', 'value') ?? '';
				const target = describeLocatorTarget(opts);
				const labelText = readStringArg(call.arguments, 'label_text', 'cursorLabel') ?? `填写 ${target}`;
				await humanType(page, loc, text, {
					label: labelText,
					clearFirst: readBoolArg(call.arguments, 'clear_first', 'clearFirst') ?? true,
					minPerCharMs: readNumberArg(call.arguments, 'min_per_char_ms') ?? 60,
					maxPerCharMs: readNumberArg(call.arguments, 'max_per_char_ms') ?? 160,
				});
				return jsonResult(call, { ok: true, target, length: text.length });
			}
			case 'press_key': {
				const key = readStringArg(call.arguments, 'key');
				if (!key) return errorResult(call, 'key is required for press_key');
				const labelText = readStringArg(call.arguments, 'label_text', 'cursorLabel') ?? `按键 ${key}`;
				await humanPressKey(page, key, { label: labelText });
				return jsonResult(call, { ok: true, key });
			}
			case 'scroll': {
				const deltaY = readNumberArg(call.arguments, 'delta_y', 'deltaY') ?? 0;
				if (!deltaY) return errorResult(call, 'delta_y is required for scroll');
				await humanScroll(page, deltaY, {
					stepPx: readNumberArg(call.arguments, 'step_px') ?? 120,
					stepDelayMs: readNumberArg(call.arguments, 'step_delay_ms') ?? 30,
				});
				return jsonResult(call, { ok: true, deltaY });
			}
			case 'wait_for': {
				const opts = buildLocatorOpts(call.arguments);
				const stateRaw = readStringArg(call.arguments, 'state') ?? 'visible';
				const waitState = (['attached', 'detached', 'visible', 'hidden'] as const).includes(
					stateRaw as 'visible'
				)
					? (stateRaw as 'attached' | 'detached' | 'visible' | 'hidden')
					: 'visible';
				const timeoutMs = readNumberArg(call.arguments, 'timeout_ms', 'timeoutMs') ?? 15_000;
				if (!opts.role && !opts.text && !opts.label && !opts.placeholder && !opts.testId && !opts.selector) {
					// 等待页面就绪
					await page.waitForLoadState('load', { timeout: timeoutMs });
					return jsonResult(call, { ok: true, mode: 'load' });
				}
				const loc = pickLocator(page, opts);
				await loc.waitFor({ state: waitState, timeout: timeoutMs });
				return jsonResult(call, { ok: true, target: describeLocatorTarget(opts), state: waitState });
			}
			case 'evaluate': {
				const expression = readStringArg(call.arguments, 'expression', 'js');
				if (!expression) return errorResult(call, 'expression is required for evaluate');
				const result = await page.evaluate(
					(src) => {
						// eslint-disable-next-line no-new-func
						return new Function(`"use strict"; return (async () => { ${src} })();`)();
					},
					expression
				);
				let serialized: string;
				try {
					serialized = JSON.stringify(result);
					if (serialized && serialized.length > 4000) serialized = serialized.slice(0, 4000) + '...[truncated]';
				} catch {
					serialized = String(result);
				}
				return jsonResult(call, { ok: true, result: serialized });
			}
			case 'snapshot': {
				const maxChars = readNumberArg(call.arguments, 'max_chars', 'maxChars') ?? 8_000;
				const snap = await snapshotPage(page, maxChars);
				return jsonResult(call, snap);
			}
			case 'screenshot': {
				const fullPage = readBoolArg(call.arguments, 'full_page', 'fullPage') ?? false;
				const userPath = readStringArg(call.arguments, 'file_path', 'filePath');
				const out = userPath
					? { full: path.resolve(ctx.workspaceRoot ?? process.cwd(), userPath), rel: null as string | null }
					: buildScreenshotPath(ctx.workspaceRoot);
				fs.mkdirSync(path.dirname(out.full), { recursive: true });
				const buf = await page.screenshot({ fullPage, type: 'png' });
				fs.writeFileSync(out.full, buf);
				return jsonResult(call, {
					ok: true,
					path: out.full,
					relPath: out.rel,
					sizeBytes: buf.length,
					url: page.url(),
				});
			}
			case 'assert': {
				const opts = buildLocatorOpts(call.arguments);
				const expectation = readStringArg(call.arguments, 'expect') ?? 'visible';
				const expectedText = readStringArg(call.arguments, 'expected_text', 'expectedText');
				const expectedCount = readNumberArg(call.arguments, 'expected_count', 'expectedCount');
				const target = describeLocatorTarget(opts);
				const loc = pickLocator(page, opts);
				const timeout = readNumberArg(call.arguments, 'timeout_ms', 'timeoutMs') ?? 8_000;
				switch (expectation) {
					case 'visible':
						await loc.waitFor({ state: 'visible', timeout });
						break;
					case 'hidden':
						await loc.waitFor({ state: 'hidden', timeout });
						break;
					case 'has_text': {
						if (!expectedText) return errorResult(call, 'expected_text required for has_text');
						const actual = (await loc.first().textContent({ timeout })) ?? '';
						if (!actual.includes(expectedText)) {
							return errorResult(call, `assert has_text failed on ${target}: actual="${actual.trim().slice(0, 200)}"`);
						}
						break;
					}
					case 'has_value': {
						if (expectedText == null) return errorResult(call, 'expected_text required for has_value');
						const actual = await loc.first().inputValue({ timeout });
						if (actual !== expectedText) {
							return errorResult(call, `assert has_value failed on ${target}: actual="${actual}"`);
						}
						break;
					}
					case 'has_count': {
						if (expectedCount == null) return errorResult(call, 'expected_count required for has_count');
						const actual = await loc.count();
						if (actual !== expectedCount) {
							return errorResult(call, `assert has_count failed on ${target}: actual=${actual}`);
						}
						break;
					}
					case 'url_matches': {
						if (!expectedText) return errorResult(call, 'expected_text (regex) required for url_matches');
						if (!new RegExp(expectedText).test(page.url())) {
							return errorResult(call, `assert url_matches failed: url=${page.url()}`);
						}
						break;
					}
					default:
						return errorResult(call, `unknown expect "${expectation}"`);
				}
				return jsonResult(call, { ok: true, target, expect: expectation });
			}
			default:
				return errorResult(call, `unknown action "${action}"`);
		}
	} catch (e) {
		return errorResult(call, e instanceof Error ? e.message : String(e));
	}
}
