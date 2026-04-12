import type { AiCollabMessage } from '../../../shared/aiEmployeesSettings';

/**
 * CEO「最终答复」卡片：成果类 result，由 CEO 发出，且不挂在某个子任务 job 上。
 * 与「子 agent 的 result」区分（后者通常带 subAgentJobId）。
 */
export function isCeoFinalCollabMessage(
	message: Pick<AiCollabMessage, 'type' | 'fromEmployeeId' | 'subAgentJobId'>,
	ceoEmployeeId?: string
): boolean {
	return (
		Boolean(ceoEmployeeId) &&
		message.type === 'result' &&
		message.fromEmployeeId === ceoEmployeeId &&
		!message.subAgentJobId
	);
}
