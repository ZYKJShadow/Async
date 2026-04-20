const TOAST_CLASS = 'ref-uterm-notice-toast';

export function showTerminalCopiedNotice(message: string, durationMs = 1000): void {
	if (typeof document === 'undefined') {
		return;
	}
	const el = document.createElement('div');
	el.className = TOAST_CLASS;
	el.setAttribute('role', 'status');
	el.textContent = message;
	document.body.appendChild(el);
	requestAnimationFrame(() => {
		el.classList.add('is-visible');
	});
	window.setTimeout(() => {
		el.classList.remove('is-visible');
		window.setTimeout(() => el.remove(), 200);
	}, durationMs);
}
