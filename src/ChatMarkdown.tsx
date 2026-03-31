import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AgentActivityGroup } from './AgentActivityGroup';
import { AgentCommandCard } from './AgentCommandCard';
import { AgentDiffCard } from './AgentDiffCard';
import { AgentEditCard } from './AgentEditCard';
import { AgentResultCard } from './AgentResultCard';
import {
	buildStreamingToolSegments,
	segmentAssistantContent,
	type AssistantSegment,
	type StreamingToolPreview,
} from './agentChatSegments';
import { useI18n } from './i18n';

/** 有 tool_input_delta 预览时，解析层也会生成 isStreaming 的 file_edit，避免与预览重复且保证预览优先显示 */
function dropParsedStreamingFileEditWhilePreview(
	segments: AssistantSegment[],
	hasPreview: boolean
): AssistantSegment[] {
	if (!hasPreview) return segments;
	return segments.filter((seg) => !(seg.type === 'file_edit' && seg.isStreaming));
}

type Props = {
	content: string;
	agentUi?: boolean;
	workspaceRoot?: string | null;
	onOpenAgentFile?: (relPath: string, revealLine?: number, revealEndLine?: number) => void;
	onRunCommand?: (cmd: string) => void;
	streamingToolPreview?: StreamingToolPreview | null;
	showAgentWorking?: boolean;
};

export function ChatMarkdown({
	content,
	agentUi = false,
	workspaceRoot,
	onOpenAgentFile,
	onRunCommand,
	streamingToolPreview,
	showAgentWorking = false,
}: Props) {
	const { t } = useI18n();
	if (!agentUi) {
		return (
			<div className="ref-md-root">
				<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
			</div>
		);
	}

	const parsedSegments = dropParsedStreamingFileEditWhilePreview(
		segmentAssistantContent(content, { t }),
		streamingToolPreview != null
	);
	const streamingSegments = buildStreamingToolSegments(streamingToolPreview, { t });
	const renderSegments: AssistantSegment[] = [...parsedSegments, ...streamingSegments];
	const hasPendingTail =
		renderSegments.some((s) => s.type === 'activity' && s.status === 'pending') ||
		streamingToolPreview != null;
	if (showAgentWorking && !hasPendingTail) {
		renderSegments.push({
			type: 'activity',
			text: t('agent.working'),
			status: 'pending',
		});
	}
	if (renderSegments.length === 0) {
		return <div className="ref-md-root ref-md-root--agent-chat" />;
	}
	if (renderSegments.length === 1 && renderSegments[0]!.type === 'markdown') {
		return (
			<div className="ref-md-root ref-md-root--agent-chat">
				<ReactMarkdown remarkPlugins={[remarkGfm]}>{renderSegments[0]!.text}</ReactMarkdown>
			</div>
		);
	}

	return (
		<div className="ref-md-root ref-md-root--agent-chat">
			{renderSegments.map((seg, i) => {
				switch (seg.type) {
					case 'markdown':
						return <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>;
					case 'diff':
						return (
							<AgentDiffCard
								key={i}
								diff={seg.diff}
								workspaceRoot={workspaceRoot}
								onOpenFile={onOpenAgentFile}
							/>
						);
					case 'command':
						return <AgentCommandCard key={i} lang={seg.lang} body={seg.body} onRun={onRunCommand ? () => onRunCommand(seg.body) : undefined} />;
					case 'file_edit':
						return (
							<AgentEditCard
								key={i}
								edit={seg}
								onOpenFile={onOpenAgentFile}
							/>
						);
				case 'activity_group':
					return (
						<AgentActivityGroup
							key={i}
							group={seg}
							onOpenFile={onOpenAgentFile}
							liveTurn={showAgentWorking}
						/>
					);
					case 'file_changes':
						return null;
					case 'activity': {
						const readLink = seg.agentReadLink;
						const openHintRaw = t('agent.activity.readOpenEditor');
						const openHint =
							openHintRaw === 'agent.activity.readOpenEditor'
								? 'Open in editor and highlight this range'
								: openHintRaw;
						return (
							<div key={i} className={`ref-agent-activity ref-agent-activity--${seg.status}`}>
								<div className="ref-agent-activity-main">
									<span className="ref-agent-activity-dot" aria-hidden />
									{readLink && onOpenAgentFile ? (
										<button
											type="button"
											className="ref-agent-activity-ref-link"
											title={openHint}
											onClick={() =>
												onOpenAgentFile(
													readLink.path,
													readLink.startLine,
													readLink.endLine
												)
											}
										>
											{seg.text}
										</button>
									) : (
										<span className="ref-agent-activity-text">{seg.text}</span>
									)}
									{seg.summary ? (
										<span className="ref-agent-activity-summary">{seg.summary}</span>
									) : null}
								</div>
								{seg.detail ? (
									<pre className="ref-agent-activity-detail">{seg.detail}</pre>
								) : null}
								{seg.resultLines && seg.resultLines.length > 0 && seg.resultKind ? (
									<AgentResultCard
										lines={seg.resultLines}
										kind={seg.resultKind}
										readSourcePath={seg.agentReadLink?.path}
										onOpenFile={onOpenAgentFile}
									/>
								) : null}
							</div>
						);
					}
					case 'tool_call':
						return (
							<p key={i} className="ref-agent-activity">
								{t('agent.toolPending', { name: seg.name })}
							</p>
						);
					case 'plan_todo':
						return (
							<div key={i} className="ref-plan-review-todos">
								<div className="ref-plan-review-todos-head">
									<span>{t('plan.review.todo', { 
										done: seg.todos.filter(t => t.status === 'completed').length, 
										total: seg.todos.length 
									})}</span>
								</div>
								<div className="ref-plan-review-todos-list">
									{seg.todos.map((todo) => {
										const done = todo.status === 'completed';
										return (
											<div key={todo.id} className={`ref-plan-todo ${done ? 'is-done' : ''}`}>
												<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
													<rect
														x="1" y="1" width="14" height="14" rx="3"
														stroke={done ? '#e8a848' : '#555'}
														strokeWidth="1.5"
														fill={done ? '#e8a848' : 'none'}
													/>
													{done ? (
														<path d="M4.5 8l2.5 2.5 4.5-5" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
													) : null}
												</svg>
												<span className="ref-plan-todo-text">{todo.content}</span>
											</div>
										);
									})}
								</div>
							</div>
						);
					default:
						return null;
				}
			})}
		</div>
	);
}
