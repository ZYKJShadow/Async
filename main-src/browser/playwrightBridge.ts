/**
 * Playwright over CDP 桥接：连接到 Electron 内部 Chromium 暴露的 DevTools 端口，
 * 把"内置浏览器里的 webview"包装成 Playwright Page，供 AI 工具调用。
 *
 * 设计要点：
 * - 单例 Browser 连接，懒加载；首次 `acquirePageForHost` 触发连接。
 * - 通过 CDP 的 `Target.targetInfos` 区分 webview / page，按 webContents.id 关联到
 *   Electron `<webview>` 元素：每个 webview 都是一个独立 OOPIF page target。
 * - 我们没法直接拿到 Electron webContents.id 与 Playwright Page 的映射关系，但
 *   可以借助 webview 当前 URL + 浏览器运行时状态做匹配（一对一足够）。
 * - 当前 active tab 的 webContents 由 `BrowserRuntimeState` 跟踪；其 URL 在主进程
 *   是已知的（通过 `webContents.getURL()` 直接读）。
 */

import { app, webContents as electronWebContents, type WebContents } from 'electron';
import type {
	Browser as PwBrowser,
	BrowserContext as PwContext,
	Page as PwPage,
} from 'playwright-core';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
	isAiBrowserEnabledForThisLaunch,
	readDevToolsActivePort,
} from './aiBrowserFlag.js';
import { humanCursorInitScript } from './humanCursor.js';

let pwModule: typeof import('playwright-core') | null = null;
function loadPlaywright(): typeof import('playwright-core') {
	if (!pwModule) {
		// 用 require 避免 esbuild bundle 时静态分析；playwright-core 体积较大。
		pwModule = require('playwright-core');
	}
	return pwModule!;
}

type BridgeState = {
	browser: PwBrowser;
	pageByWebContentsId: Map<number, PwPage>;
	pageInitTokens: WeakSet<PwPage>;
};

let bridgeState: BridgeState | null = null;
let connectingPromise: Promise<BridgeState> | null = null;

/**
 * 等待 `DevToolsActivePort` 文件出现并能解析出端口号。Chromium 在初始化阶段写入。
 */
async function waitForDevToolsPort(timeoutMs: number = 8_000): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const port = readDevToolsActivePort();
		if (port != null) return port;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(
		`[ai-browser] DevToolsActivePort not found at ${path.join(
			app.getPath('userData'),
			'DevToolsActivePort'
		)} within ${timeoutMs}ms`
	);
}

async function fetchBrowserVersionEndpoint(port: number): Promise<string> {
	const http = await import('node:http');
	return await new Promise<string>((resolve, reject) => {
		const req = http.request(
			{
				host: '127.0.0.1',
				port,
				path: '/json/version',
				method: 'GET',
				headers: { Host: '127.0.0.1' },
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c) => chunks.push(c as Buffer));
				res.on('end', () => {
					try {
						const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
							webSocketDebuggerUrl?: string;
						};
						if (!json.webSocketDebuggerUrl) {
							reject(new Error('webSocketDebuggerUrl missing from /json/version'));
							return;
						}
						resolve(json.webSocketDebuggerUrl);
					} catch (e) {
						reject(e instanceof Error ? e : new Error(String(e)));
					}
				});
				res.on('error', reject);
			}
		);
		req.on('error', reject);
		req.end();
	});
}

async function connectBridge(): Promise<BridgeState> {
	if (!isAiBrowserEnabledForThisLaunch()) {
		throw new Error(
			'AI 浏览器自动化已被禁用（环境变量 ASYNC_AI_BROWSER=0）。请取消该设置后重启。'
		);
	}
	const port = await waitForDevToolsPort();
	const wsUrl = await fetchBrowserVersionEndpoint(port);
	const { chromium } = loadPlaywright();
	const browser = await chromium.connectOverCDP(wsUrl, { timeout: 15_000 });
	const state: BridgeState = {
		browser,
		pageByWebContentsId: new Map(),
		pageInitTokens: new WeakSet(),
	};
	browser.on('disconnected', () => {
		if (bridgeState === state) bridgeState = null;
	});
	bridgeState = state;
	return state;
}

async function ensureBridge(): Promise<BridgeState> {
	if (bridgeState) return bridgeState;
	if (!connectingPromise) {
		connectingPromise = connectBridge().finally(() => {
			connectingPromise = null;
		});
	}
	return await connectingPromise;
}

/**
 * 在 page 上注入人形光标 + 工具脚本（仅注入一次）。
 */
async function ensurePageInstrumentation(state: BridgeState, page: PwPage): Promise<void> {
	if (state.pageInitTokens.has(page)) return;
	state.pageInitTokens.add(page);
	try {
		// 当前页面立即注入；后续 navigation 用 addInitScript 兜底。
		await page.addInitScript({ content: humanCursorInitScript() });
		await page.evaluate(humanCursorInitScript()).catch(() => {
			/* about:blank or cross-origin scope can fail; init script will catch it. */
		});
	} catch (error) {
		console.warn('[ai-browser] failed to inject human cursor:', error);
	}
}

