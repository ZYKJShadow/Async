import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatMarkdown } from './ChatMarkdown';
import { I18nProvider } from './i18n';
import type { LiveAgentBlocksState } from './liveAgentBlocks';

vi.mock('./AgentResultCard', () => ({
	AgentResultCard: () => null,
}));

function renderChatMarkdown(props: ComponentProps<typeof ChatMarkdown>): string {
	return renderToStaticMarkup(
		React.createElement(
			I18nProvider,
			null,
			React.createElement(ChatMarkdown, props)
		)
	);
}

const liveBlocksWithInterleavedThinking: LiveAgentBlocksState = {
	blocks: [
		{
			id: 'think-1',
			type: 'thinking',
			text: 'Inspect the current UI state.',
			sealed: true,
			startedAt: 1000,
			endedAt: 1400,
		},
		{
			id: 'txt-1',
			type: 'text',
			text: '我正在整理结果。',
		},
		{
			id: 'think-2',
			type: 'thinking',
			text: 'Prepare the final response.',
			startedAt: 1500,
		},
	],
};

const liveThoughtMeta: NonNullable<ComponentProps<typeof ChatMarkdown>['liveThoughtMeta']> = {
	phase: 'streaming',
	elapsedSeconds: 1.2,
	streamingThinking: 'Prepare the final response.',
};

describe('ChatMarkdown live thinking status', () => {
	it('renders one tail status in live preflight instead of multiple thinking rows', () => {
		const html = renderChatMarkdown({
			content: '',
			agentUi: true,
			showAgentWorking: true,
			liveAgentBlocksState: liveBlocksWithInterleavedThinking,
			liveThoughtMeta,
			renderMode: 'preflight',
			preserveLivePreflight: true,
		});

		expect(html).toContain('ref-live-thinking-status');
		expect(html).toContain('正在思考');
		expect(html).toContain('我正在整理结果');
		expect(html).not.toContain('ref-preflight-thinking');
		expect(html).not.toContain('ref-thought-block');
		expect(html).not.toContain('Inspect the current UI state');
		expect(html).not.toContain('Prepare the final response');
	});

	it('renders the live thinking status outside the preflight shell', () => {
		const html = renderChatMarkdown({
			content: '',
			agentUi: true,
			showAgentWorking: true,
			liveThoughtMeta,
			renderMode: 'preflight',
			preserveLivePreflight: true,
		});

		expect(html).toContain('ref-live-thinking-status');
		expect(html).not.toContain('ref-preflight-shell');
		expect(html).not.toContain('ref-preflight-thinking');
	});

	it('does not render ref-thought-block for live all-mode thinking', () => {
		const html = renderChatMarkdown({
			content: '',
			agentUi: true,
			showAgentWorking: true,
			liveAgentBlocksState: liveBlocksWithInterleavedThinking,
			liveThoughtMeta,
		});

		expect(html).toContain('ref-live-thinking-status');
		expect(html).toContain('正在思考');
		expect(html).not.toContain('ref-thought-block');
		expect(html).not.toContain('Inspect the current UI state');
		expect(html).not.toContain('Prepare the final response');
	});

	it('moves the live thinking status to the outcome tail once the reply has started', () => {
		const content = [
			'先检查上下文。',
			'<tool_call tool="begin_outcome">{}</tool_call>',
			'这是正在流式输出的正式回复。',
		].join('\n');

		const preflightHtml = renderChatMarkdown({
			content,
			agentUi: true,
			showAgentWorking: true,
			liveThoughtMeta,
			renderMode: 'preflight',
			preserveLivePreflight: true,
		});
		const outcomeHtml = renderChatMarkdown({
			content,
			agentUi: true,
			showAgentWorking: true,
			liveThoughtMeta,
			renderMode: 'outcome',
			preserveLivePreflight: true,
		});

		expect(preflightHtml).not.toContain('ref-live-thinking-status');
		expect(outcomeHtml).toContain('这是正在流式输出的正式回复。');
		expect(outcomeHtml).toContain('ref-live-thinking-status');
		expect(outcomeHtml.indexOf('这是正在流式输出的正式回复。')).toBeLessThan(
			outcomeHtml.indexOf('ref-live-thinking-status')
		);
	});
});
