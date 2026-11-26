import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectRenderedTextIsInert, HOSTILE_LINKS, shownHostOf } from '@/test/hostileMarkdown';

import EarlierAttempt from './earlier-attempt';
import { Source } from './source';

/**
 * A source URL comes from a decrypted frame or the stored answer file: only an http or https
 * URL becomes a link, opened in a new tab with no referrer and its host shown; anything else
 * shows its title as plain text.
 */
// Built from parts: the linter refuses a script URL written out, even in a test.
const UNSAFE = [
	['javascript', 'alert(1)'].join(':'),
	['JaVaScRiPt', 'alert(1)'].join(':'),
	'data:text/html,<script>alert(1)</script>',
	'/relative/path',
	...Object.values(HOSTILE_LINKS),
];

afterEach(cleanup);

describe('Source', () => {
	it('links an https URL', () => {
		const { container } = render(<Source href="https://news.example/a" title="News" />);

		const link = screen.getByRole('link', { name: 'News' });
		expect(link.getAttribute('href')).toBe('https://news.example/a');
		expect(shownHostOf(link)).toBe('news.example');
		expectRenderedTextIsInert(container);
	});

	it.each(UNSAFE)('shows %s as plain text, not a link', href => {
		render(<Source href={href} title="Unsafe" />);

		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.getByText('Unsafe')).toBeTruthy();
		expect(document.querySelector('[href]')).toBeNull();
	});
});

describe('EarlierAttempt', () => {
	const open = () => fireEvent.click(screen.getByRole('button', { name: /Earlier attempt/ }));

	it('links an https source', () => {
		const { container } = render(
			<EarlierAttempt steps={[]} sources={[{ title: 'News', url: 'https://news.example' }]} />,
		);
		open();

		const link = screen.getByRole('link', { name: 'News' });
		expect(link.getAttribute('href')).toBe('https://news.example/');
		expect(shownHostOf(link)).toBe('news.example');
		expectRenderedTextIsInert(container);
	});

	it.each(UNSAFE)('shows a source of %s as plain text, not a link', url => {
		render(<EarlierAttempt steps={[]} sources={[{ title: 'Unsafe', url }]} />);
		open();

		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.getByText('Unsafe')).toBeTruthy();
		expect(document.querySelector('[href]')).toBeNull();
	});
});
