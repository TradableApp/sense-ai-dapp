import { describe, expect, it } from 'vitest';

import { FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

import { REFUND_OUTLOOK } from './feeTokenRefusal';

describe('REFUND_OUTLOOK', () => {
	// A state without a row would fall back to the uncertain wording without anyone deciding
	// it. Every state has its row, so a verdict added later is a decision, not a default.
	it('has a row for every state of the fee token check', () => {
		expect(Object.keys(REFUND_OUTLOOK).sort()).toEqual([...FEE_TOKEN_STATES].sort());
	});

	it('promises a refund only where the escrow is listed and refuses it where it is not', () => {
		expect(REFUND_OUTLOOK['treasury-not-exempt']).toBe('works');
		expect(REFUND_OUTLOOK['escrow-not-exempt']).toBe('refused');
		expect(REFUND_OUTLOOK.ok).toBe('uncertain');
		expect(REFUND_OUTLOOK.unknown).toBe('uncertain');
	});
});
