import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';
import { encodeFunctionData, erc20Abi, parseUnits } from 'viem';

import { LOCAL_CHAIN_ID } from '@/config/contracts';
import { db, functions } from '@/config/firebase';

import type { FaucetConfig, FaucetResponse } from './types';

interface FaucetCallableResult {
	success: boolean;
	txHash?: string;
	message?: string;
	amount?: number;
}

// Localnet "treasury": Hardhat account #0 holds the full ABLE supply and is
// unlocked on the local node, so eth_sendTransaction needs no signature. This is
// the localnet equivalent of the testnet faucet — on localnet we NEVER call the
// Firebase cloud function (which dispenses Base Sepolia tokens).
const HARDHAT_DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
/** Default ABLE per request when the Firestore config is unavailable. */
export const FAUCET_AMOUNT_ABLE = 100;
const DEFAULT_RATE_LIMIT_HOURS = 24;
// Mirror the cloud function's circuit breaker so the displayed/transferred amount
// matches what the server will actually dispense.
const MAX_FAUCET_AMOUNT = 10_000;

/**
 * Coerce a config value to a sane positive number; fall back to `fallback` for
 * 0 / negative / NaN / non-numeric / out-of-range (the `??` operator only guards
 * null/undefined, so a fat-fingered 0 or "abc" would otherwise slip through).
 */
const sanitizePositive = (raw: unknown, fallback: number, max = Number.POSITIVE_INFINITY): number => {
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 && n <= max ? n : fallback;
};

const isLocalnet = (): boolean => Number(import.meta.env.VITE_CHAIN_ID) === LOCAL_CHAIN_ID;

/**
 * Read the live faucet config from Firestore (general/sense_ai.faucet). The amount
 * and rate limit are adjustable without a redeploy so dispensing can be throttled
 * when the testnet is busy; falls back to defaults if the doc/fields are absent.
 */
export const getFaucetConfig = async (): Promise<FaucetConfig> => {
	const defaults: FaucetConfig = {
		amount: FAUCET_AMOUNT_ABLE,
		rateLimitHours: DEFAULT_RATE_LIMIT_HOURS,
	};
	if (!db) return defaults;
	try {
		const snap = await getDoc(doc(db, 'general', 'sense_ai'));
		const faucet = (snap.exists() ? snap.data()?.faucet : null) ?? {};
		return {
			amount: sanitizePositive(faucet.amount, FAUCET_AMOUNT_ABLE, MAX_FAUCET_AMOUNT),
			rateLimitHours: sanitizePositive(faucet.rateLimitHours, DEFAULT_RATE_LIMIT_HOURS),
		};
	} catch (error) {
		console.error('[faucetService] Failed to read faucet config:', error);
		return defaults;
	}
};

/**
 * Fund the user by transferring ABLE from the unlocked Hardhat deployer directly
 * over JSON-RPC. No cloud function, no signature — returns the same
 * { success, txHash, amount } shape as the testnet faucet so the caller's
 * receipt-polling and display work unchanged.
 */
const fundFromLocalnetTreasury = async (walletAddress: string): Promise<FaucetResponse> => {
	const rpcUrl = import.meta.env.VITE_CHAIN_RPC_URL as string;
	const tokenAddress = import.meta.env.VITE_TOKEN_CONTRACT_ADDRESS as string;
	const { amount } = await getFaucetConfig();

	const data = encodeFunctionData({
		abi: erc20Abi,
		functionName: 'transfer',
		args: [walletAddress as `0x${string}`, parseUnits(String(amount), 18)],
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

	return { success: true, txHash: json.result, amount };
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
			// The cloud function reports the amount it dispensed; surface it so the
			// UI shows the real value (it is adjustable via general/sense_ai.faucet).
			return { success: true, txHash: data.txHash, amount: data.amount };
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
