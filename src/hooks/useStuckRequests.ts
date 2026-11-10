import { useQuery } from '@tanstack/react-query';
import { GraphQLClient } from 'graphql-request';
import { getContract, readContract } from 'thirdweb';
import { useActiveWallet } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { client } from '@/config/thirdweb';
import { REFUND_TIMEOUT_MS } from '@/lib/constants';
import { GET_STUCK_PAYMENTS_QUERY } from '@/lib/graph/queries';
import type {
	GetStuckPaymentsQuery,
	GetStuckPaymentsQueryVariables,
} from '@/lib/graph/query-types';

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
				const variables: GetStuckPaymentsQueryVariables = { user: ownerAddress.toLowerCase() };
				const data = await graphQLClient.request<GetStuckPaymentsQuery>(
					GET_STUCK_PAYMENTS_QUERY,
					variables,
				);
				const candidates = data.payments || [];
				console.log('candidates', candidates);

				if (candidates.length === 0) {
					return [];
				}

				// 2. Verify against Contract State (Double Check)
				// This filters out "Zombie" graph entities that are actually complete on-chain
				if (!chainId) {
					return [];
				}
				const contractConfig = CONTRACTS[chainId];

				if (!contractConfig?.escrow || !chain) {
					return [];
				}

				const escrowContract = getContract({
					client,
					chain,
					address: contractConfig.escrow.address,
					abi: contractConfig.escrow.abi as Parameters<typeof getContract>[0]['abi'],
				});

				// Fetch status for all candidates in parallel
				const verifiedRequests = await Promise.all(
					candidates.map(async p => {
						try {
							const escrowInfo = await readContract({
								contract: escrowContract,
								method: 'escrows' as any,
								params: [p.id],
							});
							console.log('escrowInfo', escrowInfo);

							// EscrowStatus: 0=PENDING, 1=COMPLETE, 2=REFUNDED
							// We only want status 0 (PENDING)
							if (Number(escrowInfo[3]) !== 0) {
								return null;
							}

							const createdAtMs = Number(p.createdAt) * 1000;
							const isRefundable = Date.now() > createdAtMs + REFUND_TIMEOUT_MS;

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
		// Background poll of the subgraph. The quota is shared (Studio: 3,000 queries a day) and a
		// 15 s cadence was 240 queries an hour per open tab; status changes are already surfaced by
		// the block-driven live poller, so once a minute is enough to catch the 1 h refund timer.
		// (A literal: the graph-poll-cadence guard reads the value from source.)
		refetchInterval: 60_000,
	});
}
