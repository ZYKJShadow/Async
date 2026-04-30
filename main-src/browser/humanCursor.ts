/**
 * 注入到目标页面的"人形光标"overlay。
 *
 * 设计：
 * - 一个固定定位的 SVG 鼠标指针（独立于真实系统光标），位于最高 z-index。
 * - 暴露 `window.__asyncAiCursor` API：
 *     `.show()` / `.hide()` —— 显隐光标
 *     `.moveTo(x, y, durationMs?)` —— 缓动移动到目标点（视口坐标）
 *     `.click(x, y)` —— 在目标点产生按压 + 涟漪效果
 *     `.type()` —— 触发短暂的输入指示动画
 *     `.label(text, ms)` —— 在光标旁短暂显示一行说明（如"点击登录按钮"）
 * - 完全在页面侧绘制，不与真实输入设备冲突；Playwright 的真实点击/输入由 CDP 派发，
 *   光标动画与之并行展示给用户看。
 *
 * 该函数返回一个 IIFE 字符串，既能作为 `addInitScript` 内容（每次导航重建 DOM 时重新注入），
 * 也能用 `page.evaluate` 立即执行（首次激活时让光标立刻出现）。
 */
export function humanCursorInitScript(): string {
	// 注：此字符串被原样注入到目标页面，不能引用主进程符号；
	// 内部以 self-installing IIFE 形式编写，并具备幂等性。
	return `
(() => {
	if (typeof window === 'undefined') return;
	if (window.__asyncAiCursor && window.__asyncAiCursor.__installed) return;

	const STATE = {
		x: window.innerWidth / 2,
		y: window.innerHeight / 2,
		visible: false,
		container: null,
		cursor: null,
		halo: null,
		labelEl: null,
		styleEl: null,
		moveAnim: null,
		labelTimer: null,
	};

	function ensureRoot() {
		if (STATE.container && document.documentElement.contains(STATE.container)) {
			return;
		}
		if (!document.documentElement) {
			// DOMContentLoaded 之前先把节点缓存，等就绪再 append。
			document.addEventListener('DOMContentLoaded', ensureRoot, { once: true });
			return;
		}

		const style = document.createElement('style');
		style.setAttribute('data-async-ai-cursor', '1');
		style.textContent = [
			'.async-ai-cursor-root{position:fixed;inset:0;pointer-events:none;z-index:2147483646;contain:layout style;}',
			'.async-ai-cursor{position:absolute;width:28px;height:28px;transform:translate(-4px,-2px);transition:opacity .18s ease;will-change:transform;filter:drop-shadow(0 4px 8px rgba(0,0,0,.35));}',
			'.async-ai-cursor[data-visible="0"]{opacity:0;}',
			'.async-ai-cursor[data-visible="1"]{opacity:1;}',
			'.async-ai-cursor[data-pressed="1"] svg{transform:scale(.86);}',
			'.async-ai-cursor svg{transition:transform .12s cubic-bezier(.4,0,.2,1);width:100%;height:100%;display:block;}',
			'.async-ai-cursor-halo{position:absolute;width:36px;height:36px;border-radius:50%;border:2px solid rgba(99,179,237,.85);transform:translate(-18px,-18px) scale(.6);opacity:0;pointer-events:none;}',
			'@keyframes async-ai-ripple{0%{opacity:.85;transform:translate(-18px,-18px) scale(.4);}80%{opacity:.0;transform:translate(-18px,-18px) scale(2.2);}100%{opacity:0;}}',
			'.async-ai-cursor-halo[data-active="1"]{animation:async-ai-ripple .55s cubic-bezier(.2,.7,.3,1) forwards;}',
			'.async-ai-cursor-label{position:absolute;padding:4px 10px;border-radius:8px;font:600 12px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;background:rgba(15,23,42,.92);white-space:nowrap;transform:translate(14px,4px);box-shadow:0 6px 18px rgba(0,0,0,.32);pointer-events:none;opacity:0;transition:opacity .18s ease;}',
			'.async-ai-cursor-label[data-visible="1"]{opacity:1;}',
		].join('\\n');
		document.documentElement.appendChild(style);
		STATE.styleEl = style;

		const root = document.createElement('div');
		root.className = 'async-ai-cursor-root';
		root.setAttribute('aria-hidden', 'true');

		const halo = document.createElement('div');
		halo.className = 'async-ai-cursor-halo';

		const cursor = document.createElement('div');
		cursor.className = 'async-ai-cursor';
		cursor.setAttribute('data-visible', '0');
		cursor.innerHTML = [
			'<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
			'<defs><linearGradient id="async-ai-cursor-grad" x1="0" y1="0" x2="0" y2="1">',
			'<stop offset="0%" stop-color="#60a5fa"/>',
			'<stop offset="100%" stop-color="#2563eb"/>',
			'</linearGradient></defs>',
			'<path d="M5 3 L5 22 L10 17 L13 24 L16 23 L13 16 L20 16 Z" fill="url(#async-ai-cursor-grad)" stroke="#0f172a" stroke-width="1.2" stroke-linejoin="round"/>',
			'</svg>',
		].join('');

		const label = document.createElement('div');
		label.className = 'async-ai-cursor-label';
		label.setAttribute('data-visible', '0');

		root.appendChild(halo);
		root.appendChild(cursor);
		root.appendChild(label);
		document.documentElement.appendChild(root);

		STATE.container = root;
		STATE.cursor = cursor;
		STATE.halo = halo;
		STATE.labelEl = label;
		applyPosition(STATE.x, STATE.y);
	}

	function applyPosition(x, y) {
		STATE.x = x;
		STATE.y = y;
		if (STATE.cursor) {
			STATE.cursor.style.left = x + 'px';
			STATE.cursor.style.top = y + 'px';
		}
		if (STATE.halo) {
			STATE.halo.style.left = x + 'px';
			STATE.halo.style.top = y + 'px';
		}
		if (STATE.labelEl) {
			STATE.labelEl.style.left = x + 'px';
			STATE.labelEl.style.top = y + 'px';
		}
	}

	function easeInOutCubic(t) {
		return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	}

	function bezier(p0, p1, p2, p3, t) {
		const u = 1 - t;
		return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
	}

	function moveTo(targetX, targetY, durationMs) {
		ensureRoot();
		if (!STATE.cursor) return Promise.resolve();
		if (STATE.moveAnim && STATE.moveAnim.cancel) STATE.moveAnim.cancel();
		const startX = STATE.x;
		const startY = STATE.y;
		const dx = targetX - startX;
		const dy = targetY - startY;
		const distance = Math.hypot(dx, dy);
		// 自适应速度：短距离更快，长距离仍然有上限。
		const dur = typeof durationMs === 'number'
			? Math.max(80, durationMs)
			: Math.min(900, Math.max(180, distance * 1.4));

		// 用三阶贝塞尔曲线产生轻微弯曲的轨迹（不是直线），更像人手。
		const perpX = -dy / (distance || 1);
		const perpY = dx / (distance || 1);
		const sag = Math.min(80, distance * 0.18) * (Math.random() > 0.5 ? 1 : -1);
		const c1x = startX + dx * 0.3 + perpX * sag * 0.6;
		const c1y = startY + dy * 0.3 + perpY * sag * 0.6;
		const c2x = startX + dx * 0.7 + perpX * sag * 0.9;
		const c2y = startY + dy * 0.7 + perpY * sag * 0.9;

		showInternal();
		return new Promise((resolve) => {
			const t0 = performance.now();
			let cancelled = false;
			function frame(now) {
				if (cancelled) return;
				const raw = Math.min(1, (now - t0) / dur);
				const t = easeInOutCubic(raw);
				const x = bezier(startX, c1x, c2x, targetX, t);
				const y = bezier(startY, c1y, c2y, targetY, t);
				// 轻微抖动，仅前 70%
				const jitter = raw < 0.7 ? (Math.random() - 0.5) * 0.6 : 0;
				applyPosition(x + jitter, y + jitter);
				if (raw < 1) {
					requestAnimationFrame(frame);
				} else {
					applyPosition(targetX, targetY);
					STATE.moveAnim = null;
					resolve();
				}
			}
			STATE.moveAnim = { cancel: () => { cancelled = true; STATE.moveAnim = null; resolve(); } };
			requestAnimationFrame(frame);
		});
	}

	function showInternal() {
		ensureRoot();
		STATE.visible = true;
		if (STATE.cursor) STATE.cursor.setAttribute('data-visible', '1');
	}

	function hideInternal() {
		STATE.visible = false;
		if (STATE.cursor) STATE.cursor.setAttribute('data-visible', '0');
		if (STATE.labelEl) STATE.labelEl.setAttribute('data-visible', '0');
	}

	function ripple(x, y) {
		ensureRoot();
		if (!STATE.halo) return;
		applyPosition(x, y);
		// 重置动画
		STATE.halo.removeAttribute('data-active');
		// 触发 reflow 让 keyframe 重启
		void STATE.halo.offsetWidth;
		STATE.halo.setAttribute('data-active', '1');
	}

	function click(x, y) {
		ensureRoot();
		if (!STATE.cursor) return Promise.resolve();
		applyPosition(x, y);
		showInternal();
		STATE.cursor.setAttribute('data-pressed', '1');
		ripple(x, y);
		return new Promise((resolve) => {
			setTimeout(() => {
				if (STATE.cursor) STATE.cursor.removeAttribute('data-pressed');
				resolve();
			}, 130);
		});
	}

	function typeIndicator() {
		ripple(STATE.x, STATE.y + 14);
	}

	function setLabel(text, ms) {
		ensureRoot();
		if (!STATE.labelEl) return;
		if (STATE.labelTimer) {
			clearTimeout(STATE.labelTimer);
			STATE.labelTimer = null;
		}
		if (!text) {
			STATE.labelEl.setAttribute('data-visible', '0');
			return;
		}
		STATE.labelEl.textContent = String(text).slice(0, 80);
		STATE.labelEl.setAttribute('data-visible', '1');
		const dur = typeof ms === 'number' && ms > 0 ? ms : 1600;
		STATE.labelTimer = setTimeout(() => {
			if (STATE.labelEl) STATE.labelEl.setAttribute('data-visible', '0');
		}, dur);
	}

	const api = {
		__installed: true,
		show: showInternal,
		hide: hideInternal,
		moveTo,
		click,
		ripple,
		typeIndicator,
		label: setLabel,
		getState: () => ({ x: STATE.x, y: STATE.y, visible: STATE.visible }),
	};

	Object.defineProperty(window, '__asyncAiCursor', {
		value: api,
		configurable: true,
	});

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', ensureRoot, { once: true });
	} else {
		ensureRoot();
	}
})();
`.trim();
}
