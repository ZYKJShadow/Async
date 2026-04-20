/**
 * 附着在 ChatComposer 上方的 TODO 浮动面板。
 *
 * 布局模式由父组件在「即将展开」那一刻按当时的贴底状态锁定，展开期间不再随滚动切换：
 * - `pushup`：list 进入正常文档流，与 head 一起占据 commandStack 内布局，
 *   迫使上方 .ref-messages 区域变小；配合外层粘底逻辑，视觉表现为「消息被向上顶」。
 * - `overlay`：list 通过 absolute 定位浮在 head 之上，不占布局空间，与消息流完全解耦。
 *
 * 折叠态只显示 head，layoutMode 仅在展开时生效（list 不渲染时无视觉影响）。
 *
 * 数据由 AgentChatPanel 提供：合并 live blocks（流式中）与最近一条 assistant 消息中的
 * TodoWrite tool_call，得到「全局最新」的 TODO 状态。
 */
import { memo, type CSSProperties } from 'react';
import type { TFunction } from './i18n';

export type AgentTodoItem = {
	id: string;
	content: string;
	status: 'pending' | 'in_progress' | 'completed';
	activeForm?: string;
};

export type BottomTodoLayoutMode = 'pushup' | 'overlay';

type Props = {
	t: TFunction;
	todos: AgentTodoItem[];
	isCollapsed: boolean;
	onToggle: () => void;
	/**
	 * 展开时 list 的布局模式，由父组件在展开瞬间按当时的贴底状态锁定。
	 * 折叠态下此值无视觉效果（list 不渲染）。
	 */
	layoutMode: BottomTodoLayoutMode;
	/**
	 * 父组件已决定要卸载本面板，正在等待退场动画跑完。
	 * 为 true 时切到退场 keyframe；折叠态展开态都共用同一退场效果，让收起总是丝滑。
	 */
	isLeaving?: boolean;
};

export const AgentBottomTodoPanel = memo<Props>(function AgentBottomTodoPanel({
	t,
	todos,
	isCollapsed,
	onToggle,
	layoutMode,
	isLeaving = false,
}) {
	if (todos.length === 0) {
		return null;
	}

	const doneCount = todos.filter((todo) => todo.status === 'completed').length;
	const isOpen = !isCollapsed;

	const listStyle: CSSProperties | undefined =
		layoutMode === 'overlay'
			? { position: 'absolute', left: 0, right: 0, bottom: '100%' }
			: undefined;

	return (
		<div
			className="ref-bottom-todo-panel"
			data-state={isOpen ? 'expanded' : 'collapsed'}
			data-mode={layoutMode}
			data-leaving={isLeaving ? 'true' : undefined}
			aria-hidden={isLeaving || undefined}
		>
			{isOpen ? (
				<div
					className="ref-bottom-todo-list-frame"
					data-mode={layoutMode}
					style={listStyle}
				>
					<div className="ref-bottom-todo-list-scroll">
						{todos.map((todo) => {
							const done = todo.status === 'completed';
							const active = todo.status === 'in_progress';
							return (
								<div
									key={todo.id}
									className={`ref-bottom-todo-item ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}
								>
									{active ? (
										<span className="ref-bottom-todo-spinner" aria-hidden />
									) : (
										<svg
											className="ref-bottom-todo-check"
											width="14"
											height="14"
											viewBox="0 0 16 16"
											fill="none"
											aria-hidden
										>
											<rect
												x="1"
												y="1"
												width="14"
												height="14"
												rx="3"
												stroke="currentColor"
												strokeWidth="1.5"
												fill={done ? 'currentColor' : 'none'}
											/>
											{done ? (
												<path
													d="M4.5 8l2.5 2.5 4.5-5"
													stroke="var(--void-bg-3, #1a1a1a)"
													strokeWidth="1.8"
													strokeLinecap="round"
													strokeLinejoin="round"
												/>
											) : null}
										</svg>
									)}
									<span className="ref-bottom-todo-text">
										{active && todo.activeForm ? todo.activeForm : todo.content}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			) : null}
			<button
				type="button"
				className="ref-bottom-todo-head"
				aria-expanded={isOpen}
				onClick={onToggle}
			>
				<svg
					className="ref-bottom-todo-head-icon"
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden
				>
					<path d="M2 4h12" />
					<path d="M2 8h12" />
					<path d="M2 12h8" />
				</svg>
				<span className="ref-bottom-todo-head-label">
					{t('agent.todoBottomPanel.summary', {
						done: doneCount,
						total: todos.length,
					})}
				</span>
				<svg
					className={`ref-bottom-todo-head-chev${isOpen ? ' is-open' : ''}`}
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="none"
					aria-hidden
				>
					<path
						d="M4 6l4 4 4-4"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>
		</div>
	);
});
