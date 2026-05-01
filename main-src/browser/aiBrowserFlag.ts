/**
 * AI 浏览器（Playwright over CDP）启动开关。
 *
 * Chromium 的 `--remote-debugging-port` 必须在 `app.whenReady` 前设置，所以
 * 我们在每次启动时都默认开启 —— 端口选 `0` 让 OS 随机分配；启动后从
 * `<userData>/DevToolsActivePort` 读取实际端口。该文件由 Chromium 在启用
 * remote-debugging-port 时自动写入，第一行为端口号。
 *
 * 仅监听 127.0.0.1，避免外部网络访问。本机风险面与 IDE 已持有的源码访问权
 * 同级，AI 工具调用时无需重启即可使用。
 *
 * 如需禁用（罕见场景，比如企业合规），设置环境变量 `ASYNC_AI_BROWSER=0`。
 */

import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function isAiBrowserEnabledForThisLaunch(): boolean {
	if (process.env.ASYNC_AI_BROWSER === '0' || process.env.VOID_AI_BROWSER === '0') {
		return false;
	}
	return true;
}

/**
 * 必须在 `app.whenReady` 之前调用。
 */
export function applyAiBrowserStartupSwitches(): boolean {
	if (!isAiBrowserEnabledForThisLaunch()) {
		return false;
	}
	app.commandLine.appendSwitch('remote-debugging-port', '0');
	app.commandLine.appendSwitch('remote-allow-origins', 'http://127.0.0.1,http://localhost');
	return true;
}

/**
 * 读 `<userData>/DevToolsActivePort`，返回 Chromium 实际监听的端口。
 * 文件首行是端口号，第二行是 browser target 的 ws path（不需要）。
 */
export function readDevToolsActivePort(): number | null {
	try {
		const p = path.join(app.getPath('userData'), 'DevToolsActivePort');
		if (!existsSync(p)) return null;
		const raw = readFileSync(p, 'utf8');
		const firstLine = raw.split(/\r?\n/, 1)[0]?.trim();
		const port = firstLine ? Number.parseInt(firstLine, 10) : NaN;
		return Number.isFinite(port) && port > 0 ? port : null;
	} catch {
		return null;
	}
}