function normalizeUrlKey(raw: string): string {
	if (!raw) return '';
	try {
		const u = new URL(raw);
		// 忽略 fragment，trailing slash 不归一化（保留以便精确匹配）。
		u.hash = '';
		return u.toString();
	} catch {
		return raw;
	}
}

/**
 * Playwright 把每个 OOPIF / webview 都暴露为独立 page。我们按 URL 匹配。
 *
 * 如果同一 URL 有多个匹配（罕见但可能），优先选未被绑定到其他 webContentsId 的那个。
 */
async function findPageForWebContents(
	state: BridgeState,
	contents: WebContents
): Promise<PwPage | null> {
	const targetUrl = normalizeUrlKey(contents.getURL());
	if (!targetUrl) return null;

	const claimed = new Set<PwPage>();
	for (const [, p] of state.pageByWebContentsId) claimed.add(p);

	const candidates: PwPage[] = [];
	for (const ctx of state.browser.contexts()) {
		for (const page of ctx.pages()) {
			if (page.isClosed()) continue;
			if (normalizeUrlKey(page.url()) === targetUrl) candidates.push(page);
		}
	}
	const free = candidates.find((p) => !claimed.has(p));
	return free ?? candidates[0] ?? null;
}

export type BrowserTabRef = {
	hostId: number;
	tabId?: string;
};

/**
 * 解析一个 host + 可选 tabId 到具体的 webview WebContents。
 * 当前实现：使用 BrowserRuntimeState 中的 activeTabId 或显式 tabId 找到对应 webview。
 *
 * 由于内置浏览器的 webview 实例也是 Electron WebContents，我们枚举所有
 * `getType() === 'webview'` 的 contents，并通过 `hostWebContents.id === hostId`
 * 来过滤属于该 host 的那些。
 */
function resolveTargetWebContents(ref: BrowserTabRef): WebContents | null {
	const allContents = electronWebContents.getAllWebContents();
	const candidates = allContents.filter((c) => {
		if (c.isDestroyed()) return false;
		if (c.getType() !== 'webview') return false;
		try {
			const host = c.hostWebContents;
			return !!host && !host.isDestroyed() && host.id === ref.hostId;
		} catch {
			return false;
		}
	});
	if (candidates.length === 0) return null;
	if (ref.tabId) {
		// 内置浏览器目前没有把 tabId 暴露到 webContents 级别；按顺序匹配是最佳近似。
		// 如未来 BrowserRuntimeState 增加 tabId→webContentsId 映射，可在此读取。
		return candidates[0] ?? null;
	}
	// 优先选第一个非空 URL 的 webview（约定为 active tab）
	const focused = candidates.find((c) => {
		try {
			return !!c.getURL();
		} catch {
			return false;
		}
	});
	return focused ?? candidates[0] ?? null;
}

export async function acquirePageForHost(ref: BrowserTabRef): Promise<{
	page: PwPage;
	context: PwContext;
	webContentsId: number;
}> {
	const state = await ensureBridge();
	const target = resolveTargetWebContents(ref);
	if (!target) {
		throw new Error(
			`未在 host ${ref.hostId} 中找到内置浏览器的 webview。请先在右侧栏打开 Browser 面板并访问任意页面。`
		);
	}
	const cached = state.pageByWebContentsId.get(target.id);
	if (cached && !cached.isClosed()) {
		await ensurePageInstrumentation(state, cached);
		return { page: cached, context: cached.context(), webContentsId: target.id };
	}
	const page = await findPageForWebContents(state, target);
	if (!page) {
		throw new Error(
			'通过 CDP 未能定位到对应的 Playwright Page。可能页面正在加载或处于 about:blank。请等待页面加载后重试。'
		);
	}
	state.pageByWebContentsId.set(target.id, page);
	page.once('close', () => {
		const current = state.pageByWebContentsId.get(target.id);
		if (current === page) state.pageByWebContentsId.delete(target.id);
	});
	target.once('destroyed', () => {
		state.pageByWebContentsId.delete(target.id);
	});
	await ensurePageInstrumentation(state, page);
	return { page, context: page.context(), webContentsId: target.id };
}

export async function getPlaywrightStatus(): Promise<{
	enabled: boolean;
	connected: boolean;
	port: number | null;
}> {
	const enabled = isAiBrowserEnabledForThisLaunch();
	let port: number | null = null;
	if (enabled) {
		try {
			const p = path.join(app.getPath('userData'), 'DevToolsActivePort');
			if (existsSync(p)) {
				port = readDevToolsActivePort();
			}
		} catch {
			/* ignore */
		}
	}
	return {
		enabled,
		connected: !!bridgeState,
		port,
	};
}

export async function disposePlaywrightBridge(): Promise<void> {
	const state = bridgeState;
	bridgeState = null;
	if (!state) return;
	try {
		await state.browser.close();
	} catch {
		/* ignore */
	}
}
