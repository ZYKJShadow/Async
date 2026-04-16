import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runAgentLoopMock, assembleAgentToolPoolMock } = vi.hoisted(() => ({
	runAgentLoopMock: vi.fn(),
	assembleAgentToolPoolMock: vi.fn(() => []),
}));

vi.mock('./agentLoop.js', () => ({
	runAgentLoop: runAgentLoopMock,
}));

vi.mock('./agentToolPool.js', () => ({
	assembleAgentToolPool: assembleAgentToolPoolMock,
}));

import { buildReviewerTaskPacket, buildSpecialistTaskPacket, runTeamSession, type TeamTask } from './teamOrchestrator.js';
import type { TeamExpertRuntimeProfile } from './teamExpertProfiles.js';
import { executeAskPlanQuestionTool, resolvePlanQuestionTool } from './planQuestionTool.js';
import { setPlanQuestionRuntime } from './planQuestionRuntime.js';
import { executeTeamPlanDecideTool, type TeamPlanDecision } from './teamPlanDecideTool.js';
import { executeTeamEscalateToLeadTool } from './teamEscalateTool.js';
import { executeTeamPeerRequestTool } from './teamPeerRequestTool.js';
import { executeTeamReplyToPeerTool } from './teamReplyToPeerTool.js';

function makeExpert(
	id: string,
	name: string,
	roleType: TeamExpertRuntimeProfile['roleType']
): TeamExpertRuntimeProfile {
	return {
		id,
		name,
		roleType,
		assignmentKey: id,
		systemPrompt: `${name} prompt`,
	};
}

function makeExpertConfig(
	id: string,
	name: string,
	roleType: TeamExpertRuntimeProfile['roleType']
) {
	return {
		id,
		name,
		roleType,
		assignmentKey: id,
		systemPrompt: `${name} prompt`,
		enabled: true,
	};
}

function buildTeamSettings(experts: Array<ReturnType<typeof makeExpertConfig>>, overrides?: Record<string, unknown>) {
	return {
		language: 'zh-CN' as const,
		team: {
			useDefaults: false,
			experts,
			maxParallelExperts: 1,
			requirePlanApproval: false,
			enablePreflightReview: false,
			...(overrides ?? {}),
		},
	};
}

async function runSession(params: {
	userRequest: string;
	experts: Array<ReturnType<typeof makeExpertConfig>>;
	teamOverrides?: Record<string, unknown>;
}) {
	const events: Array<{ type: string; [key: string]: unknown }> = [];
	const doneCalls: Array<{ text: string; snapshot: unknown }> = [];
	const errorCalls: string[] = [];
	await runTeamSession({
		settings: buildTeamSettings(params.experts, params.teamOverrides) as never,
		threadId: 'thread-test',
		messages: [{ role: 'user', content: params.userRequest }] as never,
		modelSelection: 'test-model',
		resolvedModel: {
			ok: true,
			requestModelId: 'test-model',
			paradigm: 'openai-compatible',
			apiKey: 'test-key',
			baseURL: 'https://example.test',
			proxyUrl: undefined,
			maxOutputTokens: 2048,
		},
		signal: new AbortController().signal,
		emit: (evt) => events.push(evt as never),
		onDone: (text, _usage, snapshot) => doneCalls.push({ text, snapshot }),
		onError: (message) => errorCalls.push(message),
	});
	return { events, doneCalls, errorCalls };
}

async function submitTeamPlanDecision(
	handlers: {
		onToolResult: (name: string, result: string, success: boolean, toolCallId: string) => void;
		onDone: (text: string) => void;
	},
	decision: TeamPlanDecision,
	narrative?: string
) {
	const toolCallId = `team-plan-${decision.mode.toLowerCase()}`;
	const result = await executeTeamPlanDecideTool({
		id: toolCallId,
		name: 'team_plan_decide',
		arguments: decision as unknown as Record<string, unknown>,
	}, 'team-lead');
	handlers.onToolResult('team_plan_decide', String(result.content ?? ''), !result.isError, toolCallId);
	handlers.onDone(narrative ?? decision.replyToUser ?? '');
}

