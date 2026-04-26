import { describe, expect, it } from 'vitest';
import {
	applyThreadRowsPreservingDetails,
	chatMessagesListEqual,
	mergeThreadDetailRows,
	threadListVersions,
	type ChatMessage,
	type ThreadInfo,
} from './threadTypes';

describe('chatMessagesListEqual skill_invoke', () => {
	it('相同 skill_invoke parts 视为相等', () => {
		const a: ChatMessage[] = [
			{
				role: 'user',
				content: './x y',
				parts: [
					{ kind: 'skill_invoke', slug: 'x', name: 'X' },
					{ kind: 'text', text: 'y' },
				],
			},
		];
		const b: ChatMessage[] = [
			{
				role: 'user',
				content: './x y',
				parts: [
					{ kind: 'skill_invoke', slug: 'x', name: 'X' },
					{ kind: 'text', text: 'y' },
				],
			},
		];
		expect(chatMessagesListEqual(a, b)).toBe(true);
	});

	it('skill slug 或 name 不同则不相等', () => {
		const base: ChatMessage = {
			role: 'user',
			content: '',
			parts: [{ kind: 'skill_invoke', slug: 'a', name: 'A' }],
		};
		expect(
			chatMessagesListEqual([base], [{ ...base, parts: [{ kind: 'skill_invoke', slug: 'b', name: 'A' }] }])
		).toBe(false);
		expect(
			chatMessagesListEqual([base], [{ ...base, parts: [{ kind: 'skill_invoke', slug: 'a', name: 'B' }] }])
		).toBe(false);
	});
});

describe('layered thread rows', () => {
	it('preserves existing summary details when a light row has the same version', () => {
		const prev: ThreadInfo[] = [
			{
				id: 't1',
				title: 'Old title',
				updatedAt: 10,
				previewCount: 2,
				hasUserMessages: true,
				hasAgentDiff: true,
				filePaths: ['src/a.ts'],
				fileCount: 1,
				subtitleFallback: 'Edited src/a.ts',
			},
		];

		const next = applyThreadRowsPreservingDetails(prev, [
			{
				id: 't1',
				title: 'New title',
				updatedAt: 10,
				previewCount: 2,
				hasUserMessages: true,
			},
		]);

		expect(next[0]).toMatchObject({
			title: 'New title',
			hasAgentDiff: true,
			filePaths: ['src/a.ts'],
			subtitleFallback: 'Edited src/a.ts',
		});
	});

	it('does not merge stale detail rows across updatedAt changes', () => {
		const prev: ThreadInfo[] = [
			{
				id: 't1',
				title: 'Current',
				updatedAt: 20,
				previewCount: 3,
				hasUserMessages: true,
			},
		];

		const next = mergeThreadDetailRows(prev, [
			{
				id: 't1',
				title: 'Stale',
				updatedAt: 10,
				previewCount: 2,
				hasUserMessages: true,
				hasAgentDiff: true,
				filePaths: ['stale.ts'],
			},
		]);

		expect(next).toBe(prev);
	});

	it('propagates isAwaitingReply from a fresh light row when updatedAt changes', () => {
		const prev: ThreadInfo[] = [
			{
				id: 't1',
				title: 'Existing',
				updatedAt: 10,
				previewCount: 2,
				hasUserMessages: true,
				isAwaitingReply: false,
				hasAgentDiff: true,
				filePaths: ['src/a.ts'],
				fileCount: 1,
				subtitleFallback: 'Edited src/a.ts',
			},
		];

		// 用户刚发出新消息：updatedAt 变更，light row 携带 isAwaitingReply=true。
		// 修复目标：必须在 light → detail 异步缝隙期间也立刻反映「正在回复」。
		const next = applyThreadRowsPreservingDetails(prev, [
			{
				id: 't1',
				title: 'Existing',
				updatedAt: 11,
				previewCount: 3,
				hasUserMessages: true,
				isAwaitingReply: true,
			},
		]);

		expect(next[0]?.isAwaitingReply).toBe(true);
		expect(next[0]?.updatedAt).toBe(11);
	});

	it('returns id and updatedAt pairs for detail hydration requests', () => {
		expect(
			threadListVersions([
				{ id: 'a', title: 'A', updatedAt: 1, previewCount: 0 },
				{ id: 'b', title: 'B', updatedAt: 2, previewCount: 1 },
			])
		).toEqual([
			{ id: 'a', updatedAt: 1 },
			{ id: 'b', updatedAt: 2 },
		]);
	});
});
