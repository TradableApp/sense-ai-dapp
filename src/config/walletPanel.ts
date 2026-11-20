import { FEE_TOKEN, type FeeTokenProfile } from './feeToken';

/**
 * Settings for the wallet panel that opens from the connected-wallet button, shared by
 * every place the button is rendered.
 *
 * The panel's send and buy buttons follow the fee token: a token that cannot be sent would
 * fail every send with a wallet error, and a buy button beside a token that is never sold
 * suggests it can be bought. Receive and the testnet faucet link are unaffected.
 */
export function walletDetailsModal(profile: FeeTokenProfile) {
	return {
		showTestnetFaucet: true,
		hideSendFunds: !profile.transferable,
		hideBuyFunds: !profile.purchasable,
	} as {
		showTestnetFaucet: boolean;
		hideSendFunds: boolean;
		hideBuyFunds: boolean;
		hideReceiveFunds?: boolean;
	};
}

export const WALLET_DETAILS_MODAL = walletDetailsModal(FEE_TOKEN);

/** The balance shown on the connected-wallet button: the fee token's, per chain. */
export const DISPLAY_BALANCE_TOKEN = {
	[import.meta.env.VITE_CHAIN_ID]: import.meta.env.VITE_TOKEN_CONTRACT_ADDRESS,
};
