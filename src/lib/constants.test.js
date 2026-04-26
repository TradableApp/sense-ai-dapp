import { describe, it, expect } from 'vitest';
import { CANCELLATION_TIMEOUT_MS, REFUND_TIMEOUT_MS } from './constants';

describe('constants', () => {
	it('CANCELLATION_TIMEOUT_MS is 3 seconds', () => {
		expect(CANCELLATION_TIMEOUT_MS).toBe(3_000);
	});

	it('REFUND_TIMEOUT_MS is 1 hour', () => {
		expect(REFUND_TIMEOUT_MS).toBe(3_600_000);
	});

	it('CANCELLATION_TIMEOUT_MS matches on-chain value (3s)', () => {
		expect(CANCELLATION_TIMEOUT_MS / 1000).toBe(3);
	});

	it('REFUND_TIMEOUT_MS matches on-chain value (1h)', () => {
		expect(REFUND_TIMEOUT_MS / 1000 / 60 / 60).toBe(1);
	});
});
