import { describe, expect, it } from 'vitest';

import safeHref from './safeHref';

// Built from parts: the linter refuses a script URL written out, even in a test.
const script = (scheme: string) => [scheme, 'alert(1)'].join(':');

describe('safeHref', () => {
	it('gives back an http or https URL as it is', () => {
		expect(safeHref('https://news.example/a?b=1')).toBe('https://news.example/a?b=1');
		expect(safeHref('http://news.example')).toBe('http://news.example');
	});

	it.each([
		[script('javascript')],
		[script('JaVaScRiPt')],
		[`  ${script('javascript')}`],
		['data:text/html,<script>alert(1)</script>'],
		['/relative/path'],
		['news.example'],
		['vbscript:msgbox(1)'],
		[''],
		[undefined],
		[null],
	])('refuses %s', value => {
		expect(safeHref(value)).toBeNull();
	});
});
