import { useQuery } from '@tanstack/react-query';
import { ethers } from 'ethers';
import { getContract, readContract } from 'thirdweb';
import { useActiveWallet } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { client } from '@/config/thirdweb';

/**
 * A custom hook to fetch all relevant data for the user's usage plan
 * from the EVMAIAgentEscrow smart contract.
 *
 * @returns {import('@tanstack/react-query').UseQueryResult<{
 *   allowance: number,
 *   spentAmount: number,
 *   expiresAt: Date,
 *   pendingEscrowCount: number
 * }|null, Error>} The result object from React Query.
 */
export default function useUsagePlan() {
	const activeWallet = useActiveWallet();
	const ownerAddress = activeWallet?.getAccount()?.address;
	const chain = activeWallet?.getChain();

	return useQuery({
		// The query key now correctly includes all dependencies that should trigger a refetch.
		queryKey: ['usagePlan', chain?.id, ownerAddress],
		queryFn: async () => {
			// All data fetching logic now lives inside the query function.
			// This function is re-run completely whenever the query is invalidated.
			if (!chain || !ownerAddress) {
				return null; // Not ready to fetch yet.
			}

			const contractConfig = CONTRACTS[chain.id];
			if (!contractConfig?.escrow) {
				return null; // Contracts not deployed on this chain.
			}

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi,
			});

			const spendingLimitsAbi = contractConfig?.escrow.abi.find(
				item => item.name === 'spendingLimits' && item.type === 'function',
			);

			const pendingEscrowCountAbi = contractConfig?.escrow.abi.find(
				item => item.name === 'pendingEscrowCount' && item.type === 'function',
			);
			console.log(
				'contractConfig',
				contractConfig,
				'escrowContract',
				escrowContract,
				'spendingLimitsAbi',
				spendingLimitsAbi,
				'pendingEscrowCountAbi',
				pendingEscrowCountAbi,
			);

			// Perform the two read calls in parallel for efficiency.
			const [spendingLimitData, pendingEscrowCount] = await Promise.all([
				readContract({
					contract: escrowContract,
					method: spendingLimitsAbi,
					params: [ownerAddress],
				}),
				readContract({
					contract: escrowContract,
					method: pendingEscrowCountAbi,
					params: [ownerAddress],
				}),
			]);
			console.log('spendingLimitData', spendingLimitData, 'pendingEscrowCount', pendingEscrowCount);

			const [allowance, spentAmount, expiresAt] = spendingLimitData || [];
			console.log('allowance', allowance, 'spentAmount', spentAmount, 'expiresAt', expiresAt);

			// The hook returns an array of results, so we check the third element (expiresAt).
			if (!expiresAt || expiresAt === 0n) {
				return null;
			}

			// Use ethers.formatEther to convert from wei (BigInt) to a human-readable number string, then convert to Number.
			const plan = {
				allowance: Number(ethers.formatEther(allowance)),
				spentAmount: Number(ethers.formatEther(spentAmount)),
				expiresAt: new Date(Number(expiresAt) * 1000),
				pendingEscrowCount: Number(pendingEscrowCount || 0),
			};
			console.log('plan', plan);

			return plan;
		},
		// The query is enabled only when we have everything we need to fetch.
		enabled: !!activeWallet && !!ownerAddress && !!chain,
		// We still get all the benefits of useQuery.
		staleTime: 60 * 1000, // 1 minute
		refetchOnWindowFocus: true,
	});
}
