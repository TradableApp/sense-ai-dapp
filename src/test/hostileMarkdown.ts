import { expect } from 'vitest';

/**
 * Markdown that tries every way the chat's renderer could load something by being shown, or
 * link somewhere other than an ordinary web page. Rendered conversation text is decrypted, so
 * nothing in it may fetch a resource or navigate anywhere unsafe.
 */

// Built from parts: the linter refuses a script URL written out, even in a test.
const script = (scheme: string) => [scheme, 'alert(1)'].join(':');

export const HOSTILE_LINKS = {
	mixedCase: script('JaVaScRiPt'),
	leadingControl: `\u0001${script('javascript')}`,
	tabInside: script('java\tscript'),
	data: 'data:text/html,hello',
	vbscript: script('vbscript'),
	blob: 'blob:https://app.example/1',
	protocolRelative: '//evil.example/x',
	backslashRelative: '/\\evil.example/x',
	relative: '/history',
	fragment: '#top',
	ftp: 'ftp://files.example/a',
	mail: 'mailto:someone@example.com?body=hello',
} as const;

export const HOSTILE_MARKDOWN = [
	'Inline image ![inline alt](https://img.example/p.png?d=SECRET)',
	'',
	'Reference image ![reference alt][logo]',
	'',
	'[logo]: https://img.example/r.png?d=SECRET',
	'',
	'Linked image [![nested alt](https://img.example/n.png?d=SECRET)](https://news.example/n)',
	'',
	'<img src="https://img.example/raw.png?d=SECRET">',
	'<iframe src="https://frame.example/f"></iframe>',
	'<video src="https://media.example/v.mp4"></video>',
	'<audio src="https://media.example/a.mp3"></audio>',
	'<object data="https://media.example/o"></object>',
	'<embed src="https://media.example/e">',
	'<link rel="stylesheet" href="https://css.example/s.css">',
	'<picture><source srcset="https://img.example/s.png"></picture>',
	'<div style="background:url(https://img.example/bg.png)">styled</div>',
	'',
	...Object.entries(HOSTILE_LINKS).map(([name, url]) => `[${name}](<${url}>)`),
	'',
	`[reference link][bad]`,
	'',
	`[bad]: ${script('javascript')}`,
	'',
	`Autolink <${script('javascript')}>`,
	'',
	'[Claim refund](https://phish.example/claim) and www.bare.example',
].join('\n');

/** The tags that load a remote resource just by being in the page. */
const LOADING_ELEMENTS =
	'img, iframe, frame, video, audio, source, track, picture, object, embed, link, script, style, image, input[type="image"]';

const WEB = new Set(['http:', 'https:']);

/**
 * Asserts the rendered text can fetch nothing and navigate nowhere unsafe: no element that loads
 * a resource, no attribute that names one, and every link an http or https URL that opens in a
 * new tab, sends no referrer and shows where it leads.
 */
export function expectRenderedTextIsInert(container: HTMLElement) {
	expect(container.querySelectorAll(LOADING_ELEMENTS)).toHaveLength(0);
	const loading = [...container.querySelectorAll('*')].flatMap(el =>
		[...el.attributes]
			.filter(
				attr =>
					['src', 'srcset', 'data', 'poster', 'background', 'formaction', 'action'].includes(
						attr.name,
					) ||
					attr.name.startsWith('on') ||
					(attr.name === 'style' && /url\(/i.test(attr.value)),
			)
			.map(attr => `${el.tagName.toLowerCase()}[${attr.name}]`),
	);
	expect(loading).toEqual([]);

	const links = [...container.querySelectorAll('[href]')];
	links.forEach(link => {
		const href = link.getAttribute('href') ?? '';
		expect(link.tagName).toBe('A');
		expect(WEB.has(new URL(href).protocol)).toBe(true);
		expect(href).toBe(new URL(href).href);
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')?.split(/\s+/)).toEqual(
			expect.arrayContaining(['noopener', 'noreferrer']),
		);
		expect(link.getAttribute('referrerpolicy')).toBe('no-referrer');
	});
	return links as HTMLAnchorElement[];
}

/** The host a link names, as the page shows it next to the link. */
export function shownHostOf(link: Element): string | null {
	const next = link.nextElementSibling;
	return next?.hasAttribute('data-link-host') ? next.textContent : null;
}
