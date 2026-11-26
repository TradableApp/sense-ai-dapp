/**
 * The sync cursor is the newest `lastMessageCreatedAt` The Graph served, and the next pass
 * asks only for conversations updated from that time on. The time is the indexer's word, so
 * one row served with a time far ahead would hold the cursor there and hide everything updated
 * before it. A served time is therefore taken for the cursor only when it is not more than
 * `CURSOR_CLOCK_ALLOWANCE_MS` ahead of this device's clock.
 *
 * This is an upper bound on a served value, never a substitute for one: when no row is within
 * it, the cursor stays where it was. Setting it to the clock (plus the allowance) instead
 * would put it at a time nothing was served with, and a conversation indexed later with an
 * earlier block time would never be read.
 */

/**
 * How far ahead of this device's clock a served time is still taken: five minutes.
 *
 * A served time is a block time, which follows real time to within the block interval (a
 * second or two on Base). What can put it ahead of this device is this device's clock running
 * behind: one kept by network time is within a second, one that is not can drift by minutes.
 * Five minutes covers that drift with room to spare. A device further behind still syncs
 * correctly: a newer row is not taken for the cursor until its clock passes it, so the pass
 * asks again from the last row it took and reads those rows again (the stored ones are skipped
 * by their CIDs). The other side of the bound is what it lets through: a row served up to five
 * minutes ahead can move the cursor at most that far past the newest real update.
 */
export const CURSOR_CLOCK_ALLOWANCE_MS = 5 * 60_000;

/** Whether a served time (milliseconds) is further ahead of `now` than the allowance. */
export const isAheadOfClock = (timeMs: number, now: number): boolean =>
	timeMs > now + CURSOR_CLOCK_ALLOWANCE_MS;

/**
 * The new cursor: the newest of the served times (milliseconds) that is not ahead of the
 * clock, or undefined when none is, so the cursor stays where it was.
 */
export function cursorFrom(times: readonly number[], now: number): number | undefined {
	let newest: number | undefined;
	times.forEach(time => {
		if (!Number.isFinite(time) || isAheadOfClock(time, now)) return;
		if (newest === undefined || time > newest) newest = time;
	});
	return newest;
}

/**
 * A stored cursor as the next pass may use it. One ahead of the clock (stored before this
 * check, or with the device's clock set back since) is read as no cursor, so the pass reads
 * the history from the start rather than asking only for times nothing has reached yet.
 */
export const usableCursor = (cursor: number, now: number): number =>
	isAheadOfClock(cursor, now) ? 0 : cursor;
