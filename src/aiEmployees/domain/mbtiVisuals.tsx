import type { CSSProperties } from 'react';
import type { MbtiType } from './persona';
import { MBTI_FAMILY_BY_TYPE, MBTI_LABELS } from './persona';

type MbtiFamily = 'analysts' | 'diplomats' | 'sentinels' | 'explorers';

type MbtiPalette = {
	bg: string;
	accent: string;
	accentSoft: string;
	ink: string;
};

export type MbtiVisualMeta = {
	type: MbtiType;
	family: MbtiFamily;
	label: string;
	shortTraits: string[];
	palette: MbtiPalette;
	badge: string;
	shape: 'diamond' | 'orb' | 'shield' | 'bolt';
};

const FAMILY_PALETTES: Record<MbtiFamily, MbtiPalette> = {
	analysts: { bg: '#1f2f53', accent: '#7c9dff', accentSoft: '#d9e4ff', ink: '#eef4ff' },
	diplomats: { bg: '#4a2159', accent: '#d97bff', accentSoft: '#f6ddff', ink: '#fff0ff' },
	sentinels: { bg: '#235248', accent: '#6cd2b1', accentSoft: '#d9fff1', ink: '#effff9' },
	explorers: { bg: '#5b3415', accent: '#ffb15f', accentSoft: '#ffe7cb', ink: '#fff6ee' },
};

const MBTI_BADGES: Record<MbtiType, string> = {
	INTJ: '♜',
	INTP: '⌬',
	ENTJ: '▲',
	ENTP: '✦',
	INFJ: '✺',
	INFP: '❦',
	ENFJ: '✶',
	ENFP: '☄',
	ISTJ: '▣',
	ISFJ: '✚',
	ESTJ: '⬢',
	ESFJ: '❋',
	ISTP: '⚙',
	ISFP: '❂',
	ESTP: '⚡',
	ESFP: '✹',
};

const MBTI_SHAPES: Record<MbtiType, MbtiVisualMeta['shape']> = {
	INTJ: 'diamond',
	INTP: 'diamond',
	ENTJ: 'diamond',
	ENTP: 'diamond',
	INFJ: 'orb',
	INFP: 'orb',
	ENFJ: 'orb',
	ENFP: 'orb',
	ISTJ: 'shield',
	ISFJ: 'shield',
	ESTJ: 'shield',
	ESFJ: 'shield',
	ISTP: 'bolt',
	ISFP: 'bolt',
	ESTP: 'bolt',
	ESFP: 'bolt',
};

export const mbtiVisualRegistry: Record<MbtiType, MbtiVisualMeta> = (Object.keys(MBTI_LABELS) as MbtiType[]).reduce(
	(acc, type) => {
		const family = MBTI_FAMILY_BY_TYPE[type];
		acc[type] = {
			type,
			family,
			label: MBTI_LABELS[type].label,
			shortTraits: MBTI_LABELS[type].shortTraits,
			palette: FAMILY_PALETTES[family],
			badge: MBTI_BADGES[type],
			shape: MBTI_SHAPES[type],
		};
		return acc;
	},
	{} as Record<MbtiType, MbtiVisualMeta>
);

function shapePath(shape: MbtiVisualMeta['shape']): string {
	switch (shape) {
		case 'diamond':
			return 'M58 18 88 48 58 78 28 48Z';
		case 'orb':
			return 'M58 18 C77 18 92 33 92 52 C92 71 77 86 58 86 C39 86 24 71 24 52 C24 33 39 18 58 18Z';
		case 'shield':
			return 'M58 16 88 26 83 62 C80 79 69 88 58 96 C47 88 36 79 33 62 L28 26Z';
		case 'bolt':
		default:
			return 'M62 16 31 57 52 57 44 92 85 42 63 42Z';
	}
}

export function MbtiAvatar({
	mbtiType,
	size = 72,
	label,
	style,
}: {
	mbtiType?: MbtiType | null;
	size?: number;
	label?: string;
	style?: CSSProperties;
}) {
	if (!mbtiType) {
		return (
			<div
				aria-label={label ?? 'AI employee'}
				style={{
					width: size,
					height: size,
					borderRadius: size / 2,
					background: 'linear-gradient(135deg, #4b5563, #1f2937)',
					display: 'grid',
					placeItems: 'center',
					color: '#fff',
					fontWeight: 700,
					...style,
				}}
			>
				AI
			</div>
		);
	}
	const meta = mbtiVisualRegistry[mbtiType];
	return (
		<svg
			viewBox="0 0 116 116"
			width={size}
			height={size}
			role="img"
			aria-label={label ?? `${mbtiType} ${meta.label}`}
			style={style}
		>
			<defs>
				<linearGradient id={`bg-${mbtiType}`} x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stopColor={meta.palette.bg} />
					<stop offset="100%" stopColor={meta.palette.accent} />
				</linearGradient>
			</defs>
			<rect x="4" y="4" width="108" height="108" rx="28" fill={`url(#bg-${mbtiType})`} />
			<circle cx="58" cy="42" r="17" fill={meta.palette.ink} opacity="0.92" />
			<path d="M27 94c5-22 19-33 31-33s26 11 31 33" fill={meta.palette.ink} opacity="0.92" />
			<path d={shapePath(meta.shape)} fill={meta.palette.accentSoft} opacity="0.85" />
			<text
				x="58"
				y="60"
				textAnchor="middle"
				fontSize="22"
				fontWeight="700"
				fill={meta.palette.bg}
				style={{ dominantBaseline: 'middle' }}
			>
				{meta.badge}
			</text>
			<text x="58" y="104" textAnchor="middle" fontSize="12" fontWeight="700" fill={meta.palette.ink}>
				{mbtiType}
			</text>
		</svg>
	);
}
