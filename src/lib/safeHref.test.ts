import { describe, expect, it } from 'vitest';

import safeHref from './safeHref';

// Built from parts: the linter refuses a script URL written out, even in a test.
const script = (scheme: string) => [scheme, 'alert(1)'].join(':');

describe('safeHref', () => {
	it('gives back an http or https URL in the form the browser reads it', () => {
		expect(safeHref('https://news.example/a?b=1')).toBe('https://news.example/a?b=1');
		expect(safeHref('http://news.example')).toBe('http://news.example/');
		expect(safeHref(' HTTPS://News.Example/a ')).toBe('https://news.example/a');
		expect(safeHref('https://news.example/\ta\nb')).toBe('https://news.example/ab');
	});

	it.each([
		[script('javascript')],
		[script('JaVaScRiPt')],
		[`  ${script('javascript')}`],
		['data:text/html,<script>alert(1)</script>'],
		['/relative/path'],
		['news.example'],
		['vbscript:msgbox(1)'],
		[`\u0001${script('javascript')}`],
		[script('java\tscript')],
		[script('java\nscript')],
		['blob:https://app.example/1'],
		['file:///etc/hosts'],
		['ftp://files.example/a'],
		['mailto:someone@example.com'],
		['//evil.example/x'],
		['/\\evil.example/x'],
		['\\\\evil.example/x'],
		['#top'],
		['https://'],
		[''],
		[undefined],
		[null],
	])('refuses %s', value => {
		expect(safeHref(value)).toBeNull();
	});
});
