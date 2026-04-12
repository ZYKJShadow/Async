import { describe, expect, it } from 'vitest';
import { isCeoFinalCollabMessage } from './ceoFinalCollabMessage';

describe('isCeoFinalCollabMessage', () => {
	it('is true for CEO result without subAgentJobId', () => {
		expect(
			isCeoFinalCollabMessage(
				{ type: 'result', fromEmployeeId: 'ceo-1', subAgentJobId: undefined },
				'ceo-1'
			)
		).toBe(true);
	});

	it('is false when subAgentJobId is set (sub-agent delivery)', () => {
		expect(
			isCeoFinalCollabMessage(
				{ type: 'result', fromEmployeeId: 'ceo-1', subAgentJobId: 'job-1' },
				'ceo-1'
			)
		).toBe(false);
	});

	it('is false when from is not CEO', () => {
		expect(
			isCeoFinalCollabMessage({ type: 'result', fromEmployeeId: 'other', subAgentJobId: undefined }, 'ceo-1')
		).toBe(false);
	});

	it('is false when ceoEmployeeId is missing', () => {
		expect(
			isCeoFinalCollabMessage({ type: 'result', fromEmployeeId: 'ceo-1', subAgentJobId: undefined }, undefined)
		).toBe(false);
	});

	it('is false for non-result types', () => {
		expect(
			isCeoFinalCollabMessage({ type: 'status_update', fromEmployeeId: 'ceo-1', subAgentJobId: undefined }, 'ceo-1')
		).toBe(false);
	});
});
