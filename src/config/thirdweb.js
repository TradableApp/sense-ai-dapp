import { createThirdwebClient, defineChain } from 'thirdweb';
import { createWallet, inAppWallet, walletConnect } from 'thirdweb/wallets';

import { LOCAL_CHAIN_ID, TESTNET_CHAIN_ID } from './contracts';

const clientId = import.meta.env.VITE_THIRDWEB_CLIENT_ID;

if (!clientId) {
	throw new Error('No client ID provided');
}

export const client = createThirdwebClient({
	clientId,
});

// Determine the Chain ID from environment
const envChainId = Number(import.meta.env.VITE_CHAIN_ID);
console.log('envChainId', envChainId);

// Define the chain configuration
export const deploymentChain = defineChain({
	id: envChainId,
	name: import.meta.env.VITE_CHAIN_NAME || 'Base',
	// The slug is important for some Thirdweb internal routing
	slug: import.meta.env.VITE_CHAIN_SLUG || 'base',
	rpc: import.meta.env.VITE_CHAIN_RPC_URL,
	nativeCurrency: {
		name: import.meta.env.VITE_CHAIN_NATIVE_CURRENCY_NAME || 'Ether',
		symbol: import.meta.env.VITE_CHAIN_NATIVE_CURRENCY_SYMBOL || 'ETH',
		decimals: Number(import.meta.env.VITE_CHAIN_NATIVE_CURRENCY_DECIMALS) || 18,
	},
	blockExplorers: [
		{
			name: import.meta.env.VITE_BLOCK_EXPLORER_NAME || 'Explorer',
			url: import.meta.env.VITE_BLOCK_EXPLORER_URL,
			// The API URL is optional but recommended for contract verification status
			apiUrl: import.meta.env.VITE_BLOCK_EXPLORER_API_URL || undefined,
		},
	],
	testnet: envChainId === LOCAL_CHAIN_ID || envChainId === TESTNET_CHAIN_ID,
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
