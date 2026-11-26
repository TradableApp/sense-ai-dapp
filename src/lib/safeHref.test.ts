import { describe, expect, it } from 'vitest';

import safeHref, { linkHref, textShowsHost } from './safeHref';

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

describe('linkHref', () => {
	it('takes what safeHref takes, in its parsed form', () => {
		expect(linkHref('https://news.example/a?b=1#c')).toBe('https://news.example/a?b=1#c');
		expect(linkHref('data:text/html,x')).toBeNull();
		expect(linkHref('//news.example/a')).toBeNull();
	});

	it.each([
		'https://bank.example@evil.example/login',
		'https://user:pass@evil.example/',
		'https://:pass@evil.example/',
		'http://bank.example%2Fpay@evil.example/',
	])('refuses %s, which carries a user name or password', url => {
		expect(safeHref(url)).not.toBeNull();
		expect(linkHref(url)).toBeNull();
	});
});

describe('textShowsHost', () => {
	it.each([
		['news.example', 'https://news.example/'],
		['NEWS.example', 'https://news.example/'],
		['https://news.example/a', 'https://news.example/a'],
		['news.example/a?b', 'http://news.example/a?b'],
		['localhost:3002/x', 'http://localhost:3002/x'],
	])('takes %s as showing the host of %s', (text, href) => {
		expect(textShowsHost(text, href)).toBe(true);
	});

	it.each([
		['Claim refund', 'https://phish.example/claim'],
		['news.example', 'https://evil.example/'],
		['news.example.evil.example', 'https://evil.example/'],
		['https://news.example.evil.example/a', 'https://news.example/a'],
		['news.examples', 'https://news.example/'],
		['http://news.example/a', 'https://news.example/a'],
		// Look-alike letters: the browser opens the punycode host, which the text does not show.
		['раураl.com', 'https://раураl.com/'],
		['xn--l-7sba6dbr.com', 'https://xn--l-7sba6dbr.com/'],
	])('does not take %s as showing the host of %s', (text, href) => {
		expect(textShowsHost(text, href)).toBe(false);
	});
});
