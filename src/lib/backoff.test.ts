import { describe, expect, it } from 'vitest';

import { BACKOFF_JITTER_RATIO, backoffDelayMs, MAX_BACKOFF_MS } from './backoff';

describe('backoffDelayMs', () => {
	it('doubles from the interval with no jitter when random() is 0', () => {
		expect([0, 1, 2, 3].map(a => backoffDelayMs(a, 500, () => 0))).toEqual([500, 1000, 2000, 4000]);
	});

	it('caps the base delay and still applies jitter on top of the cap', () => {
		expect(backoffDelayMs(20, 500, () => 0)).toBe(MAX_BACKOFF_MS);
		expect(backoffDelayMs(20, 500, () => 1)).toBe(
			Math.round(MAX_BACKOFF_MS * (1 + BACKOFF_JITTER_RATIO)),
		);
	});

	it('never shortens a delay: jitter is additive only', () => {
		expect(backoffDelayMs(2, 500, () => 0.5)).toBeGreaterThanOrEqual(2000);
	});
});
