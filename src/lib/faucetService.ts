import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';
import { encodeFunctionData, erc20Abi, parseUnits } from 'viem';

import { LOCAL_CHAIN_ID } from '@/config/contracts';
import { functions } from '@/config/firebase';

import type { FaucetResponse } from './types';

interface FaucetCallableResult {
	success: boolean;
	txHash?: string;
	message?: string;
}

// Localnet "treasury": Hardhat account #0 holds the full ABLE supply and is
// unlocked on the local node, so eth_sendTransaction needs no signature. This is
// the localnet equivalent of the testnet faucet — on localnet we NEVER call the
// Firebase cloud function (which dispenses Base Sepolia tokens).
const HARDHAT_DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
/** Amount of ABLE the faucet dispenses per request (testnet + localnet). */
export const FAUCET_AMOUNT_ABLE = 100;

const isLocalnet = (): boolean => Number(import.meta.env.VITE_CHAIN_ID) === LOCAL_CHAIN_ID;

/**
 * Fund the user by transferring ABLE from the unlocked Hardhat deployer directly
 * over JSON-RPC. No cloud function, no signature — returns the same
 * { success, txHash } shape as the testnet faucet so the caller's receipt-polling
 * works unchanged.
 */
const fundFromLocalnetTreasury = async (walletAddress: string): Promise<FaucetResponse> => {
	const rpcUrl = import.meta.env.VITE_CHAIN_RPC_URL as string;
	const tokenAddress = import.meta.env.VITE_TOKEN_CONTRACT_ADDRESS as string;

	const data = encodeFunctionData({
		abi: erc20Abi,
		functionName: 'transfer',
		args: [walletAddress as `0x${string}`, parseUnits(String(FAUCET_AMOUNT_ABLE), 18)],
	});

	const response = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'eth_sendTransaction',
			params: [{ from: HARDHAT_DEPLOYER, to: tokenAddress, data }],
		}),
	});

	const json = (await response.json()) as { result?: string; error?: { message: string } };
	if (json.error) throw new Error(json.error.message);
	if (!json.result) throw new Error('Localnet faucet returned no transaction hash');

	return { success: true, txHash: json.result };
};

const requestTestTokens = async (walletAddress: string): Promise<FaucetResponse> => {
	try {
		// On localnet the "faucet" is a direct deployer transfer; on testnet it is
		// the Firebase cloud function. Mainnet has no faucet (treasury-funded).
		if (isLocalnet()) {
			return await fundFromLocalnetTreasury(walletAddress);
		}

		if (!functions) throw new Error('Firebase functions not initialized');
		const faucetFunction = httpsCallable(functions, 'requestTestTokens');

		const result = await faucetFunction({ walletAddress });
		const data = result.data as FaucetCallableResult;

		if (data.success) {
			// We handle the "Success" toast in the component now,
			// so we can add the Explorer Link and Loading state there.
			return { success: true, txHash: data.txHash };
		}

		throw new Error(data.message || 'Faucet failed');
	} catch (error) {
		console.error('[faucetService] Error:', error);
		// Handle specific rate limit messages nicely
		if (error instanceof Error && error.message.includes('rate limit')) {
			toast.error('Rate Limit Exceeded', {
				description: 'You can only request tokens once every 24 hours.',
			});
		} else {
			toast.error('Faucet Failed', {
				description: 'Could not dispense tokens. Please try again later.',
			});
		}

		return { success: false };
	}
};

export default requestTestTokens;
