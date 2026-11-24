import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REFUND_TIMEOUT_MS } from './constants';
import isRefundEligible, {
	isPastRefundWindow,
	REFUND_UNLOCK_MARGIN_MS,
	refundOpensAt,
	secondsUntilRefund,
} from './refund';

// The contract refuses a refund while the refunding block's time is short of the prompt's time
// plus the hour, and that block's time can trail this device's clock: the dApp offers the
// refund only a margin after the hour.
describe('when a refund is offered', () => {
	const sentAt = 1_700_000_000_000;

	it('waits thirty seconds past the hour', () => {
		expect(REFUND_UNLOCK_MARGIN_MS).toBe(30_000);
		expect(refundOpensAt(sentAt)).toBe(sentAt + REFUND_TIMEOUT_MS + REFUND_UNLOCK_MARGIN_MS);
	});

	it('is not offered just after the hour', () => {
		expect(isPastRefundWindow(sentAt, sentAt + REFUND_TIMEOUT_MS + 1)).toBe(false);
		expect(isPastRefundWindow(sentAt, sentAt + REFUND_TIMEOUT_MS + REFUND_UNLOCK_MARGIN_MS)).toBe(
			false,
		);
	});

	it('is offered once the margin has passed too', () => {
		expect(
			isPastRefundWindow(sentAt, sentAt + REFUND_TIMEOUT_MS + REFUND_UNLOCK_MARGIN_MS + 1),
		).toBe(true);
	});

	it('counts its seconds down to that time, rounded up, and never below zero', () => {
		const opens = refundOpensAt(sentAt);
		expect(secondsUntilRefund(sentAt, sentAt)).toBe(
			(REFUND_TIMEOUT_MS + REFUND_UNLOCK_MARGIN_MS) / 1000,
		);
		expect(secondsUntilRefund(sentAt, opens - 1_500)).toBe(2);
		expect(secondsUntilRefund(sentAt, sentAt + REFUND_TIMEOUT_MS)).toBe(
			REFUND_UNLOCK_MARGIN_MS / 1000,
		);
		expect(secondsUntilRefund(sentAt, opens)).toBe(0);
		expect(secondsUntilRefund(sentAt, opens + 60_000)).toBe(0);
	});
});

describe('isRefundEligible', () => {
	const now = 1_700_000_000_000;
	const PAST = REFUND_TIMEOUT_MS + REFUND_UNLOCK_MARGIN_MS + 1;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns false when answered', () => {
		expect(isRefundEligible(now - PAST, true, false)).toBe(false);
	});

	it('returns false when cancelled', () => {
		expect(isRefundEligible(now - PAST, false, true)).toBe(false);
	});

	it('returns false when both answered and cancelled', () => {
		expect(isRefundEligible(now - PAST, true, true)).toBe(false);
	});

	it('returns false before 1 hour has elapsed', () => {
		const submittedAt = now - REFUND_TIMEOUT_MS + 1000;
		expect(isRefundEligible(submittedAt, false, false)).toBe(false);
	});

	it('returns false just after the hour, inside the margin', () => {
		const submittedAt = now - REFUND_TIMEOUT_MS - 1;
		expect(isRefundEligible(submittedAt, false, false)).toBe(false);
	});

	it('returns true after the hour and the margin, when not answered or cancelled', () => {
		expect(isRefundEligible(now - PAST, false, false)).toBe(true);
	});

	it('returns true well past 1 hour', () => {
		const submittedAt = now - REFUND_TIMEOUT_MS * 2;
		expect(isRefundEligible(submittedAt, false, false)).toBe(true);
	});
});
