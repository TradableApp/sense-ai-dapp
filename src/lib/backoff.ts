/**
 * Shared retry backoff: doubles from a base interval, is capped, and carries positive
 * jitter so many clients that failed together do not retry together. Pure, so both the
 * live state poller and the payload resolver can use it without pulling in React.
 */

/** Upper bound for any single backoff delay. */
export const MAX_BACKOFF_MS = 60_000;
/** Jitter added on top of a backoff delay, as a fraction of that delay. */
export const BACKOFF_JITTER_RATIO = 0.25;

/** Delay after `attempt` consecutive failures: doubles from the interval, capped, jittered. */
export const backoffDelayMs = (
	attempt: number,
	intervalMs: number,
	random: () => number,
): number => {
	const base = Math.min(intervalMs * 2 ** attempt, MAX_BACKOFF_MS);
	return Math.round(base * (1 + BACKOFF_JITTER_RATIO * random()));
};
