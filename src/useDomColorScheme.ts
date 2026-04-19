import { useEffect, useState } from 'react';
import { readDomColorScheme, type EffectiveColorScheme } from './colorMode';

export function useDomColorScheme(): EffectiveColorScheme {
	const [scheme, setScheme] = useState<EffectiveColorScheme>(() => readDomColorScheme());

	useEffect(() => {
		if (typeof document === 'undefined') {
			return;
		}
		const sync = () => {
			setScheme((current) => {
				const next = readDomColorScheme();
				return current === next ? current : next;
			});
		};
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-color-scheme'],
		});
		return () => observer.disconnect();
	}, []);

	return scheme;
}
