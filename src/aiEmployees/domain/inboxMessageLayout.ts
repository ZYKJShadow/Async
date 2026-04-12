import type { AiCollabMessage } from '../../../shared/aiEmployeesSettings';

/**
 * Only real end-user-authored messages render on the right.
 * Team messages (CEO / teammates) should remain on the left so the
 * conversation always reads as "you" vs "the team".
 */
export function isOutgoingInboxMessage(message: Pick<AiCollabMessage, 'fromEmployeeId' | 'toEmployeeId'>): boolean {
	return !message.fromEmployeeId && Boolean(message.toEmployeeId);
}
