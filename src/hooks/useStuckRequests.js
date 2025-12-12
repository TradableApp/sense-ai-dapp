import { useQuery } from '@tanstack/react-query';
import { GraphQLClient } from 'graphql-request';
import { getContract, readContract } from 'thirdweb';
import { useActiveWallet } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { client } from '@/config/thirdweb';
import { GET_STUCK_PAYMENTS_QUERY } from '@/lib/graph/queries';

const THE_GRAPH_API_URL = import.meta.env.VITE_THE_GRAPH_API_URL;
const graphQLClient = new GraphQLClient(THE_GRAPH_API_URL);

export default function useStuckRequests() {
	const activeWallet = useActiveWallet();
	const ownerAddress = activeWallet?.getAccount()?.address;
	const chain = activeWallet?.getChain();
	const chainId = chain?.id;

	return useQuery({
		queryKey: ['stuckRequests', chainId, ownerAddress],
		queryFn: async () => {
			if (!THE_GRAPH_API_URL || !ownerAddress) {
				return [];
			}

			try {
				const variables = { user: ownerAddress.toLowerCase() };
				const data = await graphQLClient.request(GET_STUCK_PAYMENTS_QUERY, variables);
				const candidates = data.payments || [];
				console.log('candidates', candidates);

				if (candidates.length === 0) {
					return [];
				}

				// 2. Verify against Contract State (Double Check)
				// This filters out "Zombie" graph entities that are actually complete on-chain
				const contractConfig = CONTRACTS[chainId];

				if (!contractConfig?.escrow) {
					return [];
				}

				const escrowContract = getContract({
					client,
					chain,
					address: contractConfig.escrow.address,
					abi: contractConfig.escrow.abi,
				});

				// Fetch status for all candidates in parallel
				const verifiedRequests = await Promise.all(
					candidates.map(async p => {
						try {
							const escrowInfo = await readContract({
								contract: escrowContract,
								method: 'escrows',
								params: [p.id],
							});
							console.log('escrowInfo', escrowInfo);

							// EscrowStatus: 0=PENDING, 1=COMPLETE, 2=REFUNDED
							// We only want status 0 (PENDING)
							if (Number(escrowInfo[3]) !== 0) {
								return null;
							}

							const createdAtMs = Number(p.createdAt) * 1000;
							const ONE_HOUR = 60 * 60 * 1000;
							const isRefundable = Date.now() > createdAtMs + ONE_HOUR;

							return {
								...p,
								id: p.id,
								createdAt: createdAtMs,
								isRefundable,
							};
						} catch (e) {
							console.log('e', e);

							return null;
						}
					}),
				);

				return verifiedRequests.filter(Boolean);
			} catch (error) {
				console.error('[useStuckRequests] Failed to fetch:', error);
				return [];
			}
		},
		enabled: !!ownerAddress && !!THE_GRAPH_API_URL,
		// Polling: Check every 15 seconds to see if status changed or 1h timer expired
		refetchInterval: 15000,
	});
}
