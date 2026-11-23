import { REFUND_TIMEOUT_MS } from '@/lib/constants';

/**
 * How long after the hour, on this device's clock, the dApp offers a refund. The contract
 * refuses one while the time of the block that takes it is short of the prompt's time plus the
 * hour, and that block's time can trail this clock:
 * - the including block's time trails real time by at most the time between two blocks, which
 *   on Base Sepolia was measured at about 200 ms;
 * - a device clock kept by NTP is usually within a second, but one left to drift can run some
 *   seconds, sometimes tens of seconds, ahead; the rest of the margin (about 28 s) is for that;
 * - the 15 s clock that checks the hour (`REFUND_CLOCK_MS`) only ever unlocks later than this
 *   rule, never earlier, so it needs nothing here.
 * An honest clock then never offers a refund the next block would refuse.
 */
export const REFUND_UNLOCK_MARGIN_MS = 30_000;

/** When the refund of a prompt sent at `createdAt` is offered (both in milliseconds). */
export const refundOpensAt = (createdAt: number): number =>
	createdAt + REFUND_TIMEOUT_MS + REFUND_UNLOCK_MARGIN_MS;

/** Whether a payment made at `createdAt` can be refunded at `now` (both in milliseconds). */
export const isPastRefundWindow = (createdAt: number, now: number): boolean =>
	now > refundOpensAt(createdAt);

/** Whole seconds until the refund is offered, rounded up; zero once it is. */
export const secondsUntilRefund = (createdAt: number, now: number): number =>
	Math.max(0, Math.ceil((refundOpensAt(createdAt) - now) / 1000));

export default function isRefundEligible(
	submittedAt: number,
	isAnswered: boolean,
	isCancelled: boolean,
): boolean {
	if (isAnswered || isCancelled) return false;
	return isPastRefundWindow(submittedAt, Date.now());
}