async function submitTeamEscalation(
	taskId: string,
	handlers: {
		onToolResult: (name: string, result: string, success: boolean, toolCallId: string) => void;
	},
	escalation: {
		reason: string;
		proposedChange: string;
		blockingEvidence?: string[];
	}
) {
	const toolCallId = 'team-escalation';
	const result = await executeTeamEscalateToLeadTool(
		{
			id: toolCallId,
			name: 'team_escalate_to_lead',
			arguments: escalation as Record<string, unknown>,
		},
		taskId
	);
	handlers.onToolResult('team_escalate_to_lead', String(result.content ?? ''), !result.isError, toolCallId);
}

beforeEach(() => {
	vi.clearAllMocks();
	assembleAgentToolPoolMock.mockReturnValue([]);
	setPlanQuestionRuntime(null);
});

afterEach(() => {
	setPlanQuestionRuntime(null);
});

describe('buildSpecialistTaskPacket', () => {
	it('includes dependency handoffs instead of requiring the full transcript', () => {
		const expert = makeExpert('backend_worker', 'Backend Worker', 'backend');
		const dependency: TeamTask = {
			id: 'task-a',
			expertId: 'frontend_worker',
			expertAssignmentKey: 'frontend_worker',
			expertName: 'Frontend Worker',
			roleType: 'frontend',
			description: 'Implement the UI flow',
			status: 'completed',
			dependencies: [],
			acceptanceCriteria: ['UI compiles'],
			result: 'Updated the form fields and submit button states.',
		};
		const task: TeamTask = {
			id: 'task-b',
			expertId: expert.id,
			expertAssignmentKey: expert.assignmentKey,
			expertName: expert.name,
			roleType: expert.roleType,
			description: 'Wire the new API endpoint to the updated form.',
			status: 'pending',
			dependencies: [dependency.id],
			acceptanceCriteria: ['Request payload matches backend schema'],
		};

		const packet = buildSpecialistTaskPacket({
			task,
			expert,
			userRequest: 'Add a profile editor with autosave.',
			planSummary: 'Frontend updates the form first, then backend wires autosave support.',
			completedTasksById: new Map([[dependency.id, dependency]]),
		});

		expect(packet).toContain('focused assignment packet');
		expect(packet).toContain('## Original User Request');
		expect(packet).toContain('Add a profile editor with autosave.');
		expect(packet).toContain('## Dependency Handoffs');
		expect(packet).toContain('Frontend Worker');
		expect(packet).toContain('Updated the form fields and submit button states.');
		expect(packet).toContain('Request payload matches backend schema');
	});
});

describe('buildReviewerTaskPacket', () => {
	it('summarizes specialist outputs for review', () => {
		const reviewer = makeExpert('reviewer', 'Reviewer', 'reviewer');
		const completedTasks: TeamTask[] = [
			{
				id: 'task-a',
				expertId: 'writer',
				expertAssignmentKey: 'writer',
				expertName: 'Writer',
				roleType: 'custom',
				description: 'Document the new autosave behavior.',
				status: 'completed',
				dependencies: [],
				acceptanceCriteria: ['Docs mention failure recovery'],
				result: 'Added docs for autosave retries and offline recovery.',
			},
		];

		const packet = buildReviewerTaskPacket({
			reviewer,
			userRequest: 'Ship autosave and update the docs.',
			planSummary: 'Coder implements autosave, writer documents it, reviewer checks both.',
			completedTasks,
		});

		expect(packet).toContain('You are Reviewer, the reviewer for this team workflow.');
		expect(packet).toContain('## Specialist Outputs');
		expect(packet).toContain('Writer');
		expect(packet).toContain('Added docs for autosave retries and offline recovery.');
		expect(packet).toContain('### Verdict: APPROVED');
		expect(packet).toContain('### Verdict: NEEDS_REVISION');
	});
});

