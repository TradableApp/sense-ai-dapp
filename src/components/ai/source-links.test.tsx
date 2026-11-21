import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import EarlierAttempt from './earlier-attempt';
import { Source } from './source';

/**
 * A source URL comes from a decrypted frame or the stored answer file: only an http or https
 * URL becomes a link; anything else shows its title as plain text.
 */
const UNSAFE = [
	'javascript:alert(1)',
	'JaVaScRiPt:alert(1)',
	'data:text/html,<script>alert(1)</script>',
	'/relative/path',
];

afterEach(cleanup);

describe('Source', () => {
	it('links an https URL', () => {
		render(<Source href="https://news.example/a" title="News" />);

		expect(screen.getByRole('link', { name: 'News' }).getAttribute('href')).toBe(
			'https://news.example/a',
		);
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
		render(<EarlierAttempt steps={[]} sources={[{ title: 'News', url: 'https://news.example' }]} />);
		open();

		expect(screen.getByRole('link', { name: 'News' }).getAttribute('href')).toBe(
			'https://news.example',
		);
	});

	it.each(UNSAFE)('shows a source of %s as plain text, not a link', url => {
		render(<EarlierAttempt steps={[]} sources={[{ title: 'Unsafe', url }]} />);
		open();

		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.getByText('Unsafe')).toBeTruthy();
		expect(document.querySelector('[href]')).toBeNull();
	});
});
