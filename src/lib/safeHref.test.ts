import { describe, expect, it } from 'vitest';

import safeHref from './safeHref';

describe('safeHref', () => {
	it('gives back an http or https URL as it is', () => {
		expect(safeHref('https://news.example/a?b=1')).toBe('https://news.example/a?b=1');
		expect(safeHref('http://news.example')).toBe('http://news.example');
	});

	it.each([
		['javascript:alert(1)'],
		['JaVaScRiPt:alert(1)'],
		['  javascript:alert(1)'],
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
