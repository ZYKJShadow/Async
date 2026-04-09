import { formatTokenCountShort } from './contextMeterFormat';
import type { TFunction } from './i18n';

export type ComposerContextMeterProps = {
	maxTokens: number;
	usedEstimate: number;
	isDefaultMax: boolean;
	t: TFunction;
};

const R = 7;
const C = 2 * Math.PI * R;

/**
 * 输入区 Git 分支左侧：圆形上下文占用；悬浮提示使用主题色变量，与亮/暗模式一致。
 */
export function ComposerContextMeter({
	maxTokens,
	usedEstimate,
	isDefaultMax,
	t,
}: ComposerContextMeterProps) {
	const max = Math.max(1, maxTokens);
	const ratio = Math.min(1, Math.max(0, usedEstimate / max));
	const dashOffset = C * (1 - ratio);
	const stroke =
		ratio >= 0.95
			? 'var(--void-git-deleted, #e5534b)'
			: ratio >= 0.8
				? 'var(--void-git-modified, #d4a017)'
				: 'color-mix(in srgb, var(--void-accent) 82%, var(--void-fg-2))';

	const usedStr = formatTokenCountShort(usedEstimate);
	const maxStr = formatTokenCountShort(maxTokens);
	const detailKey = isDefaultMax ? 'app.contextMeter.detailDefault' : 'app.contextMeter.detailCustom';
	const detailRaw = t(detailKey, { used: usedStr, max: maxStr });
	const detailLines = detailRaw.split('\n').map((line) => line.trim()).filter(Boolean);
	const ariaSummary = t('app.contextMeter.ariaSummary', {
		used: usedStr,
		max: maxStr,
		note: isDefaultMax ? t('app.contextMeter.ariaDefaultNote') : t('app.contextMeter.ariaCustomNote'),
	});

	return (
		<div
			className="ref-composer-context-meter-wrap"
			tabIndex={0}
			role="group"
			aria-label={ariaSummary}
		>
			<div className="ref-composer-context-meter" aria-hidden>
				<svg width="22" height="22" viewBox="0 0 22 22">
					<circle
						className="ref-composer-context-meter-track"
						cx="11"
						cy="11"
						r={R}
						fill="none"
						strokeWidth="2.25"
					/>
					<circle
						className="ref-composer-context-meter-progress"
						cx="11"
						cy="11"
						r={R}
						fill="none"
						strokeWidth="2.25"
						stroke={stroke}
						strokeLinecap="round"
						strokeDasharray={C}
						strokeDashoffset={dashOffset}
						transform="rotate(-90 11 11)"
					/>
				</svg>
			</div>
			<div className="ref-composer-context-meter-tip" role="tooltip">
				{detailLines.map((line, i) => (
					<p
						key={i}
						className={
							i === detailLines.length - 1
								? 'ref-composer-context-meter-tip-line ref-composer-context-meter-tip-line--muted'
								: 'ref-composer-context-meter-tip-line'
						}
					>
						{line}
					</p>
				))}
			</div>
		</div>
	);
}
