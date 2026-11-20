import { describe, expect, it } from 'vitest';

import { FEE_TOKEN_PROFILES } from './feeToken';
import { walletDetailsModal } from './walletPanel';

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
});
