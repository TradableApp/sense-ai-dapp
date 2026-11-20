import { describe, expect, it } from 'vitest';

import { FEE_TOKEN, FEE_TOKEN_PROFILES } from './feeToken';
import { WALLET_DETAILS_MODAL, walletDetailsModal } from './walletPanel';

describe('walletDetailsModal', () => {
	it('offers neither send nor buy for a token that can be neither sent nor bought', () => {
		expect(walletDetailsModal(FEE_TOKEN_PROFILES.SENSE)).toMatchObject({
			hideSendFunds: true,
			hideBuyFunds: true,
		});
	});

	it('offers both for a token that can be sent and bought', () => {
		expect(walletDetailsModal(FEE_TOKEN_PROFILES.ABLE)).toMatchObject({
			hideSendFunds: false,
			hideBuyFunds: false,
		});
	});

	it.each(Object.values(FEE_TOKEN_PROFILES))(
		'keeps receive and the testnet faucet ($symbol)',
		p => {
			const modal = walletDetailsModal(p);

			expect(modal.showTestnetFaucet).toBe(true);
			expect(modal.hideReceiveFunds).toBeUndefined();
		},
	);

	// The two shipped profiles set both flags alike, so only a mixed one shows which flag
	// drives which button.
	it('ties send to transferable and buy to purchasable, each on its own', () => {
		const sendOnly = { ...FEE_TOKEN_PROFILES.ABLE, purchasable: false };
		const buyOnly = { ...FEE_TOKEN_PROFILES.ABLE, transferable: false };

		expect(walletDetailsModal(sendOnly)).toMatchObject({
			hideSendFunds: false,
			hideBuyFunds: true,
		});
		expect(walletDetailsModal(buyOnly)).toMatchObject({ hideSendFunds: true, hideBuyFunds: false });
	});

	it("the shared settings are the build's own fee token's", () => {
		expect(WALLET_DETAILS_MODAL).toEqual(walletDetailsModal(FEE_TOKEN));
	});
});
