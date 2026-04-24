import { useCallback, useEffect, useRef, useState } from 'react';

const FRAME_MS = 1000 / 60;
const HIDDEN_FRAME_MS = 100;
const TARGET_LAG_SECONDS = 0.55;
const FINISH_EXTRA_CHARS = 100;
const INITIAL_CHARS_PER_SECOND = 100;
const VELOCITY_SMOOTHING = 0.99;
const VELOCITY_GRAVITY = 1e-5;
const EPSILON = 0.01;

type Arrival = [seconds: number, chars: number];
type ScheduleHandle =
	| { type: 'raf'; id: number }
	| { type: 'timeout'; id: number };

function solveRevealPosition(
	fn: (value: number) => number,
	lower: number,
	upper: number,
	epsilon = EPSILON
): number {
	if (lower === upper) return lower;

	let low = lower;
	let high = upper;
	let lowValue = fn(low);
	let highValue = fn(high);

	if (low >= high || lowValue > epsilon || highValue < -epsilon) {
		return lower;
	}

	for (let i = 0; i < 32 && lowValue < -epsilon; i += 1) {
		const mid = (low + high) / 2;
		const midValue = fn(mid);

		if (midValue <= 0) {
			low = mid;
			lowValue = midValue;
		} else {
			high = mid;
			highValue = midValue;
		}
	}

	return low;
}

export function useTypewriter(fullText: string, active: boolean): string {
	const [displayed, setDisplayed] = useState(fullText);
	const fullRef = useRef(fullText);
	const displayedRef = useRef(fullText);
	const revealedRef = useRef(fullText.length);
	const velocityRef = useRef(INITIAL_CHARS_PER_SECOND);
	const lastTickSecondsRef = useRef(0);
	const streamStartRef = useRef(0);
	const arrivalsRef = useRef<Arrival[]>([[-9999, 0]]);
	const scheduleRef = useRef<ScheduleHandle | null>(null);
	const lastVisibilityCheckRef = useRef(0);
	const visibleRef = useRef(true);

	const commitDisplayed = useCallback((value: string) => {
		if (displayedRef.current === value) return;
		displayedRef.current = value;
		setDisplayed(value);
	}, []);

	const stop = useCallback(() => {
		const schedule = scheduleRef.current;
		if (schedule) {
			if (schedule.type === 'raf') {
				cancelAnimationFrame(schedule.id);
			} else {
				clearTimeout(schedule.id);
			}
			scheduleRef.current = null;
		}
	}, []);

	const scheduleNext = useCallback((callback: () => void, visible: boolean) => {
		scheduleRef.current = visible
			? { type: 'raf', id: requestAnimationFrame(callback) }
			: { type: 'timeout', id: window.setTimeout(callback, HIDDEN_FRAME_MS) };
	}, []);

	const revealAll = useCallback(() => {
		revealedRef.current = fullRef.current.length;
		commitDisplayed(fullRef.current);
	}, [commitDisplayed]);

	useEffect(() => {
		const previousText = fullRef.current;
		const previousLength = previousText.length;
		fullRef.current = fullText;

		if (!active) {
			stop();
			revealAll();
			return;
		}

		const now = performance.now();
		if (!fullText.startsWith(previousText) || revealedRef.current > fullText.length) {
			streamStartRef.current = now;
			lastTickSecondsRef.current = 0;
			velocityRef.current = INITIAL_CHARS_PER_SECOND;
			revealedRef.current = Math.min(revealedRef.current, fullText.length);
			arrivalsRef.current = [[-9999, 0], [0, fullText.length]];
		} else if (fullText.length !== previousLength) {
			if (streamStartRef.current === 0) {
				streamStartRef.current = now;
			}
			arrivalsRef.current = [
				...arrivalsRef.current,
				[(now - streamStartRef.current) / 1000, fullText.length],
			];
		}

		const animate = () => {
			const currentText = fullRef.current;
			const totalLength = currentText.length;

			if (streamStartRef.current === 0) {
				streamStartRef.current = performance.now();
			}

			if (document.hidden) {
				revealAll();
				scheduleNext(animate, false);
				return;
			}

			if (revealedRef.current >= totalLength) {
				revealAll();
				scheduleNext(animate, true);
				return;
			}

			const nowSeconds = (performance.now() - streamStartRef.current) / 1000;
			const previousSeconds = lastTickSecondsRef.current || Math.max(0, nowSeconds - FRAME_MS / 1000);
			const elapsedSeconds = Math.max(1 / 240, nowSeconds - previousSeconds);
			const maxChars = Math.min(totalLength + FINISH_EXTRA_CHARS, totalLength);
			const deadlineSeconds = 0.9 * nowSeconds - TARGET_LAG_SECONDS;
			const arrivalChars = arrivalsRef.current
				.filter(([seconds]) => seconds < deadlineSeconds)
				.map(([, chars]) => chars);
			const minChars = arrivalChars[arrivalChars.length - 1] ?? 0;

			const lower = Math.max(minChars, revealedRef.current);
			const upper = Math.max(lower, maxChars);

			let nextReveal = upper;
			if (upper > lower) {
				nextReveal = solveRevealPosition((candidate) => {
					const instantaneousVelocity = (candidate - revealedRef.current) / elapsedSeconds;
					const inverseElapsed = 1 / elapsedSeconds;
					return (
						2 * VELOCITY_GRAVITY * inverseElapsed *
							(instantaneousVelocity - velocityRef.current) -
						1 / Math.max(EPSILON, candidate - minChars) +
						1 / Math.max(EPSILON, totalLength + FINISH_EXTRA_CHARS - candidate)
					);
				}, lower, upper);
			}

			const instantaneousVelocity = (nextReveal - revealedRef.current) / elapsedSeconds;
			velocityRef.current =
				VELOCITY_SMOOTHING * velocityRef.current +
				(1 - VELOCITY_SMOOTHING) * instantaneousVelocity;
			revealedRef.current = Math.max(nextReveal, revealedRef.current);
			lastTickSecondsRef.current = nowSeconds;

			const nextPos = Math.min(totalLength, Math.ceil(revealedRef.current));
			commitDisplayed(currentText.slice(0, nextPos));

			const nowMs = performance.now();
			if (nowMs - lastVisibilityCheckRef.current > 1000) {
				visibleRef.current = !document.hidden;
				lastVisibilityCheckRef.current = nowMs;
			}

			if (visibleRef.current) {
				scheduleNext(animate, true);
			} else {
				scheduleNext(animate, false);
			}
		};

		if (scheduleRef.current === null) {
			scheduleNext(animate, true);
		}

		return stop;
	}, [active, fullText, revealAll, stop, commitDisplayed, scheduleNext]);

	return active ? displayed : fullText;
}
