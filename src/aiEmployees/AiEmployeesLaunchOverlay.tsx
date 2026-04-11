import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hideBootSplash } from '../bootSplash';
import type { TFunction } from '../i18n';
import { IconBot } from '../icons';
import type { AiEmployeesSessionPhase } from './sessionTypes';

type Phase = 'on' | 'exiting' | 'done';

function readReduceMotion(): boolean {
	try {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}

/**
 * AI 员工独立窗口首屏：在通用 boot-splash 之后展示团队主题启动动画，并在会话就绪后淡出。
 */
export function AiEmployeesLaunchOverlay({
	sessionPhase,
	t,
}: {
	sessionPhase: AiEmployeesSessionPhase;
	t: TFunction;
}) {
	const [phase, setPhase] = useState<Phase>('on');
	const mountAt = useRef(Date.now());
	const reduceMotionRef = useRef(readReduceMotion());

	useLayoutEffect(() => {
		hideBootSplash();
	}, []);

	useEffect(() => {
		if (phase !== 'on') {
			return;
		}
		const minMs = reduceMotionRef.current ? 0 : 1000;
		const tick = () => {
			const ready = sessionPhase !== 'bootstrapping';
			const minOk = Date.now() - mountAt.current >= minMs;
			if (ready && minOk) {
				if (reduceMotionRef.current) {
					setPhase('done');
				} else {
					setPhase('exiting');
				}
			}
		};
		const id = window.setInterval(tick, 72);
		tick();
		return () => window.clearInterval(id);
	}, [sessionPhase, phase]);

	useEffect(() => {
		if (phase !== 'exiting') {
			return;
		}
		const id = window.setTimeout(() => setPhase('done'), 500);
		return () => window.clearTimeout(id);
	}, [phase]);

	if (phase === 'done') {
		return null;
	}

	return (
		<div
			className={`ref-ai-employees-launch ${phase === 'exiting' ? 'ref-ai-employees-launch--exiting' : ''}`}
			aria-hidden="true"
		>
			<div className="ref-ai-employees-launch-bg" />
			<div className="ref-ai-employees-launch-card">
				<div className="ref-ai-employees-launch-orbit" aria-hidden>
					<span className="ref-ai-employees-launch-orbit-ring" />
					<span className="ref-ai-employees-launch-orbit-dot ref-ai-employees-launch-orbit-dot--a" />
					<span className="ref-ai-employees-launch-orbit-dot ref-ai-employees-launch-orbit-dot--b" />
					<span className="ref-ai-employees-launch-orbit-dot ref-ai-employees-launch-orbit-dot--c" />
					<div className="ref-ai-employees-launch-icon-wrap">
						<IconBot className="ref-ai-employees-launch-icon" />
					</div>
				</div>
				<div className="ref-ai-employees-launch-copy">
					<div className="ref-ai-employees-launch-title">{t('aiEmployees.launch.title')}</div>
					<div className="ref-ai-employees-launch-sub">{t('aiEmployees.launch.subtitle')}</div>
				</div>
				<div className="ref-ai-employees-launch-dots" aria-hidden>
					<span />
					<span />
					<span />
				</div>
			</div>
		</div>
	);
}
