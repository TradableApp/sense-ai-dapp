import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FEE_TOKEN_PROFILES, type FeeTokenProfile } from '@/config/feeToken';

import InsufficientBalanceNotice from './InsufficientBalanceNotice';

const { SENSE, ABLE } = FEE_TOKEN_PROFILES;

afterEach(cleanup);

const TESTNET_OFFER = { label: 'Get 100 Testnet tokens', onRequest: vi.fn(async () => undefined) };

const renderNotice = (
	profile: FeeTokenProfile = SENSE,
	faucetOffer: typeof TESTNET_OFFER | null = null,
) => render(<InsufficientBalanceNotice profile={profile} faucetOffer={faucetOffer} />);

describe('InsufficientBalanceNotice', () => {
	it('points to the community for a token that cannot be got in the app, with no faucet', () => {
		renderNotice(SENSE);

		expect(screen.getAllByRole('link')).toHaveLength(2);
		expect(screen.queryByRole('button')).toBeNull();
	});

	it('offers the faucet instead where there is one', () => {
		renderNotice(SENSE, TESTNET_OFFER);

		expect(screen.getByRole('button', { name: TESTNET_OFFER.label })).toBeTruthy();
		expect(screen.queryAllByRole('link')).toEqual([]);
	});

	it('shows no links for a token that can be bought', () => {
		renderNotice(ABLE);

		expect(screen.queryAllByRole('link')).toEqual([]);
		expect(document.body.textContent).toContain(`You need more ${ABLE.symbol}`);
	});
});
