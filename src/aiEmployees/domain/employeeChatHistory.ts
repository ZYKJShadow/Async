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
