import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentUserInputRequest } from './agentSessionTypes';
import { useI18n } from './i18n';

type AnswerDraft = {
	selected: string | null;
	custom: string;
};

type FormProps = {
	request: AgentUserInputRequest;
	onSubmit: (answers: Record<string, string>) => Promise<void> | void;
	compact?: boolean;
	submitLabel: string;
	title: string;
};

function buildInitialDrafts(request: AgentUserInputRequest): Record<string, AnswerDraft> {
	const next: Record<string, AnswerDraft> = {};
	for (const question of request.questions) {
		next[question.id] = { selected: null, custom: '' };
	}
	return next;
}

function RequestUserInputForm({ request, onSubmit, compact = false, submitLabel, title }: FormProps) {
	const { t } = useI18n();
	const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>(() => buildInitialDrafts(request));
	const [submitting, setSubmitting] = useState(false);
	const customInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

	useEffect(() => {
		setDrafts(buildInitialDrafts(request));
		customInputRefs.current = {};
	}, [request.requestId]);

	const canSubmit = useMemo(
		() =>
			request.questions.every((question) => {
				const draft = drafts[question.id] ?? { selected: null, custom: '' };
				if (!draft.selected) {
					return false;
				}
				if (draft.selected === '__other__') {
					return draft.custom.trim().length > 0;
				}
				return true;
			}),
		[drafts, request.questions]
	);

	const selectOption = (questionId: string, value: string) => {
		setDrafts((prev) => ({
			...prev,
			[questionId]: {
				...(prev[questionId] ?? { selected: null, custom: '' }),
				selected: value,
			},
		}));
		if (value === '__other__') {
			setTimeout(() => customInputRefs.current[questionId]?.focus(), 30);
		}
	};

	const updateCustom = (questionId: string, value: string) => {
		setDrafts((prev) => ({
			...prev,
			[questionId]: {
				...(prev[questionId] ?? { selected: '__other__', custom: '' }),
				selected: '__other__',
				custom: value,
			},
		}));
	};

	const handleSubmit = async () => {
		if (!canSubmit || submitting) {
			return;
		}
		const answers: Record<string, string> = {};
		for (const question of request.questions) {
			const draft = drafts[question.id];
			if (!draft?.selected) {
				continue;
			}
			answers[question.id] =
				draft.selected === '__other__' ? draft.custom.trim() : draft.selected;
		}
		setSubmitting(true);
		try {
			await onSubmit(answers);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className={`ref-user-input-shell ${compact ? 'ref-user-input-shell--compact' : ''}`}>
			<div className="ref-user-input-head">
				<div className="ref-user-input-head-main">
					<span className="ref-plan-q-title">{title}</span>
					<strong className="ref-user-input-agent">{request.agentTitle}</strong>
				</div>
			</div>
			<div className="ref-user-input-body">
				{request.questions.map((question, index) => {
					const draft = drafts[question.id] ?? { selected: null, custom: '' };
					const otherSelected = draft.selected === '__other__';
					return (
						<section key={question.id} className="ref-user-input-question">
							<div className="ref-user-input-question-head">
								<span className="ref-user-input-question-index">{index + 1}</span>
								<div className="ref-user-input-question-copy">
									<div className="ref-user-input-question-header">{question.header}</div>
									<p className="ref-user-input-question-text">{question.question}</p>
								</div>
							</div>
							<div className="ref-plan-q-options">
								{question.options.map((option, optionIndex) => {
									const active = draft.selected === option.label;
									return (
										<button
											key={`${question.id}-${option.label}`}
											type="button"
											role="radio"
											aria-checked={active}
											className={`ref-plan-q-opt ${active ? 'is-selected' : ''}`}
											onClick={() => selectOption(question.id, option.label)}
										>
											<span className="ref-plan-q-opt-id">{String.fromCharCode(65 + optionIndex)}</span>
											<span className="ref-user-input-option-copy">
												<span className="ref-plan-q-opt-label">{option.label}</span>
												{option.description ? (
													<span className="ref-user-input-option-description">{option.description}</span>
												) : null}
											</span>
										</button>
									);
								})}
								<button
									type="button"
									role="radio"
									aria-checked={otherSelected}
									className={`ref-plan-q-opt ${otherSelected ? 'is-selected' : ''}`}
									onClick={() => selectOption(question.id, '__other__')}
								>
									<span className="ref-plan-q-opt-id">{String.fromCharCode(65 + question.options.length)}</span>
									<span className="ref-plan-q-opt-label ref-plan-q-opt-label--other">
										<span className="ref-plan-q-opt-other-prefix">{t('agent.userInput.other')}</span>
										{otherSelected ? (
											<input
												ref={(node) => {
													customInputRefs.current[question.id] = node;
												}}
												type="text"
												className="ref-plan-q-custom-input"
												placeholder={t('agent.userInput.customPlaceholder')}
												value={draft.custom}
												onClick={(event) => event.stopPropagation()}
												onChange={(event) => updateCustom(question.id, event.target.value)}
												onKeyDown={(event) => {
													if (event.key === 'Enter' && canSubmit) {
														event.preventDefault();
														void handleSubmit();
													}
												}}
											/>
										) : null}
									</span>
								</button>
							</div>
						</section>
					);
				})}
			</div>
			<div className="ref-plan-q-foot">
				<button
					type="button"
					className="ref-plan-q-btn ref-plan-q-btn--primary"
					disabled={!canSubmit || submitting}
					onClick={() => void handleSubmit()}
				>
					{submitLabel}
				</button>
			</div>
		</div>
	);
}

type DialogProps = {
	request: AgentUserInputRequest;
	onSubmit: (answers: Record<string, string>) => Promise<void> | void;
};

export function UserInputRequestDialog({ request, onSubmit }: DialogProps) {
	const { t } = useI18n();
	return (
		<div className="ref-plan-q" role="dialog" aria-label={t('agent.userInput.dialogAria')}>
			<RequestUserInputForm
				request={request}
				onSubmit={onSubmit}
				submitLabel={t('common.continue')}
				title={t('agent.userInput.dialogTitle')}
			/>
		</div>
	);
}

type InlineProps = {
	request: AgentUserInputRequest;
	onSubmit: (answers: Record<string, string>) => Promise<void> | void;
};

export function UserInputRequestInlineCard({ request, onSubmit }: InlineProps) {
	const { t } = useI18n();
	return (
		<div className="ref-agent-session-user-input">
			<RequestUserInputForm
				request={request}
				onSubmit={onSubmit}
				compact={true}
				submitLabel={t('common.continue')}
				title={t('agent.userInput.inlineTitle')}
			/>
		</div>
	);
}
