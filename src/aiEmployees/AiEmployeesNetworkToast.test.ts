import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	publishAiEmployeesNetworkError,
	publishAiEmployeesNotice,
	setAiEmployeesNetworkToastListener,
	notifyAiEmployeesRequestFailed,
} from './AiEmployeesNetworkToast';

describe('AiEmployeesNetworkToast bus', () => {
	afterEach(() => {
		setAiEmployeesNetworkToastListener(null);
		vi.restoreAllMocks();
	});

	it('publishAiEmployeesNetworkError trims and sends kind error', () => {
		const received: { text: string; kind: string }[] = [];
		setAiEmployeesNetworkToastListener((p) => received.push(p));
		publishAiEmployeesNetworkError('  hello  ');
		expect(received).toEqual([{ text: 'hello', kind: 'error' }]);
	});

	it('publishAiEmployeesNotice trims and sends kind notice', () => {
		const received: { text: string; kind: string }[] = [];
		setAiEmployeesNetworkToastListener((p) => received.push(p));
		publishAiEmployeesNotice('  note  ');
		expect(received).toEqual([{ text: 'note', kind: 'notice' }]);
	});

	it('ignores empty / whitespace-only messages', () => {
		const received: unknown[] = [];
		setAiEmployeesNetworkToastListener((p) => received.push(p));
		publishAiEmployeesNetworkError('');
		publishAiEmployeesNetworkError('   ');
		publishAiEmployeesNotice('');
		expect(received).toHaveLength(0);
	});

	it('falls back to console.warn when no listener (error)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		publishAiEmployeesNetworkError('boom');
		expect(warn).toHaveBeenCalledWith('[ai-employees]', 'boom');
	});

	it('falls back to console.info when no listener (notice)', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		publishAiEmployeesNotice('hi');
		expect(info).toHaveBeenCalledWith('[ai-employees]', 'hi');
	});

	it('notifyAiEmployeesRequestFailed maps to error kind', () => {
		const received: { text: string; kind: string }[] = [];
		setAiEmployeesNetworkToastListener((p) => received.push(p));
		notifyAiEmployeesRequestFailed(new Error('net'));
		expect(received).toEqual([{ text: 'net', kind: 'error' }]);
	});
});
