import { describe, expect, it } from 'vitest';

import { CURSOR_CLOCK_ALLOWANCE_MS, cursorFrom, isAheadOfClock, usableCursor } from './syncCursor';

const NOW = 1_800_000_000_000;

describe('the sync cursor and the clock', () => {
	it('allows five minutes ahead of the clock', () => {
		expect(CURSOR_CLOCK_ALLOWANCE_MS).toBe(300_000);
		expect(isAheadOfClock(NOW + CURSOR_CLOCK_ALLOWANCE_MS, NOW)).toBe(false);
		expect(isAheadOfClock(NOW + CURSOR_CLOCK_ALLOWANCE_MS + 1, NOW)).toBe(true);
	});

	it('is the newest served time inside the allowance', () => {
		expect(cursorFrom([NOW - 5_000, NOW + 60_000, NOW - 1], NOW)).toBe(NOW + 60_000);
	});

	it('leaves out a time past the allowance', () => {
		expect(cursorFrom([NOW - 5_000, NOW + CURSOR_CLOCK_ALLOWANCE_MS + 1], NOW)).toBe(NOW - 5_000);
	});

	// Never the clock in place of a served time.
	it('is undefined when no served time is inside the allowance', () => {
		expect(cursorFrom([NOW + 10 * CURSOR_CLOCK_ALLOWANCE_MS], NOW)).toBeUndefined();
		expect(cursorFrom([], NOW)).toBeUndefined();
	});

	it('ignores a time that is not a number', () => {
		expect(cursorFrom([Number.NaN, NOW - 1], NOW)).toBe(NOW - 1);
	});

	it('reads a stored cursor past the allowance as no cursor, and keeps any other', () => {
		expect(usableCursor(NOW + CURSOR_CLOCK_ALLOWANCE_MS + 1, NOW)).toBe(0);
		expect(usableCursor(NOW + 1_000, NOW)).toBe(NOW + 1_000);
		expect(usableCursor(0, NOW)).toBe(0);
	});
});
