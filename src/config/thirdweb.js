import { createThirdwebClient, defineChain } from 'thirdweb';
import { createWallet, inAppWallet, walletConnect } from 'thirdweb/wallets';

const clientId = import.meta.env.VITE_THIRDWEB_CLIENT_ID;

if (!clientId) {
	throw new Error('No client ID provided');
}

export const client = createThirdwebClient({
	clientId,
});

// Define your local Hardhat chain
export const localChain = defineChain({
	id: 31337,
	rpc: 'http://127.0.0.1:8545',
	nativeCurrency: {
		name: 'Hardhat Localnet',
		symbol: 'HardhatETH',
		decimals: 18,
	},
});

// This is our curated, production-ready list of wallet options.
export const wallets = [
	// 1. Embedded Wallet (Email, Socials, Passkeys, Phone) - The top priority for new users.
	inAppWallet({
		auth: {
			options: ['email', 'google', 'apple', 'facebook', 'passkey'],
		},
	}),

	// 2. Recommended External Wallets for browser extension users.
	createWallet('io.metamask'),
	createWallet('com.coinbase.wallet'),

	// 3. The universal connector for all other mobile and desktop wallets.
	walletConnect(),
];
