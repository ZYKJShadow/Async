import { flattenAssistantTextPartsForSearch } from './agentStructuredMessage';

function normalizeNarrativeText(text: string): string {
	return text.replace(/\n{3,}/g, '\n\n').trim();
}

function stripFencedBlocks(text: string): string {
	return text.replace(/```[\s\S]*?```/g, '').trim();
}

function stripDetailsBlocks(text: string): string {
	return text.replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, '').trim();
}

function stripTrailingRawJson(text: string): string {
	const normalized = text.trim();
	if (!normalized) {
		return '';
	}

	const lines = normalized.split('\n');
	const rawJsonStart = lines.findIndex((line, index) => {
		if (index === 0) {
			return false;
		}
		return /^[\s]*[\[{]/.test(line);
	});

	if (rawJsonStart <= 0) {
		return normalized;
	}

	return lines.slice(0, rawJsonStart).join('\n').trim();
}

export function extractTeamLeadNarrative(summary: string): string {
	const text = flattenAssistantTextPartsForSearch(String(summary ?? '')).trim();
	if (!text) {
		return '';
	}

	const withoutFence = stripFencedBlocks(text);
	const withoutDetails = stripDetailsBlocks(withoutFence || text);
	const withoutRawJson = stripTrailingRawJson(withoutDetails || withoutFence || text);

	return normalizeNarrativeText(withoutRawJson || withoutDetails || withoutFence || text);
}
