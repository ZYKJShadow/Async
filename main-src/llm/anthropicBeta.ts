import type {
	ImageBlockParam,
	TextBlockParam,
	Tool,
	ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';

export type AnthropicCacheControl = { type: 'ephemeral' };

export type AnthropicToolReferenceBlock = {
	type: 'tool_reference';
	tool_name: string;
};

export type AnthropicToolResultContentBlock =
	| TextBlockParam
	| ImageBlockParam
	| AnthropicToolReferenceBlock;

export type AnthropicToolResultContent =
	| string
	| AnthropicToolResultContentBlock[];

export type AnthropicToolResultBlock = Omit<ToolResultBlockParam, 'content'> & {
	content?: AnthropicToolResultContent;
};

export type AnthropicToolSchema = Tool & {
	strict?: boolean;
	defer_loading?: boolean;
	eager_input_streaming?: boolean;
	cache_control?: AnthropicCacheControl | null;
};

export function isAnthropicToolReferenceBlock(
	value: unknown
): value is AnthropicToolReferenceBlock {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { type?: unknown }).type === 'tool_reference' &&
		typeof (value as { tool_name?: unknown }).tool_name === 'string'
	);
}
