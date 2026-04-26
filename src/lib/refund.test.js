import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REFUND_TIMEOUT_MS } from './constants';
import isRefundEligible from './refund';

describe('isRefundEligible', () => {
	const now = 1_700_000_000_000;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns false when answered', () => {
		const submittedAt = now - REFUND_TIMEOUT_MS - 1;
		expect(isRefundEligible(submittedAt, true, false)).toBe(false);
	});

	it('returns false when cancelled', () => {
		const submittedAt = now - REFUND_TIMEOUT_MS - 1;
		expect(isRefundEligible(submittedAt, false, true)).toBe(false);
	});

	it('returns false when both answered and cancelled', () => {
		const submittedAt = now - REFUND_TIMEOUT_MS - 1;
		expect(isRefundEligible(submittedAt, true, true)).toBe(false);
	});

	it('returns false before 1 hour has elapsed', () => {
		const submittedAt = now - REFUND_TIMEOUT_MS + 1000;
		expect(isRefundEligible(submittedAt, false, false)).toBe(false);
	});

	it('returns false at exactly 1 hour (boundary)', () => {
		const submittedAt = now - REFUND_TIMEOUT_MS;
		expect(isRefundEligible(submittedAt, false, false)).toBe(false);
	});

	it('returns true after 1 hour has elapsed and not answered or cancelled', () => {
		const submittedAt = now - REFUND_TIMEOUT_MS - 1;
		expect(isRefundEligible(submittedAt, false, false)).toBe(true);
	});

	it('returns true well past 1 hour', () => {
		const submittedAt = now - REFUND_TIMEOUT_MS * 2;
		expect(isRefundEligible(submittedAt, false, false)).toBe(true);
	});
});
