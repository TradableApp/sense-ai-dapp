import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { COMMUNITY_LINKS } from '@/config/communityLinks';

import CommunityLinksNotice from './CommunityLinksNotice';

afterEach(cleanup);

describe('CommunityLinksNotice', () => {
	it('says the wallet has none yet and links to SenseAI on X and the Telegram group', () => {
		render(<CommunityLinksNotice symbol="PTS" hasNone />);

		expect(document.body.textContent).toContain('You have no PTS yet.');
		expect(document.body.textContent).toMatch(/to find out how to get some\./);
		const x = screen.getByRole('link', { name: 'SenseAI on X' });
		const telegram = screen.getByRole('link', { name: 'the SenseAI Telegram group' });
		expect(x.getAttribute('href')).toBe('https://x.com/SenseAI_agent');
		expect(telegram.getAttribute('href')).toBe('https://t.me/tradable_community');
		[x, telegram].forEach(link => {
			expect(link.getAttribute('target')).toBe('_blank');
			expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		});
	});

	it('says only that it is not enough when the balance is not known to be zero', () => {
		render(<CommunityLinksNotice symbol="PTS" hasNone={false} />);

		expect(document.body.textContent).toContain('You do not have enough PTS.');
		expect(document.body.textContent).not.toContain('You have no');
	});

	it('takes its links from the one config module', () => {
		render(<CommunityLinksNotice symbol="PTS" hasNone />);

		expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
			COMMUNITY_LINKS.x.href,
			COMMUNITY_LINKS.telegram.href,
		]);
	});

	it('names no price, value or comparison', () => {
		render(<CommunityLinksNotice symbol="PTS" hasNone />);

		expect(document.body.textContent).not.toMatch(/\$|USD|price|value|worth/i);
	});
});
