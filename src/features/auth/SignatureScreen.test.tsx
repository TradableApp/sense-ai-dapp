import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionSiteFor } from '@/features/auth/sessionMessage';
import SignatureScreen from '@/features/auth/SignatureScreen';

const { session } = vi.hoisted(() => ({ session: { status: 'deriving' } }));

vi.mock('thirdweb/react', () => ({ ConnectButton: () => null }));
vi.mock('@/config/thirdweb', () => ({ client: {}, deploymentChain: {}, wallets: [] }));
vi.mock('@/config/contracts', () => ({ SUPPORTED_TOKENS: {} }));
vi.mock('@/config/walletPanel', () => ({ DISPLAY_BALANCE_TOKEN: {}, WALLET_DETAILS_MODAL: {} }));
vi.mock('@/features/auth/SessionProvider', () => ({ useSession: () => session }));

const SITE = sessionSiteFor(import.meta.env.MODE) as string;
const HOST = new URL(SITE).host;

const renderAs = (status: string) => {
	session.status = status;
	return render(<SignatureScreen onRetry={() => {}} />);
};

describe('SignatureScreen', () => {
	afterEach(cleanup);

	it.each(['deriving', 'rejected', 'error'])(
		'does not promise a message the wallet may not show (%s)',
		status => {
			renderAs(status);
			const text = screen.getByTestId('session-message-site').textContent ?? '';

			expect(text).not.toMatch(/will show/i);
			expect(text).toMatch(/if your wallet shows/i);
			expect(text).toContain(HOST);
			expect(text).toMatch(/without showing/i);
		},
	);

	it('points to the site the message names when the page is elsewhere, and asks nothing', () => {
		renderAs('wrong-site');

		const link = screen.getByRole('link', { name: new RegExp(HOST) });
		expect(link.getAttribute('href')).toBe(SITE);
		expect(screen.getByText(/SenseAI is at/i)).toBeTruthy();
		expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
		expect(screen.queryByText(/waiting for signature/i)).toBeNull();
	});

	it('asks for another wallet when this one cannot create the key', () => {
		renderAs('unsupported-wallet');

		expect(screen.getByTestId('unsupported-wallet').textContent).toMatch(
			/cannot create the key.*connect another wallet/i,
		);
		expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
	});

	it('keeps the retry for a declined signature', () => {
		renderAs('rejected');

		expect(screen.getByText(/signature was declined/i)).toBeTruthy();
		expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
	});
});
