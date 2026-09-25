import { describe, expect, it } from 'vitest';

import shouldInitialiseAppCheck from './appCheck';

describe('shouldInitialiseAppCheck', () => {
	it('initialises when a site key is configured', () => {
		expect(shouldInitialiseAppCheck('6Lc-real-site-key')).toBe(true);
	});

	// The CI case. Without this guard reCAPTCHA logs "Missing required parameters: sitekey"
	// from inside its own injected script — asynchronously, so the try/catch around Firebase
	// init does not catch it and it lands in the console.
	it('skips when the site key is unset', () => {
		expect(shouldInitialiseAppCheck(undefined)).toBe(false);
	});

	it('skips when the site key is empty', () => {
		expect(shouldInitialiseAppCheck('')).toBe(false);
	});

	// An env file with a trailing space after `=`, or a quoting mistake, produces this. It is
	// just as unusable as an empty value but is truthy, so it would slip past a bare check.
	it('skips when the site key is whitespace only', () => {
		expect(shouldInitialiseAppCheck('   ')).toBe(false);
	});
});
