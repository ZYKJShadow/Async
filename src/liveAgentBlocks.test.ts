import { describe, expect, it } from 'vitest';
import {
	applyLiveAgentChatPayload,
	createEmptyLiveAgentBlocks,
	liveBlocksToAssistantSegments,
} from './liveAgentBlocks';
import { defaultT } from './i18n';

describe('liveAgentBlocks', () => {
	it('folds deltas and tool_input_delta into blocks', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, { type: 'delta', text: 'Hi ' });
		st = applyLiveAgentChatPayload(st, { type: 'delta', text: 'there' });
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_input_delta',
			name: 'read_file',
			partialJson: '{"path":"a.ts"',
			index: 0,
		});
		expect(st.blocks.filter((b) => b.type === 'text')).toHaveLength(1);
		const txt = st.blocks.find((b) => b.type === 'text');
		expect(txt && txt.type === 'text' && txt.text).toBe('Hi there');
		const tool = st.blocks.find((b) => b.type === 'tool');
		expect(tool && tool.type === 'tool' && tool.phase).toBe('streaming_args');
	});

	it('liveBlocksToAssistantSegments merges tool preview without double activity', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_input_delta',
			name: 'write_to_file',
			partialJson: '{"path":"x.txt","content":"ab',
			index: 0,
		});
		const segs = liveBlocksToAssistantSegments(st.blocks, defaultT);
		const activities = segs.filter((s) => s.type === 'activity');
		const edits = segs.filter((s) => s.type === 'file_edit');
		expect(activities.length).toBeGreaterThanOrEqual(1);
		expect(edits.length).toBeGreaterThanOrEqual(1);
	});

	it('pairs tool_call and tool_result by toolCallId', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_input_delta',
			name: 'read_file',
			partialJson: '{}',
			index: 0,
		});
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_call',
			name: 'read_file',
			args: '{"path":"p"}',
			toolCallId: 'call-1',
		});
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_result',
			name: 'read_file',
			result: 'ok',
			success: true,
			toolCallId: 'call-1',
		});
		const tools = st.blocks.filter((b) => b.type === 'tool');
		const done = tools.filter((b) => b.type === 'tool' && b.phase === 'done');
		expect(done).toHaveLength(1);
	});

	it('keeps root thinking inline in the live segment order', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, { type: 'thinking_delta', text: 'Planning edits' });
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_progress',
			name: 'search_files',
			phase: 'executing',
		});
		st = applyLiveAgentChatPayload(st, { type: 'delta', text: 'Done.' });
		const segs = liveBlocksToAssistantSegments(st.blocks, defaultT);
		expect(segs[0]?.type).toBe('thinking');
		expect(segs[1]?.type).toBe('activity');
		expect(segs[2]?.type).toBe('markdown');
	});

	it('splits long root thinking into stable chunks', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, {
			type: 'thinking_delta',
			text: 'First idea is to inspect the search path.\n\nThen compare the edit flow with the current renderer.',
		});
		const thinkingBlocks = st.blocks.filter((b) => b.type === 'thinking');
		expect(thinkingBlocks.length).toBeGreaterThanOrEqual(2);
		const segs = liveBlocksToAssistantSegments(st.blocks, defaultT);
		const thinkingSegs = segs.filter((s) => s.type === 'thinking');
		expect(thinkingSegs.length).toBeGreaterThanOrEqual(2);
	});
});
