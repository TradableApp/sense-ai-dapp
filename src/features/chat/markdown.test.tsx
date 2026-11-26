import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectRenderedTextIsInert, HOSTILE_MARKDOWN, shownHostOf } from '@/test/hostileMarkdown';

import MarkdownText from './markdown';

/**
 * The one renderer for conversation text: an answer, stored or provisional, and the user's own
 * prompt. Whatever the text says, what is rendered loads nothing and links only to web pages,
 * in a new tab, with no referrer and the host shown.
 */
afterEach(cleanup);

describe.each(['inline', 'block'] as const)('MarkdownText (%s paragraphs)', paragraphs => {
	const renderText = (text: string) =>
		render(<MarkdownText paragraphs={paragraphs}>{text}</MarkdownText>).container;

	it('renders hostile markdown inert', () => {
		const container = renderText(HOSTILE_MARKDOWN);

		const links = expectRenderedTextIsInert(container);
		expect(links.map(link => link.getAttribute('href'))).toEqual([
			'https://news.example/n',
			'https://phish.example/claim',
			'http://www.bare.example/',
		]);
	});

	it('shows an image as its alt text, inside a link when the image was linked', () => {
		const container = renderText(HOSTILE_MARKDOWN);

		expect(container.textContent).toContain('inline alt');
		expect(container.textContent).toContain('reference alt');
		const linked = screen.getByRole('link', { name: 'nested alt' });
		expect(linked.getAttribute('href')).toBe('https://news.example/n');
		// The image URLs are gone; the raw HTML lines stay as the text they were written as.
		['p.png', 'r.png', 'n.png'].forEach(file => expect(container.textContent).not.toContain(file));
	});

	it('shows the host each link leads to', () => {
		renderText('[Claim refund](https://phish.example/claim)');

		const link = screen.getByRole('link', { name: 'Claim refund' });
		expect(shownHostOf(link)).toBe('phish.example');
		// No tooltip: an attribute's value can be read by tools that name an element by them.
		expect(link.hasAttribute('title')).toBe(false);
		expect(link.className).toContain('ph-no-capture');
	});

	it('shows a link whose address carries a user name or password as its text alone', () => {
		const container = renderText(
			'See https://bank.example@evil.example/login and [pay](https://a:b@evil.example/)',
		);

		expect(container.querySelector('a')).toBeNull();
		expect(container.textContent).toContain('pay');
	});

	it('shows the host as the browser reads it when the text names it in other letters', () => {
		// Cyrillic letters that look like Latin ones: the browser goes to the punycode host.
		renderText('[раураl.com](https://раураl.com/) and https://раураl.com/x');

		const links = screen.getAllByRole('link');
		expect(links).toHaveLength(2);
		links.forEach(link => expect(shownHostOf(link)).toMatch(/^xn--/));
	});

	it('shows the host after text that names another host', () => {
		renderText('[news.example](https://evil.example/)');

		expect(shownHostOf(screen.getByRole('link'))).toBe('evil.example');
	});

	it('keeps the shown host apart from the direction of the text before it', () => {
		const container = renderText('[\u202Eexample.good](https://evil.example/)');

		expect(container.querySelector('[data-link-host]')?.tagName).toBe('BDI');
	});

	it('shows text nested too deeply to render as plain text', () => {
		const deep = `${'>'.repeat(20000)} deep`;

		const container = renderText(deep);

		expect(container.querySelector('[data-markdown-fallback]')?.textContent).toBe(deep);
	});

	it('does not repeat the host after a link that already shows its URL', () => {
		renderText('See https://news.example/a today');

		const link = screen.getByRole('link', { name: 'https://news.example/a' });
		expect(shownHostOf(link)).toBeNull();
	});

	it('shows a link with any other scheme as its text alone', () => {
		const container = renderText('[Open me](<blob:https://app.example/1>) and [Top](#top)');

		expect(container.querySelector('a')).toBeNull();
		expect(container.textContent).toContain('Open me');
		expect(container.textContent).toContain('Top');
	});

	it('keeps raw HTML as visible text, never as elements', () => {
		const container = renderText('<b>bold</b> <img src="https://img.example/x.png">');

		expect(container.querySelector('b, img')).toBeNull();
		expect(container.textContent).toContain('<b>bold</b>');
	});

	it('still renders ordinary markdown: emphasis, lists, code and tables', () => {
		const container = renderText(
			'**bold** _em_ `code`\n\n- one\n- two\n\n```\nblock\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |',
		);

		expect(container.querySelector('strong')?.textContent).toBe('bold');
		expect(container.querySelector('em')?.textContent).toBe('em');
		expect(container.querySelectorAll('li')).toHaveLength(2);
		expect(container.querySelector('pre code')?.textContent).toContain('block');
		expect(container.querySelector('table td')?.textContent).toBe('1');
	});

	it('is kept out of analytics capture', () => {
		const container = renderText('Private text');

		expect(container.querySelector('.ph-no-capture')?.textContent).toContain('Private text');
	});
});

describe('MarkdownText paragraphs', () => {
	it('lays an answer out inline and a prompt as blocks, as before', () => {
		const inline = render(<MarkdownText paragraphs="inline">one</MarkdownText>).container;
		expect(inline.querySelector('p')?.className).toContain('inline');
		cleanup();
		const block = render(<MarkdownText paragraphs="block">one</MarkdownText>).container;
		expect(block.querySelector('p')?.className ?? '').not.toContain('inline');
	});
});
