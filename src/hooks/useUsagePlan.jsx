import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';
import { ethers } from 'ethers';
import { getContract } from 'thirdweb';
import { useActiveWallet, useReadContract } from 'thirdweb/react';

import CONTRACTS from '@/config/contracts';
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

	const chainId = activeWallet?.getChain()?.id || 31337;
	const contractConfig = CONTRACTS[chainId];

	const escrowContract = useMemo(() => {
		if (!contractConfig?.escrow) {
			return null;
		}

		return getContract({
			client,
			chain: { id: chainId },
			address: contractConfig.escrow.address,
			abi: contractConfig.escrow.abi,
		});
	}, [chainId, contractConfig]);

	const { data: subscriptionData, isLoading: isLoadingSubscription } = useReadContract({
		contract: escrowContract,
		method: 'subscriptions',
		params: [ownerAddress],
		queryOptions: {
			enabled: !!ownerAddress && !!escrowContract,
		},
	});

	const { data: pendingEscrowCount, isLoading: isLoadingPending } = useReadContract({
		contract: escrowContract,
		method: 'pendingEscrowCount',
		params: [ownerAddress],
		queryOptions: {
			enabled: !!ownerAddress && !!escrowContract,
		},
	});

	return useQuery({
		queryKey: ['usagePlan', ownerAddress, chainId, subscriptionData, pendingEscrowCount],
		queryFn: () => {
			if (!subscriptionData || subscriptionData.expiresAt === 0n) {
				return null;
			}

			// Use ethers.formatEther to convert from wei (BigInt) to a human-readable number string, then convert to Number.
			const plan = {
				allowance: Number(ethers.formatEther(subscriptionData.allowance)),
				spentAmount: Number(ethers.formatEther(subscriptionData.spentAmount)),
				expiresAt: new Date(Number(subscriptionData.expiresAt) * 1000),
				pendingEscrowCount: Number(pendingEscrowCount || 0),
			};

			return plan;
		},
		enabled:
			!!ownerAddress &&
			!!escrowContract &&
			!isLoadingSubscription &&
			!isLoadingPending &&
			subscriptionData !== undefined,
	});
}
