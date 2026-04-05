import { createTwoFilesPatch } from 'diff';
import { countDiffLineStats } from './gitService.js';

/** 与 sidebar 线程摘要一致：统计单个 unified diff 块内的 +/- 行。 */
export function countDiffLinesInChunk(chunk: string): { add: number; del: number } {
	let add = 0;
	let del = 0;
	for (const line of chunk.split('\n')) {
		if (line.startsWith('+') && !line.startsWith('+++')) {
			add++;
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			del++;
		}
	}
	return { add, del };
}

const MAX_DIFF_CHARS = 500_000;

/** 将两段文本规范为 LF 后生成最小上下文 patch，再统计增删行数。 */
export function countLineChangesBetweenTexts(previous: string | null, next: string): { additions: number; deletions: number } {
	const oldLF = (previous ?? '').replace(/\r\n/g, '\n');
	const newLF = next.replace(/\r\n/g, '\n');
	if (oldLF.length > MAX_DIFF_CHARS || newLF.length > MAX_DIFF_CHARS) {
		const oldLines = oldLF.split('\n').length;
		const newLines = newLF.split('\n').length;
		const d = Math.abs(newLines - oldLines);
		return newLines >= oldLines ? { additions: d, deletions: 0 } : { additions: 0, deletions: d };
	}
	const patch = createTwoFilesPatch('a', 'b', oldLF, newLF, '', '', { context: 2 });
	return countDiffLineStats(patch);
}
