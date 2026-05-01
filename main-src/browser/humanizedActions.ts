/**
 * 把 Playwright 的原始动作包装成"看起来像人在操作"的版本。
 *
 * 流程（以 click 为例）：
 *   1. 解析 locator → 拿到目标元素的视口坐标。
 *   2. 在页面侧调用 `__asyncAiCursor.moveTo()` 让虚拟光标缓动到目标点。
 *   3. 短暂 hover（思考停顿），同时显示一行说明 label。
 *   4. 在页面侧调用 `__asyncAiCursor.click()` 触发按压 + 涟漪动画。
 *   5. 用 Playwright `page.mouse.click()` 真实派发点击事件。
 *
 * 输入文本时按字符之间随机间隔（80~180ms）来模拟人手速度，
 * 期间偶尔触发 `typeIndicator()` 让光标周围有节奏的涟漪。
 */

import type { Locator, Page } from 'playwright-core';

export type HumanActionOptions = {
	label?: string;
	hoverDelayMs?: number;
	moveDurationMs?: number;
};

export type HumanTypeOptions = HumanActionOptions & {
	minPerCharMs?: number;
	maxPerCharMs?: number;
	clearFirst?: boolean;
};

function rand(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

async function safeShowLabel(page: Page, text: string | undefined, durationMs: number): Promise<void> {
	if (!text) return;
	try {
		await page.evaluate(
			({ t, d }) => {
				const api = (window as unknown as { __asyncAiCursor?: { label: (t: string, d?: number) => void } })
					.__asyncAiCursor;
				if (api && typeof api.label === 'function') api.label(t, d);
			},
			{ t: text, d: durationMs }
		);
	} catch {
		/* page navigated away — ignore */
	}
}

async function ensureCursorAt(page: Page, x: number, y: number, durationMs: number): Promise<void> {
	try {
		await page.evaluate(
			({ x, y, d }) => {
				const api = (window as unknown as {
					__asyncAiCursor?: {
						moveTo: (x: number, y: number, d: number) => Promise<void>;
						show: () => void;
					};
				}).__asyncAiCursor;
				if (!api) return Promise.resolve();
				api.show();
				return api.moveTo(x, y, d);
			},
			{ x, y, d: durationMs }
		);
	} catch {
		/* ignore — cursor is decorative only */
	}
}

async function triggerCursorClick(page: Page, x: number, y: number): Promise<void> {
	try {
		await page.evaluate(
			({ x, y }) => {
				const api = (window as unknown as {
					__asyncAiCursor?: { click: (x: number, y: number) => Promise<void> };
				}).__asyncAiCursor;
				if (api && typeof api.click === 'function') return api.click(x, y);
				return Promise.resolve();
			},
			{ x, y }
		);
	} catch {
		/* ignore */
	}
}

async function pushKeyToHud(page: Page, label: string): Promise<void> {
	try {
		await page.evaluate((l) => {
			const api = (window as unknown as { __asyncAiCursor?: { key: (l: string) => void } })
				.__asyncAiCursor;
			if (api && typeof api.key === 'function') api.key(l);
		}, label);
	} catch {
		/* decorative */
	}
}

async function locatorViewportCenter(locator: Locator): Promise<{ x: number; y: number }> {
	// Playwright 的 boundingBox 已是视口坐标（CSS px）。
	const box = await locator.boundingBox({ timeout: 10_000 });
	if (!box) {
		throw new Error('目标元素不可见，无法获取定位框（boundingBox）。');
	}
	const cx = box.x + box.width / 2 + rand(-Math.min(box.width / 6, 6), Math.min(box.width / 6, 6));
	const cy = box.y + box.height / 2 + rand(-Math.min(box.height / 6, 4), Math.min(box.height / 6, 4));
	return { x: cx, y: cy };
}

export async function humanClick(
	page: Page,
	locator: Locator,
	options: HumanActionOptions = {}
): Promise<{ x: number; y: number }> {
	await locator.waitFor({ state: 'visible', timeout: 15_000 });
	await locator.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
	const { x, y } = await locatorViewportCenter(locator);
	const moveDur = options.moveDurationMs ?? Math.round(rand(280, 520));
	const hoverDur = options.hoverDelayMs ?? Math.round(rand(120, 260));
	await safeShowLabel(page, options.label, moveDur + hoverDur + 600);
	await ensureCursorAt(page, x, y, moveDur);
	await page.waitForTimeout(hoverDur);
	await triggerCursorClick(page, x, y);
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.waitForTimeout(rand(40, 90));
	await page.mouse.up();
	return { x, y };
}

export async function humanHover(
	page: Page,
	locator: Locator,
	options: HumanActionOptions = {}
): Promise<{ x: number; y: number }> {
	await locator.waitFor({ state: 'visible', timeout: 15_000 });
	await locator.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
	const { x, y } = await locatorViewportCenter(locator);
	const moveDur = options.moveDurationMs ?? Math.round(rand(260, 500));
	await safeShowLabel(page, options.label, moveDur + 800);
	await ensureCursorAt(page, x, y, moveDur);
	await page.mouse.move(x, y);
	return { x, y };
}

export async function humanType(
	page: Page,
	locator: Locator,
	text: string,
	options: HumanTypeOptions = {}
): Promise<void> {
	await humanClick(page, locator, { label: options.label, moveDurationMs: options.moveDurationMs });
	if (options.clearFirst !== false) {
		// 全选 + 删除，跨平台兼容
		const isMac = process.platform === 'darwin';
		await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
		await page.keyboard.press('Delete');
	}
	const minMs = options.minPerCharMs ?? 60;
	const maxMs = options.maxPerCharMs ?? 160;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		await page.keyboard.type(ch, { delay: 0 });
		await pushKeyToHud(page, ch);
		await page.waitForTimeout(rand(minMs, maxMs));
	}
}

export async function humanPressKey(
	page: Page,
	key: string,
	options: { label?: string } = {}
): Promise<void> {
	await safeShowLabel(page, options.label, 1200);
	await pushKeyToHud(page, key);
	await page.waitForTimeout(rand(60, 140));
	await page.keyboard.press(key);
}

export async function humanScroll(
	page: Page,
	deltaY: number,
	options: { stepPx?: number; stepDelayMs?: number } = {}
): Promise<void> {
	const step = options.stepPx ?? 120;
	const delay = options.stepDelayMs ?? 30;
	const steps = Math.max(1, Math.round(Math.abs(deltaY) / step));
	const sign = deltaY < 0 ? -1 : 1;
	for (let i = 0; i < steps; i++) {
		await page.mouse.wheel(0, sign * step);
		await page.waitForTimeout(delay);
	}
}
