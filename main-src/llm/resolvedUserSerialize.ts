import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { Part } from '@google/generative-ai';
import type { ResolvedUserMessage } from './sendResolved.js';

export type OpenAIContentPart =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } };

export type OpenAIUserContent = string | OpenAIContentPart[];

function buildResolvedTextBody(resolved: ResolvedUserMessage): string {
	const textParts: string[] = [];
	for (const segment of resolved.segments) {
		if (segment.kind === 'text') {
			textParts.push(segment.text);
		} else if (segment.kind === 'image_error') {
			textParts.push(`[image error (${segment.error.kind}): ${segment.relPath}]`);
		}
	}
	return textParts.join('');
}

export function buildOpenAIUserContent(resolved: ResolvedUserMessage): OpenAIUserContent {
	const parts: OpenAIContentPart[] = [];
	const textBody = buildResolvedTextBody(resolved);
	if (textBody.length > 0) {
		parts.push({ type: 'text', text: textBody });
	}
	for (const segment of resolved.segments) {
		if (segment.kind === 'image_asset') {
			parts.push({
				type: 'image_url',
				image_url: {
					url: `data:${segment.asset.mimeType};base64,${segment.asset.buffer.toString('base64')}`,
				},
			});
		}
	}
	if (parts.length === 0) {
		return '';
	}
	if (parts.length === 1 && parts[0]!.type === 'text') {
		return parts[0]!.text;
	}
	return parts;
}

export function buildAnthropicUserBlocks(resolved: ResolvedUserMessage): ContentBlockParam[] {
	const blocks: ContentBlockParam[] = [];
	const textBody = buildResolvedTextBody(resolved);
	if (textBody.length > 0) {
		blocks.push({ type: 'text', text: textBody });
	}
	for (const segment of resolved.segments) {
		if (segment.kind === 'image_asset') {
			blocks.push({
				type: 'image',
				source: {
					type: 'base64',
					media_type: segment.asset.mimeType,
					data: segment.asset.buffer.toString('base64'),
				},
			});
		}
	}
	return blocks;
}

export function buildGeminiUserParts(resolved: ResolvedUserMessage): Part[] {
	const parts: Part[] = [];
	const textBody = buildResolvedTextBody(resolved);
	if (textBody.length > 0) {
		parts.push({ text: textBody });
	}
	for (const segment of resolved.segments) {
		if (segment.kind === 'image_asset') {
			parts.push({
				inlineData: {
					mimeType: segment.asset.mimeType,
					data: segment.asset.buffer.toString('base64'),
				},
			});
		}
	}
	if (parts.length === 0) {
		parts.push({ text: '' });
	}
	return parts;
}