describe('runTeamSession clarification gates', () => {
	it('stops immediately when the lead returns CLARIFY', async () => {
		runAgentLoopMock.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
			await submitTeamPlanDecision(handlers, {
				mode: 'CLARIFY',
				tasks: [],
				replyToUser: '请先明确你要优化的是性能、代码质量还是用户体验，以及对应的模块范围。',
			});
		});

		const experts = [
			makeExpertConfig('team_lead', 'Team Lead', 'team_lead'),
			makeExpertConfig('frontend', 'Frontend', 'frontend'),
		];
		const { events, doneCalls, errorCalls } = await runSession({
			userRequest: '请你看看接下来如何优化我的项目',
			experts,
		});

		expect(errorCalls).toEqual([]);
		expect(doneCalls).toHaveLength(1);
		expect(doneCalls[0]?.text).toContain('请先明确你要优化的是性能、代码质量还是用户体验');
		expect(events.some((evt) => evt.type === 'team_task_created')).toBe(false);
		expect(events.some((evt) => evt.type === 'team_preflight_review')).toBe(false);
	});

	it('offers ask_plan_question to the team lead during planning', async () => {
		runAgentLoopMock.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
			handlers.onDone('请先明确优化目标。');
		});

		const experts = [
			makeExpertConfig('team_lead', 'Team Lead', 'team_lead'),
			makeExpertConfig('frontend', 'Frontend', 'frontend'),
		];
		await runSession({
			userRequest: '请你看看接下来如何优化我的项目',
			experts,
		});

		const options = runAgentLoopMock.mock.calls[0]?.[2] as { toolPoolOverride?: Array<{ name: string }> } | undefined;
		expect(options?.toolPoolOverride?.map((tool) => tool.name)).toEqual([
			'ask_plan_question',
			'request_user_input',
			'team_plan_decide',
		]);
	});

	it('propagates ask_plan_question answers into downstream team context', async () => {
		const questionEvents: Array<Record<string, unknown>> = [];
		setPlanQuestionRuntime({
			threadId: 'thread-test',
			signal: new AbortController().signal,
			emit: (evt) => {
				questionEvents.push(evt);
				if (evt.type === 'plan_question_request') {
					queueMicrotask(() => {
						resolvePlanQuestionTool(String(evt.requestId), {
							answerText: '我选择：quality. 代码质量与架构',
						});
					});
				}
			},
		});

		let specialistPacketText = '';
		runAgentLoopMock
			.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
				const answer = await executeAskPlanQuestionTool({
					id: 'lead-q1',
					name: 'ask_plan_question',
					arguments: {
						question: '你想优先从哪个方向优化这个项目？我会根据你的选择重新分配团队专家。',
						options: [
							{ id: 'performance', label: '性能与响应速度（启动、渲染、接口耗时）' },
							{ id: 'quality', label: '代码质量与架构（可维护性、模块边界、技术债）' },
							{ id: 'ux', label: '用户体验与产品流程（交互、设置、Team 模式体验）' },
							{ id: 'custom', label: '其他（请填写）' },
						],
					},
				});
				expect(answer.isError).toBe(false);
				handlers.onToolResult('ask_plan_question', String(answer.content ?? ''), true, 'lead-q1');
				await submitTeamPlanDecision(
					handlers,
					{
						mode: 'PLAN',
						tasks: [
							{
								expert: 'frontend',
								task: 'Review frontend architecture and identify maintainability improvements',
								acceptanceCriteria: ['List actionable quality improvements'],
							},
						],
					},
					'我会按你选择的代码质量方向分配专家。'
				);
			})
			.mockImplementationOnce(async (_settings, messagesArg, _options, handlers) => {
				specialistPacketText = messagesArg.map((message) => String(message.content ?? '')).join('\n');
				handlers.onDone('已完成前端质量审查。');
			});

		const experts = [
			makeExpertConfig('team_lead', 'Team Lead', 'team_lead'),
			makeExpertConfig('frontend', 'Frontend', 'frontend'),
		];
		const { events, doneCalls, errorCalls } = await runSession({
			userRequest: '请你看看接下来如何优化我的项目',
			experts,
		});

		expect(errorCalls).toEqual([]);
		expect(questionEvents).toHaveLength(1);
		expect(questionEvents[0]).toMatchObject({
			type: 'plan_question_request',
			question: expect.objectContaining({
				text: expect.stringContaining('你想优先从哪个方向优化这个项目'),
			}),
		});
		expect(specialistPacketText).toContain('[TEAM CLARIFICATION ANSWER]');
		expect(specialistPacketText).toContain('代码质量与架构');
		expect(events.some((evt) => evt.type === 'team_task_created')).toBe(true);
		expect(doneCalls).toHaveLength(1);
		expect(doneCalls[0]?.text).not.toContain('MODE:');
	});

	it('falls back to a freeform clarification dialog when the lead returns CLARIFY without using the tool', async () => {
		const questionEvents: Array<Record<string, unknown>> = [];
		setPlanQuestionRuntime({
			threadId: 'thread-test',
			signal: new AbortController().signal,
			emit: (evt) => {
				questionEvents.push(evt);
				if (evt.type === 'plan_question_request') {
					queueMicrotask(() => {
						resolvePlanQuestionTool(String(evt.requestId), {
							answerText: '请先聚焦聊天区里 team 模式的渲染顺序问题。',
						});
					});
				}
			},
		});

		let secondTurnMessages = '';
		runAgentLoopMock
			.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
				handlers.onDone('请先明确你要优化的是哪个模块，以及你希望达成的结果。');
			})
			.mockImplementationOnce(async (_settings, messagesArg, _options, handlers) => {
				secondTurnMessages = messagesArg.map((message) => String(message.content ?? '')).join('\n');
				await submitTeamPlanDecision(
					handlers,
					{
						mode: 'PLAN',
						tasks: [
							{
								expert: 'frontend',
								task: 'Audit the team chat timeline rendering order',
								acceptanceCriteria: ['Explain why the cards are ordered incorrectly'],
							},
						],
					},
					'我会围绕聊天区 team 模式来分配专家。'
				);
			})
			.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
				handlers.onDone('已完成聊天区 team 时间线审查。');
			});

		const experts = [
			makeExpertConfig('team_lead', 'Team Lead', 'team_lead'),
			makeExpertConfig('frontend', 'Frontend', 'frontend'),
		];
		const { doneCalls, errorCalls } = await runSession({
			userRequest: '请帮我看看这个项目接下来怎么优化',
			experts,
		});

		expect(errorCalls).toEqual([]);
		expect(questionEvents).toHaveLength(1);
		expect(questionEvents[0]).toMatchObject({
			type: 'plan_question_request',
			question: expect.objectContaining({
				freeform: true,
				text: expect.stringContaining('请先明确'),
			}),
		});
		expect(secondTurnMessages).toContain('[TEAM CLARIFICATION ANSWER]');
		expect(secondTurnMessages).toContain('聊天区里 team 模式的渲染顺序问题');
		expect(doneCalls).toHaveLength(1);
		expect(doneCalls[0]?.text).not.toContain('MODE:');
	});

	it('unwraps structured lead output before opening the fallback clarification dialog', async () => {
		const questionEvents: Array<Record<string, unknown>> = [];
		setPlanQuestionRuntime({
			threadId: 'thread-test',
			signal: new AbortController().signal,
			emit: (evt) => {
				questionEvents.push(evt);
				if (evt.type === 'plan_question_request') {
					queueMicrotask(() => {
						resolvePlanQuestionTool(String(evt.requestId), {
							answerText: '请聚焦 team leader 的澄清交互。',
						});
					});
				}
			},
		});

		runAgentLoopMock
			.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
				handlers.onDone(
					JSON.stringify({
						_asyncAssistant: 1,
					v: 1,
					parts: [
						{
							type: 'text',
							text: '请先明确你想优化的是 team 模式里的哪个问题。',
						},
					],
				})
			);
			})
			.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
				await submitTeamPlanDecision(
					handlers,
					{
						mode: 'PLAN',
						tasks: [
							{
								expert: 'frontend',
								task: 'Audit the team-mode clarify UI path',
								acceptanceCriteria: ['Explain why raw structured payload leaked into the dialog'],
							},
						],
					},
					'我会围绕 team 模式问题分配专家。'
				);
			})
			.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
				handlers.onDone('已完成 team 模式澄清链路审查。');
			});

		const experts = [
			makeExpertConfig('team_lead', 'Team Lead', 'team_lead'),
			makeExpertConfig('frontend', 'Frontend', 'frontend'),
		];
		const { errorCalls } = await runSession({
			userRequest: '请帮我看看 team 模式应该怎么优化',
			experts,
		});

		expect(errorCalls).toEqual([]);
		expect(questionEvents).toHaveLength(1);
		expect(questionEvents[0]).toMatchObject({
			type: 'plan_question_request',
			question: expect.objectContaining({
				text: '请先明确你想优化的是 team 模式里的哪个问题。',
				freeform: true,
			}),
		});
	});

	it('hard-stops when preflight review needs clarification even without plan approval', async () => {
		runAgentLoopMock
			.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
				await submitTeamPlanDecision(
					handlers,
					{
						mode: 'PLAN',
						tasks: [
							{
								expert: 'frontend',
								task: 'Audit renderer hotspots',
								acceptanceCriteria: ['List the top bottlenecks'],
							},
						],
					},
					'我先整理一个执行方案。'
				);
			})
			.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
				handlers.onDone(`### Verdict: NEEDS_CLARIFICATION
### Concerns
- 当前只说“优化项目”，没有说明目标维度和范围。
### Suggestions
- 先明确是性能、代码质量还是体验问题。
### Summary
当前需求仍然过于模糊，请先明确优化目标和范围。`);
			});

		const experts = [
			makeExpertConfig('team_lead', 'Team Lead', 'team_lead'),
			makeExpertConfig('frontend', 'Frontend', 'frontend'),
			makeExpertConfig('reviewer', 'Reviewer', 'reviewer'),
		];
		const { events, doneCalls, errorCalls } = await runSession({
			userRequest: '请你看看接下来如何优化我的项目',
			experts,
			teamOverrides: { enablePreflightReview: true, requirePlanApproval: false },
		});

		expect(errorCalls).toEqual([]);
		expect(doneCalls).toHaveLength(1);
		expect(doneCalls[0]?.text).toContain('当前需求仍然过于模糊，请先明确优化目标和范围');
		expect(events.some((evt) => evt.type === 'team_task_created')).toBe(false);
		expect(events).toContainEqual(
			expect.objectContaining({
				type: 'team_preflight_review',
				verdict: 'needs_clarification',
			})
		);
	});

	it('does not auto-fan out vague requests through fallback routing', async () => {
		runAgentLoopMock.mockRejectedValueOnce(new Error('planner failed'));

		const experts = [
			makeExpertConfig('team_lead', 'Team Lead', 'team_lead'),
			makeExpertConfig('frontend', 'Frontend', 'frontend'),
			makeExpertConfig('backend', 'Backend', 'backend'),
			makeExpertConfig('qa', 'QA', 'qa'),
		];
		const { events, doneCalls, errorCalls } = await runSession({
			userRequest: '请你看看接下来如何优化我的项目',
			experts,
		});

		expect(errorCalls).toEqual([]);
		expect(doneCalls).toHaveLength(1);
		expect(doneCalls[0]?.text).toContain('当前需求还不够具体，我先不分派专家');
		expect(events.some((evt) => evt.type === 'team_task_created')).toBe(false);
	});

	it('replans remaining work after a specialist escalates to the planner', async () => {
		runAgentLoopMock
			.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
				await submitTeamPlanDecision(
					handlers,
					{
						mode: 'PLAN',
						tasks: [
							{
								expert: 'backend',
								task: 'Modify the missing foo service directly',
								acceptanceCriteria: ['Update the foo service implementation'],
							},
						],
					},
					'我先让后端同学处理这个问题。'
				);
			})
			.mockImplementationOnce(async (_settings, _messages, optionsArg, handlers) => {
				const specialistOptions = optionsArg as { teamToolRoleScope?: { teamTaskId: string } };
				await submitTeamEscalation(specialistOptions.teamToolRoleScope?.teamTaskId ?? '', handlers, {
					reason: 'The planned foo service does not exist in the repository.',
					proposedChange: 'Replan the task around the actual renderer-side workflow instead of editing a missing backend service.',
					blockingEvidence: ['No symbol named foo service was found.'],
				});
			})
			.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
				await submitTeamPlanDecision(
					handlers,
					{
						mode: 'PLAN',
						tasks: [
							{
								expert: 'frontend',
								task: 'Inspect the renderer workflow that actually owns this behavior',
								acceptanceCriteria: ['Identify the real code path to change'],
							},
						],
					},
					'后端同学发现前提有误，我改成重新分派前端链路检查。'
				);
			})
			.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
				handlers.onDone('已完成修订后的前端链路审查。');
			});

		const experts = [
			makeExpertConfig('team_lead', 'Team Lead', 'team_lead'),
			makeExpertConfig('frontend', 'Frontend', 'frontend'),
			makeExpertConfig('backend', 'Backend', 'backend'),
		];
		const { events, doneCalls, errorCalls } = await runSession({
			userRequest: '请帮我修一下 team 模式的错误假设分派',
			experts,
		});

		expect(errorCalls).toEqual([]);
		expect(events).toContainEqual(
			expect.objectContaining({
				type: 'team_plan_revised',
				reason: 'The planned foo service does not exist in the repository.',
			})
		);
		expect(doneCalls).toHaveLength(1);
		expect(doneCalls[0]?.text).toContain('已完成修订后的前端链路审查。');
	});

	it('lets a running specialist reply to peer requests before finishing', async () => {
		let releaseFrontendRound: (() => void) | null = null;
		const frontendReady = new Promise<void>((resolve) => {
			releaseFrontendRound = resolve;
		});
		let backendResultText = '';

		runAgentLoopMock
			.mockImplementationOnce(async (_settings, _messages, _options, handlers) => {
				await submitTeamPlanDecision(
					handlers,
					{
						mode: 'PLAN',
						tasks: [
							{
								expert: 'frontend',
								task: 'Inspect the renderer flow and keep notes available for peers',
								acceptanceCriteria: ['Understand the renderer ownership boundary'],
							},
							{
								expert: 'backend',
								task: 'Wire the follow-up fix after confirming the renderer contract',
								acceptanceCriteria: ['Use the renderer contract without guessing'],
							},
						],
					},
					'我会并行安排前后端协作。'
				);
			})
			.mockImplementationOnce(async (_settings, _messages, optionsArg, handlers) => {
				const specialistOptions = optionsArg as {
					teamToolRoleScope?: { teamTaskId: string };
					beforeRoundMessages?: () => Promise<Array<{ role: string; content: string }>>;
				};
				await frontendReady;
				const injected = await specialistOptions.beforeRoundMessages?.();
				const peerMessage = injected?.[0]?.content ?? '';
				const requestIdMatch = /### Request ([^\n]+)/.exec(peerMessage);
				expect(peerMessage).toContain('Question: Which renderer state owns this workflow?');
				expect(requestIdMatch?.[1]).toBeTruthy();

				const reply = await executeTeamReplyToPeerTool(
					{
						id: 'peer-reply',
						name: 'team_reply_to_peer',
						arguments: {
							requestId: requestIdMatch?.[1],
							answer: 'The renderer-side workflow owns it; do not invent a backend-only contract.',
						},
					},
					specialistOptions.teamToolRoleScope?.teamTaskId
				);
				handlers.onToolResult('team_reply_to_peer', String(reply.content ?? ''), !reply.isError, 'peer-reply');
				handlers.onDone('前端已响应 peer，并完成当前调研。');
			})
			.mockImplementationOnce(async (_settings, _messages, optionsArg, handlers) => {
				const specialistOptions = optionsArg as { teamToolRoleScope?: { teamTaskId: string } };
				const answerPromise = executeTeamPeerRequestTool(
					{
						id: 'peer-request',
						name: 'team_request_from_peer',
						arguments: {
							targetExpertId: 'frontend',
							question: 'Which renderer state owns this workflow?',
						},
					},
					specialistOptions.teamToolRoleScope?.teamTaskId
				);
				releaseFrontendRound?.();
				const answer = await answerPromise;
				backendResultText = String(answer.content ?? '');
				handlers.onToolResult('team_request_from_peer', backendResultText, !answer.isError, 'peer-request');
				handlers.onDone(`后端拿到 peer 回复：${backendResultText}`);
			});

		const experts = [
			makeExpertConfig('team_lead', 'Team Lead', 'team_lead'),
			makeExpertConfig('frontend', 'Frontend', 'frontend'),
			makeExpertConfig('backend', 'Backend', 'backend'),
		];
		const { doneCalls, errorCalls } = await runSession({
			userRequest: '请让前后端并行协作修复 team 模式的契约分歧',
			experts,
			teamOverrides: { maxParallelExperts: 2 },
		});

		expect(errorCalls).toEqual([]);
		expect(backendResultText).toContain('renderer-side workflow owns it');
		expect(doneCalls).toHaveLength(1);
		expect(doneCalls[0]?.text).toContain('后端拿到 peer 回复');
	});
});
