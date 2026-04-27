import { useActiveWallet, useWalletBalance } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { client } from '@/config/thirdweb';

/**
 * Generates the exact query key used by the `useWalletBalance` hook for precise invalidation.
 * @param {number} chainId The ID of the chain.
 * @param {string} walletAddress The address of the wallet.
 * @param {string} tokenAddress The address of the token contract.
 * @returns {Array} The query key array.
 */
export const getTokenBalanceQueryKey = (
	chainId: number | undefined,
	walletAddress: string | undefined,
	tokenAddress: string | undefined,
) => ['walletBalance', chainId || -1, walletAddress || '0x0', { tokenAddress }];

export default function useTokenBalance(
	chainId: number | undefined,
	walletAddress: string | undefined,
) {
	const activeWallet = useActiveWallet();

	const contractConfig = chainId ? CONTRACTS[chainId] : undefined;
	const tokenAddress = contractConfig?.token?.address;
	console.log(
		'activeWallet',
		activeWallet,
		'contractConfig',
		contractConfig,
		'tokenAddress',
		tokenAddress,
	);

	return useWalletBalance({
		client,
		chain: activeWallet?.getChain(),
		address: walletAddress,
		tokenAddress,
	});
}
