import { describe, expect, it } from 'vitest';

import leaksPartOf, { LEAK_WINDOW } from './leaksPartOf';

describe('leaksPartOf', () => {
	it('finds four characters of the value in the message', () => {
		expect(leaksPartOf('got abcd here', 'xxabcdxx')).toBe(true);
		expect(leaksPartOf('got abc here', 'xxabcdxx')).toBe(false);
	});

	// A value shorter than the window has no window to look for, and would pass any message.
	it('refuses a value too short to be checked', () => {
		expect(() => leaksPartOf('anything', 'a'.repeat(LEAK_WINDOW - 1))).toThrow(/at least/);
	});
});
