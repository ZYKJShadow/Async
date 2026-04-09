import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	applyLiveAgentChatPayload,
	createEmptyLiveAgentBlocks,
	extractTodosFromLiveBlocks,
	liveBlocksToAssistantSegments,
} from './liveAgentBlocks';
import { defaultT } from './i18n';

describe('liveAgentBlocks', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('extractTodosFromLiveBlocks ignores TodoWrite streaming_args partialJson', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_input_delta',
			name: 'TodoWrite',
			partialJson: '{"todos":[{"content":"A","status":"completed"},{"content":"B","status":"completed"}]}',
			index: 0,
		});
		expect(extractTodosFromLiveBlocks(st.blocks)).toBeNull();
	});

	it('extractTodosFromLiveBlocks uses args after tool_call for TodoWrite', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_input_delta',
			name: 'TodoWrite',
			partialJson: '{"todos":[{"content":"A","status":"completed"}]}',
			index: 0,
		});
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_call',
			name: 'TodoWrite',
			args: '{"todos":[{"content":"A","status":"pending"},{"content":"B","status":"in_progress"}]}',
			toolCallId: 'call-tw-1',
		});
		const todos = extractTodosFromLiveBlocks(st.blocks);
		expect(todos).not.toBeNull();
		expect(todos!.map((x) => x.status)).toEqual(['pending', 'in_progress']);
	});

	it('liveBlocksToAssistantSegments shows pending activity for TodoWrite streaming_args, not plan_todo', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_input_delta',
			name: 'TodoWrite',
			partialJson: '{"todos":[{"content":"X","status":"completed"}]}',
			index: 0,
		});
		const segs = liveBlocksToAssistantSegments(st.blocks, defaultT);
		expect(segs.some((s) => s.type === 'plan_todo')).toBe(false);
		const act = segs.filter((s) => s.type === 'activity');
		expect(act.length).toBeGreaterThanOrEqual(1);
		expect(act[0] && act[0].type === 'activity' && act[0].status).toBe('pending');
	});

	it('folds deltas and tool_input_delta into blocks', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, { type: 'delta', text: 'Hi ' });
		st = applyLiveAgentChatPayload(st, { type: 'delta', text: 'there' });
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_input_delta',
			name: 'Read',
			partialJson: '{"file_path":"a.ts"',
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
			name: 'Write',
			partialJson: '{"file_path":"x.txt","content":"ab',
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
			name: 'Read',
			partialJson: '{}',
			index: 0,
		});
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_call',
			name: 'Read',
			args: '{"file_path":"p"}',
			toolCallId: 'call-1',
		});
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_result',
			name: 'Read',
			result: 'ok',
			success: true,
			toolCallId: 'call-1',
		});
		const tools = st.blocks.filter((b) => b.type === 'tool');
		const done = tools.filter((b) => b.type === 'tool' && b.phase === 'done');
		expect(done).toHaveLength(1);
	});

	it('deduplicates duplicate tool_call after tool_result and preserves done order', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_call',
			name: 'Bash',
			args: '{"command":"npm test"}',
			toolCallId: 'call-cmd-1',
		});
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_result',
			name: 'Bash',
			result: 'ok',
			success: true,
			toolCallId: 'call-cmd-1',
		});
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_call',
			name: 'Bash',
			args: '{"command":"npm test"}',
			toolCallId: 'call-cmd-1',
		});
		const tools = st.blocks.filter((b) => b.type === 'tool');
		expect(tools).toHaveLength(1);
		expect(tools[0] && tools[0].type === 'tool' && tools[0].phase).toBe('done');
	});

	it('reconciles late tool_call into an orphan result by toolCallId', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_result',
			name: 'Bash',
			result: 'ok',
			success: true,
			toolCallId: 'call-cmd-2',
		});
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_call',
			name: 'Bash',
			args: '{"command":"npm test"}',
			toolCallId: 'call-cmd-2',
		});
		const tools = st.blocks.filter((b) => b.type === 'tool');
		expect(tools).toHaveLength(1);
		expect(tools[0] && tools[0].type === 'tool' && tools[0].phase).toBe('done');
		expect(tools[0] && tools[0].type === 'tool' && tools[0].argsJson).toBe('{"command":"npm test"}');
	});

	it('deduplicates duplicate tool_result by toolCallId', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_call',
			name: 'Read',
			args: '{"file_path":"p"}',
			toolCallId: 'call-read-1',
		});
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_result',
			name: 'Read',
			result: 'ok',
			success: true,
			toolCallId: 'call-read-1',
		});
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_result',
			name: 'Read',
			result: 'ok',
			success: true,
			toolCallId: 'call-read-1',
		});
		const tools = st.blocks.filter((b) => b.type === 'tool');
		expect(tools).toHaveLength(1);
		expect(tools[0] && tools[0].type === 'tool' && tools[0].phase).toBe('done');
	});

	it('keeps root thinking inline in the live segment order', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, { type: 'thinking_delta', text: 'Planning edits' });
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_progress',
			name: 'Grep',
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

	it('coalesces root text across interleaved thinking_delta (smooth stream / one markdown body)', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, { type: 'delta', text: 'H' });
		st = applyLiveAgentChatPayload(st, { type: 'thinking_delta', text: 't' });
		st = applyLiveAgentChatPayload(st, { type: 'delta', text: 'i' });
		const texts = st.blocks.filter((b) => b.type === 'text');
		expect(texts).toHaveLength(1);
		expect(texts[0] && texts[0].type === 'text' && texts[0].text).toBe('Hi');
		const mdSegs = liveBlocksToAssistantSegments(st.blocks, defaultT).filter((s) => s.type === 'markdown');
		expect(mdSegs).toHaveLength(1);
	});

	it('does not merge root text across tool blocks after thinking', () => {
		let st = createEmptyLiveAgentBlocks();
		st = applyLiveAgentChatPayload(st, { type: 'delta', text: 'A' });
		st = applyLiveAgentChatPayload(st, { type: 'thinking_delta', text: '…' });
		st = applyLiveAgentChatPayload(st, {
			type: 'tool_input_delta',
			name: 'Read',
			partialJson: '{}',
			index: 0,
		});
		st = applyLiveAgentChatPayload(st, { type: 'delta', text: 'B' });
		const texts = st.blocks.filter((b) => b.type === 'text');
		expect(texts).toHaveLength(2);
		expect(texts[0] && texts[0].type === 'text' && texts[0].text).toBe('A');
		expect(texts[1] && texts[1].type === 'text' && texts[1].text).toBe('B');
	});

	it('closes each root thinking block with its own timing once later output starts', () => {
		vi.useFakeTimers();

		let st = createEmptyLiveAgentBlocks();
		vi.setSystemTime(new Date('2026-04-05T12:00:00.000Z'));
		st = applyLiveAgentChatPayload(st, { type: 'thinking_delta', text: 'Inspect state' });

		vi.setSystemTime(new Date('2026-04-05T12:00:02.000Z'));
		st = applyLiveAgentChatPayload(st, { type: 'tool_progress', name: 'Grep', phase: 'executing' });

		vi.setSystemTime(new Date('2026-04-05T12:00:05.000Z'));
		st = applyLiveAgentChatPayload(st, { type: 'thinking_delta', text: 'Prepare patch' });

		vi.setSystemTime(new Date('2026-04-05T12:00:09.000Z'));
		st = applyLiveAgentChatPayload(st, { type: 'delta', text: 'Done.' });

		const segs = liveBlocksToAssistantSegments(st.blocks, defaultT);
		const thinkingSegs = segs.filter((s) => s.type === 'thinking');
		expect(thinkingSegs).toHaveLength(2);
		expect(thinkingSegs[0] && thinkingSegs[0].type === 'thinking' && thinkingSegs[0].startedAt).toBe(
			Date.parse('2026-04-05T12:00:00.000Z')
		);
		expect(thinkingSegs[0] && thinkingSegs[0].type === 'thinking' && thinkingSegs[0].endedAt).toBe(
			Date.parse('2026-04-05T12:00:02.000Z')
		);
		expect(thinkingSegs[1] && thinkingSegs[1].type === 'thinking' && thinkingSegs[1].startedAt).toBe(
			Date.parse('2026-04-05T12:00:05.000Z')
		);
		expect(thinkingSegs[1] && thinkingSegs[1].type === 'thinking' && thinkingSegs[1].endedAt).toBe(
			Date.parse('2026-04-05T12:00:09.000Z')
		);
	});
});
