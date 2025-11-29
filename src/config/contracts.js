import ableTokenLogo from '@/assets/able-token-logo.svg';
import AbleTokenABI from '@/lib/abi/AbleToken.json';
import EVMAIAgentABI from '@/lib/abi/EVMAIAgent.json';
import EVMAIAgentEscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';

export const LOCAL_CHAIN_ID = 31337; // Hardhat
export const TESTNET_CHAIN_ID = 84532; // Base Sepolia

/**
 * @typedef {Object} ContractConfig
 * @property {string} address
 * @property {any} abi - The Application Binary Interface (ABI) of the contract.
 */

/**
 * @typedef {Object.<number, {
 *   token: ContractConfig,
 *   escrow: ContractConfig,
 *   agent: ContractConfig
 * }>} ContractMap
 */

/**
 * A centralized object containing all contract configurations, keyed by chainId.
 * We use a function to dynamically select the right configuration based on the environment.
 * @type {ContractMap}
 */
export const CONTRACTS = {
	[import.meta.env.VITE_CHAIN_ID]: {
		// These will be populated from environment variables during the build process.
		token: {
			address: import.meta.env.VITE_TOKEN_CONTRACT_ADDRESS,
			abi: AbleTokenABI.abi,
		},
		agent: {
			address: import.meta.env.VITE_AGENT_CONTRACT_ADDRESS,
			abi: EVMAIAgentABI.abi,
		},
		escrow: {
			address: import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS,
			abi: EVMAIAgentEscrowABI.abi,
		},
	},
};

export const SUPPORTED_TOKENS = {
	[import.meta.env.VITE_CHAIN_ID]: [
		{
			address: import.meta.env.VITE_TOKEN_CONTRACT_ADDRESS,
			name: 'ABLE Token',
			symbol: 'ABLE',
			icon: ableTokenLogo,
		},
	],
};
