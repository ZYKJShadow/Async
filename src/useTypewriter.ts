import { useCallback, useEffect, useRef, useState } from 'react';

export function useTypewriter(fullText: string, active: boolean): string {
	const [displayed, setDisplayed] = useState(fullText);
	const fullRef = useRef(fullText);
	const posRef = useRef(fullText.length);
	const rafRef = useRef<number | null>(null);
	const lastTimeRef = useRef<number>(0);

	const stop = useCallback(() => {
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
	}, []);

	useEffect(() => {
		fullRef.current = fullText;

		if (!active) {
			stop();
			if (posRef.current !== fullText.length) {
				posRef.current = fullText.length;
				setDisplayed(fullText);
			}
			return;
		}

		const animate = (time: number) => {
			const elapsed = lastTimeRef.current ? time - lastTimeRef.current : 16;

			const backlog = fullRef.current.length - posRef.current;

			if (backlog <= 0) {
				if (posRef.current > fullRef.current.length) {
					posRef.current = fullRef.current.length;
					setDisplayed(fullRef.current);
				}
				lastTimeRef.current = time;
				rafRef.current = requestAnimationFrame(animate);
				return;
			}

			lastTimeRef.current = time;

			// 自适应速度：积压越少速度越慢（打字机感强），积压越多速度越快
			const minCps = 25; // chars/sec when little backlog
			const maxCps = 800; // chars/sec when heavy backlog
			const threshold = 40;
			const ratio = Math.min(1, backlog / threshold);
			const speed = minCps + ratio * (maxCps - minCps);
			const charsToAdd = Math.max(1, Math.round((speed * elapsed) / 1000));
			const nextPos = Math.min(fullRef.current.length, posRef.current + charsToAdd);

			if (nextPos !== posRef.current) {
				posRef.current = nextPos;
				setDisplayed(fullText.slice(0, nextPos));
			}

			rafRef.current = requestAnimationFrame(animate);
		};

		if (rafRef.current === null) {
			lastTimeRef.current = 0;
			rafRef.current = requestAnimationFrame(animate);
		}

		return () => {
			stop();
		};
	}, [fullText, active, stop]);

	return active ? displayed : fullText;
}
