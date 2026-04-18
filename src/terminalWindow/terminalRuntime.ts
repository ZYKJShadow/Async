import type { TerminalAppSettings } from './terminalSettings';

type PasteBehaviorSettings = Pick<
	TerminalAppSettings,
	'trimWhitespaceOnPaste' | 'warnOnMultilinePaste'
>;

type TerminalLike = {
	buffer: {
		active: {
			type: string;
		};
	};
};

let bellAudioContext: AudioContext | null = null;

export async function prepareTerminalPasteText(
	text: string,
	settings: PasteBehaviorSettings,
	alternateScreenActive: boolean,
	confirmPaste: (preview: string) => Promise<boolean> | boolean
): Promise<string | null> {
	let next = normalizeTerminalLineEndings(text);

	if (settings.trimWhitespaceOnPaste && hasSingleTrailingLineBreak(next)) {
		next = next.slice(0, -1);
	}

	const hasMultipleLines = next.includes('\r') || next.includes('\n');
	if (!alternateScreenActive) {
		if (hasMultipleLines && settings.warnOnMultilinePaste) {
			const confirmed = await confirmPaste(toPastePreview(next));
			if (!confirmed) {
				return null;
			}
		} else if (settings.trimWhitespaceOnPaste) {
			next = next.trimEnd();
			if (!next.includes('\r') && !next.includes('\n')) {
				next = next.trimStart();
			}
		}
	}

	return next;
}

export function isTerminalAlternateScreen(term: TerminalLike): boolean {
	return term.buffer.active.type === 'alternate';
}

export function playAudibleTerminalBell(): void {
	if (typeof window === 'undefined') {
		return;
	}
	const AudioCtor =
		window.AudioContext ||
		(window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!AudioCtor) {
		return;
	}
	try {
		if (!bellAudioContext) {
			bellAudioContext = new AudioCtor();
		}
		const ctx = bellAudioContext;
		if (ctx.state === 'suspended') {
			void ctx.resume().catch(() => {
				/* ignore */
			});
		}
		const oscillator = ctx.createOscillator();
		const gain = ctx.createGain();
		const now = ctx.currentTime;

		oscillator.type = 'sine';
		oscillator.frequency.setValueAtTime(880, now);
		gain.gain.setValueAtTime(0.0001, now);
		gain.gain.exponentialRampToValueAtTime(0.035, now + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

		oscillator.connect(gain);
		gain.connect(ctx.destination);
		oscillator.start(now);
		oscillator.stop(now + 0.14);
	} catch {
		/* ignore */
	}
}

function normalizeTerminalLineEndings(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\n/g, '\r');
}

function hasSingleTrailingLineBreak(text: string): boolean {
	const lastChar = text.at(-1);
	if (lastChar !== '\r' && lastChar !== '\n') {
		return false;
	}
	const body = text.slice(0, -1);
	return !body.includes('\r') && !body.includes('\n');
}

function toPastePreview(text: string): string {
	return text.replace(/\r/g, '\n');
}
