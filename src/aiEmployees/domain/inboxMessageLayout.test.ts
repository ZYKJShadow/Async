import { describe, expect, it } from 'vitest';
import { isOutgoingInboxMessage } from './inboxMessageLayout';

describe('isOutgoingInboxMessage', () => {
	it('treats user-to-ceo messages as outgoing', () => {
		expect(isOutgoingInboxMessage({ fromEmployeeId: undefined, toEmployeeId: 'ceo-1' })).toBe(true);
	});

	it('treats user-to-employee direct messages as outgoing', () => {
		expect(isOutgoingInboxMessage({ fromEmployeeId: undefined, toEmployeeId: 'emp-1' })).toBe(true);
	});

	it('keeps ceo replies on the team side', () => {
		expect(isOutgoingInboxMessage({ fromEmployeeId: 'ceo-1', toEmployeeId: undefined })).toBe(false);
		expect(isOutgoingInboxMessage({ fromEmployeeId: 'ceo-1', toEmployeeId: 'user-thread' })).toBe(false);
	});

	it('keeps teammate replies and system notices on the team side', () => {
		expect(isOutgoingInboxMessage({ fromEmployeeId: 'emp-1', toEmployeeId: 'ceo-1' })).toBe(false);
		expect(isOutgoingInboxMessage({ fromEmployeeId: undefined, toEmployeeId: undefined })).toBe(false);
	});
});
