import { createPortal } from 'react-dom';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from '../i18n';
import { TerminalHotkeyMatcher } from './terminalHotkeyMatcher';

const INPUT_TIMEOUT_MS = 1000;

type Props = {
	open: boolean;
	onClose(result: string[] | null): void;
	t: TFunction;
};

export const TerminalHotkeyInputModal = memo(function TerminalHotkeyInputModal({ open, onClose, t }: Props) {
	const [strokes, setStrokes] = useState<string[]>([]);
	const [timeoutProgress, setTimeoutProgress] = useState(0);
	const chunksRef = useRef<string[]>([]);
	const lastKeyRef = useRef<number | null>(null);
	const intervalRef = useRef<number | null>(null);
	const onCloseRef = useRef(onClose);
	const finishedRef = useRef(false);
	onCloseRef.current = onClose;

	const finish = useCallback((result: string[] | null) => {
		if (finishedRef.current) {
			return;
		}
		finishedRef.current = true;
		onCloseRef.current(result);
	}, []);

	useEffect(() => {
		if (!open) {
			chunksRef.current = [];
			setStrokes([]);
			setTimeoutProgress(0);
			lastKeyRef.current = null;
			finishedRef.current = false;
			return;
		}

		finishedRef.current = false;
		chunksRef.current = [];
		setStrokes([]);
		setTimeoutProgress(0);
		lastKeyRef.current = null;

		const matcher = new TerminalHotkeyMatcher(
			() => ({}),
			() => {},
			(stroke) => {
				chunksRef.current.push(stroke);
				setStrokes([...chunksRef.current]);
				lastKeyRef.current = performance.now();
			}
		);

		const detach = () => {
			if (intervalRef.current != null) {
				window.clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('keyup', onKeyUp, true);
			matcher.clearCurrentKeystrokes();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				detach();
				finish(null);
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			matcher.pushKeyEvent('keydown', event);
		};

		const onKeyUp = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			matcher.pushKeyEvent('keyup', event);
		};

		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('keyup', onKeyUp, true);

		intervalRef.current = window.setInterval(() => {
			if (lastKeyRef.current == null) {
				setTimeoutProgress(0);
				return;
			}
			const p = Math.min(100, ((performance.now() - lastKeyRef.current) * 100) / INPUT_TIMEOUT_MS);
			setTimeoutProgress(p);
			if (p >= 100) {
				detach();
				finish([...chunksRef.current]);
			}
		}, 25);

		return () => {
			detach();
		};
	}, [open, finish]);

	const onCancelClick = useCallback(() => {
		finish(null);
	}, [finish]);

	if (!open || typeof document === 'undefined') {
		return null;
	}

	return createPortal(
		<div className="ref-uterm-hotkey-modal-backdrop" role="presentation">
			<div className="ref-uterm-hotkey-modal" role="dialog" aria-modal="true" aria-labelledby="ref-uterm-hotkey-modal-title">
				<div className="ref-uterm-hotkey-modal-header">
					<h5 id="ref-uterm-hotkey-modal-title" className="ref-uterm-hotkey-modal-title">
						{t('app.universalTerminalSettings.hotkeys.pressKeysNow')}
					</h5>
				</div>
				<div className="ref-uterm-hotkey-modal-body">
					<div className="ref-uterm-hotkey-modal-input">
						{strokes.map((stroke, index) => (
							<span key={`${index}-${stroke}`} className="ref-uterm-hotkey-modal-stroke">
								{stroke}
							</span>
						))}
					</div>
					<div className="ref-uterm-hotkey-modal-timeout">
						<div style={{ width: `${timeoutProgress}%` }} />
					</div>
				</div>
				<div className="ref-uterm-hotkey-modal-footer">
					<button type="button" className="ref-uterm-hotkey-modal-cancel" onClick={onCancelClick}>
						{t('app.universalTerminalSettings.hotkeys.cancel')}
					</button>
				</div>
			</div>
		</div>,
		document.body
	);
});
