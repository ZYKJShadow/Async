import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AgentLoopOptions } from './agentLoop.js';
import {
	clearManagedAgentsForThread,
	closeManagedAgent,
	closeManagedAgentsForThread,
	getManagedAgentSession,
	spawnManagedAgent,
} from './managedSubagents.js';

const baseOptions = {
	requestModelId: 'test-model',
	paradigm: 'openai-compatible',
	requestApiKey: '',
	maxOutputTokens: 1024,
	composerMode: 'agent',
} satisfies Omit<AgentLoopOptions, 'signal'>;

describe('managed sub-agent snapshots', () => {
	it('creates snapshots without recursively rebuilding child snapshots', () => {
		const threadId = `managed-subagents-${randomUUID()}`;
		const parent = spawnManagedAgent({
			threadId,
			parentToolCallId: 'tool-parent',
			task: 'Parent task',
			context: '',
			background: true,
			settings: {},
			options: baseOptions,
		});
		const child = spawnManagedAgent({
			threadId,
			parentToolCallId: 'tool-child',
			parentAgentId: parent.agentId,
			task: 'Child task',
			context: '',
			background: true,
			settings: {},
			options: baseOptions,
		});

		const session = getManagedAgentSession(threadId);

		expect(session?.agents[parent.agentId]?.childAgentIds).toEqual([child.agentId]);
		expect(session?.agents[child.agentId]?.childAgentIds).toEqual([]);

		closeManagedAgent({ threadId, agentId: parent.agentId });
	});

	it('closes active child agents for a whole thread', () => {
		const threadId = `managed-subagents-close-thread-${randomUUID()}`;
		const parent = spawnManagedAgent({
			threadId,
			parentToolCallId: 'tool-parent-close',
			task: 'Parent task',
			context: '',
			background: true,
			settings: {},
			options: baseOptions,
		});
		const child = spawnManagedAgent({
			threadId,
			parentToolCallId: 'tool-child-close',
			parentAgentId: parent.agentId,
			task: 'Child task',
			context: '',
			background: true,
			settings: {},
			options: baseOptions,
		});

		closeManagedAgentsForThread({ threadId });
		const session = getManagedAgentSession(threadId);

		expect(session?.agents[parent.agentId]?.status).toBe('closed');
		expect(session?.agents[child.agentId]?.status).toBe('closed');
	});

	it('clears thread agent cards after an edited resend', () => {
		const threadId = `managed-subagents-clear-thread-${randomUUID()}`;
		const emittedSessions: unknown[] = [];
		const agent = spawnManagedAgent({
			threadId,
			parentToolCallId: 'tool-clear',
			task: 'Old task',
			context: '',
			background: true,
			settings: {},
			options: baseOptions,
			emit: (evt) => {
				if (evt.type === 'agent_session_sync') {
					emittedSessions.push(evt.session);
				}
			},
		});

		expect(getManagedAgentSession(threadId)?.agents[agent.agentId]).toBeTruthy();

		clearManagedAgentsForThread({
			threadId,
			emit: (evt) => {
				if (evt.type === 'agent_session_sync') {
					emittedSessions.push(evt.session);
				}
			},
		});
		const session = emittedSessions[emittedSessions.length - 1] as
			| { agents?: unknown; pendingUserInput?: unknown }
			| undefined;

		expect(session?.agents).toEqual({});
		expect(session?.pendingUserInput).toBeNull();
	});
});
