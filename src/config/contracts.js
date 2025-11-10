import AbleTokenABI from '@/lib/abi/AbleToken.json';
import EVMAIAgentABI from '@/lib/abi/EVMAIAgent.json';
import EVMAIAgentEscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';

// --- Chain ID Configuration ---
// Default hardhat network
const LOCAL_CHAIN_ID = 31337;
// Base Sepolia Testnet
const BASE_SEPOLIA_CHAIN_ID = 84532;

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
const CONTRACTS = {
	[LOCAL_CHAIN_ID]: {
		// These are placeholders. We will paste the real local addresses here after deployment.
		token: {
			address: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512', // Example address
			abi: AbleTokenABI.abi,
		},
		escrow: {
			address: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707', // Example address
			abi: EVMAIAgentEscrowABI.abi,
		},
		agent: {
			address: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9', // Example address
			abi: EVMAIAgentABI.abi,
		},
	},
	[BASE_SEPOLIA_CHAIN_ID]: {
		// These will be populated from environment variables during the build process.
		token: {
			address: import.meta.env.VITE_TOKEN_CONTRACT_ADDRESS,
			abi: AbleTokenABI.abi,
		},
		escrow: {
			address: import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS,
			abi: EVMAIAgentEscrowABI.abi,
		},
		agent: {
			address: import.meta.env.VITE_AGENT_CONTRACT_ADDRESS,
			abi: EVMAIAgentABI.abi,
		},
	},
};

export default CONTRACTS;
