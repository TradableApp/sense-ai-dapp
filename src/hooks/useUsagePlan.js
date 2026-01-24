import { useQuery } from '@tanstack/react-query';
import { ethers } from 'ethers';
import { getContract, readContract } from 'thirdweb';
import { useActiveWallet } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { client } from '@/config/thirdweb';

/**
 * A custom hook to fetch all relevant data for the user's usage plan
 * from the EVMAIAgentEscrow smart contract, AND the raw ERC20 allowance.
 *
 * @returns {import('@tanstack/react-query').UseQueryResult<{
 *   allowance: number,
 *   spentAmount: number,
 *   expiresAt: Date,
 *   pendingEscrowCount: number,
 *   realTokenAllowance: number The actual ERC20 allowance
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

			// Get Token Contract to check raw allowance
			const tokenContract = getContract({
				client,
				chain,
				address: contractConfig.token.address,
				abi: contractConfig.token.abi,
			});

			const spendingLimitsAbi = contractConfig?.escrow.abi.find(
				item => item.name === 'spendingLimits' && item.type === 'function',
			);

			const pendingEscrowCountAbi = contractConfig?.escrow.abi.find(
				item => item.name === 'pendingEscrowCount' && item.type === 'function',
			);

			const allowanceAbi = contractConfig.token.abi.find(
				item => item.name === 'allowance' && item.type === 'function',
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
				'allowanceAbi',
				allowanceAbi,
			);

			// Perform read calls in parallel for efficiency.
			const [spendingLimitData, pendingEscrowCount, rawTokenAllowance] = await Promise.all([
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
				readContract({
					contract: tokenContract,
					method: allowanceAbi,
					params: [ownerAddress, contractConfig.escrow.address],
				}),
			]);
			console.log(
				'spendingLimitData',
				spendingLimitData,
				'pendingEscrowCount',
				pendingEscrowCount,
				'rawTokenAllowance',
				rawTokenAllowance,
			);

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
				realTokenAllowance: Number(ethers.formatEther(rawTokenAllowance)),
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
