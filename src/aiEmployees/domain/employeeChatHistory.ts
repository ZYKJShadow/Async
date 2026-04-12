import type { AiCollabMessage } from '../../../shared/aiEmployeesSettings';
import type { EmployeeChatHistoryTurn } from '../../../shared/aiEmployeesPersona';

/**
 * Build OpenAI-style turns for an employee inbox thread: user = lead/manager, assistant = employee.
 */
export function buildCollabHistoryForEmployee(messages: AiCollabMessage[], employeeId: string): EmployeeChatHistoryTurn[] {
	const thread = messages
		.filter((m) => m.toEmployeeId === employeeId || m.fromEmployeeId === employeeId)
		.sort((a, b) => Date.parse(a.createdAtIso) - Date.parse(b.createdAtIso));
	const out: EmployeeChatHistoryTurn[] = [];
	for (const m of thread) {
		const content = m.body?.trim();
		if (!content) {
			continue;
		}
		if (m.fromEmployeeId === employeeId) {
			out.push({ role: 'assistant', content });
		} else {
			out.push({ role: 'user', content });
		}
	}
	return out.slice(-20);
}

function messageSnippetForHistory(m: AiCollabMessage): string | undefined {
	const body = m.body?.trim();
	if (!body) {
		return undefined;
	}
	switch (m.type) {
		case 'task_assignment':
			return `[Task assigned] ${m.summary}\n${body}`;
		case 'result':
			return `[Teammate result] ${m.summary}\n${body}`;
		case 'blocker':
			return `[Blocker] ${m.summary}\n${body}`;
		default:
			return body;
	}
}

/**
 * Build history for one employee limited to a single run (group chat / delegation).
 * Includes the CEO's in-run messages as user context when `ceoEmployeeId` is set.
 */
export function buildCollabHistoryForEmployeeInRun(
	messages: AiCollabMessage[],
	runId: string,
	employeeId: string,
	ceoEmployeeId?: string
): EmployeeChatHistoryTurn[] {
	const inRun = messages
		.filter((m) => m.runId === runId)
		.sort((a, b) => Date.parse(a.createdAtIso) - Date.parse(b.createdAtIso));
	const thread = inRun.filter((m) => {
		if (m.toEmployeeId === employeeId || m.fromEmployeeId === employeeId) {
			return true;
		}
		if (ceoEmployeeId && m.fromEmployeeId === ceoEmployeeId) {
			return true;
		}
		return false;
	});
	const out: EmployeeChatHistoryTurn[] = [];
	for (const m of thread) {
		const content = messageSnippetForHistory(m);
		if (!content) {
			continue;
		}
		if (m.fromEmployeeId === employeeId) {
			out.push({ role: 'assistant', content });
		} else {
			out.push({ role: 'user', content });
		}
	}
	return out.slice(-24);
}

/**
 * CEO sees the full run transcript: user + team + their own prior replies.
 */
export function buildCollabHistoryForCeoInRun(messages: AiCollabMessage[], runId: string, ceoEmployeeId: string): EmployeeChatHistoryTurn[] {
	const thread = messages
		.filter((m) => m.runId === runId)
		.sort((a, b) => Date.parse(a.createdAtIso) - Date.parse(b.createdAtIso));
	const out: EmployeeChatHistoryTurn[] = [];
	for (const m of thread) {
		const content = messageSnippetForHistory(m);
		if (!content) {
			continue;
		}
		const fromCeo = m.fromEmployeeId === ceoEmployeeId;
		if (fromCeo) {
			out.push({ role: 'assistant', content });
		} else {
			out.push({ role: 'user', content });
		}
	}
	return out.slice(-28);
}
