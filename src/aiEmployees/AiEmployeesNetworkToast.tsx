import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from '../i18n';

type ToastListener = (message: string) => void;

let toastListener: ToastListener | null = null;

/** 注册全局 toast；由 {@link AiEmployeesNetworkToastHost} 在挂载时设置。 */
export function setAiEmployeesNetworkToastListener(fn: ToastListener | null) {
	toastListener = fn;
}

/** 弹出网络 / API 失败提示（无 host 时降级为 console）。 */
export function publishAiEmployeesNetworkError(message: string) {
	const t = message.trim();
	if (!t) {
		return;
	}
	if (toastListener) {
		toastListener(t);
	} else {
		console.warn('[ai-employees]', t);
	}
}

export function notifyAiEmployeesRequestFailed(e: unknown) {
	const msg = e instanceof Error ? e.message : String(e);
	publishAiEmployeesNetworkError(msg);
}

type ToastItem = { id: number; text: string };

const TOAST_TTL_MS = 5600;
const MAX_VISIBLE = 5;

/**
 * 固定在视口顶层的轻量 toast，用于 AI Employees 内 HTTP/API 失败，
 * 避免在 sheet / 侧栏内挤占版面。
 */
export function AiEmployeesNetworkToastHost({ t }: { t: TFunction }) {
	const [items, setItems] = useState<ToastItem[]>([]);
	const idRef = useRef(0);
	const timersRef = useRef<Map<number, number>>(new Map());

	const remove = useCallback((id: number) => {
		const tm = timersRef.current.get(id);
		if (tm != null) {
			window.clearTimeout(tm);
			timersRef.current.delete(id);
		}
		setItems((prev) => prev.filter((x) => x.id !== id));
	}, []);

	useEffect(() => {
		const onMsg = (text: string) => {
			const id = ++idRef.current;
			setItems((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, text }]);
			const tm = window.setTimeout(() => remove(id), TOAST_TTL_MS);
			timersRef.current.set(id, tm);
		};
		setAiEmployeesNetworkToastListener(onMsg);
		return () => {
			setAiEmployeesNetworkToastListener(null);
			for (const tm of timersRef.current.values()) {
				window.clearTimeout(tm);
			}
			timersRef.current.clear();
		};
	}, [remove]);

	if (typeof document === 'undefined') {
		return null;
	}

	return createPortal(
		<div className="ref-ai-employees-network-toast-stack" aria-live="polite" aria-relevant="additions">
			{items.map((it) => (
				<div key={it.id} className="ref-ai-employees-network-toast" role="status">
					<div className="ref-ai-employees-network-toast-row">
						<span className="ref-ai-employees-network-toast-title">{t('aiEmployees.networkToastTitle')}</span>
						<button
							type="button"
							className="ref-ai-employees-network-toast-dismiss"
							aria-label={t('common.close')}
							onClick={() => remove(it.id)}
						>
							×
						</button>
					</div>
					<p className="ref-ai-employees-network-toast-body">{it.text}</p>
				</div>
			))}
		</div>,
		document.body
	);
}
