const TOAST_CLASS = 'ref-uterm-notice-toast';
const HIDE_TIMER_KEY = '__asyncTerminalToastHideTimer';
const REMOVE_TIMER_KEY = '__asyncTerminalToastRemoveTimer';

type ToastElement = HTMLDivElement & {
	[HIDE_TIMER_KEY]?: number;
	[REMOVE_TIMER_KEY]?: number;
};

export function showTerminalCopiedNotice(message: string, durationMs = 1000): void {
	if (typeof document === 'undefined') {
		return;
	}
	let el = document.querySelector<ToastElement>(`.${TOAST_CLASS}`);
	if (!el) {
		el = document.createElement('div') as ToastElement;
		el.className = TOAST_CLASS;
		el.setAttribute('role', 'status');
		document.body.appendChild(el);
	}
	if (el[HIDE_TIMER_KEY] !== undefined) {
		window.clearTimeout(el[HIDE_TIMER_KEY]);
	}
	if (el[REMOVE_TIMER_KEY] !== undefined) {
		window.clearTimeout(el[REMOVE_TIMER_KEY]);
	}
	el.textContent = message;
	requestAnimationFrame(() => {
		el.classList.add('is-visible');
	});
	el[HIDE_TIMER_KEY] = window.setTimeout(() => {
		el.classList.remove('is-visible');
		el[REMOVE_TIMER_KEY] = window.setTimeout(() => el.remove(), 320);
	}, durationMs);
}
