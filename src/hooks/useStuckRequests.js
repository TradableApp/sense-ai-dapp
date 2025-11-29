import { useQuery } from '@tanstack/react-query';
import { GraphQLClient } from 'graphql-request';
import { useActiveWallet } from 'thirdweb/react';

import { GET_STUCK_PAYMENTS_QUERY } from '@/lib/graph/queries';

const THE_GRAPH_API_URL = import.meta.env.VITE_THE_GRAPH_API_URL;
const graphQLClient = new GraphQLClient(THE_GRAPH_API_URL);

export default function useStuckRequests() {
	const activeWallet = useActiveWallet();
	const ownerAddress = activeWallet?.getAccount()?.address;
	const chainId = activeWallet?.getChain()?.id;

	return useQuery({
		queryKey: ['stuckRequests', chainId, ownerAddress],
		queryFn: async () => {
			if (!THE_GRAPH_API_URL || !ownerAddress) return [];

			try {
				const variables = { user: ownerAddress.toLowerCase() };
				const data = await graphQLClient.request(GET_STUCK_PAYMENTS_QUERY, variables);

				return (data.payments || []).map(p => {
					// Convert Graph BigInt (string) to Number for calculation
					const createdAtMs = Number(p.createdAt) * 1000;

					// Logic: Refundable if created more than 1 hour ago
					const ONE_HOUR = 60 * 60 * 1000;
					const isRefundable = Date.now() > createdAtMs + ONE_HOUR;

					return {
						...p,
						id: p.id, // This is the answerMessageId/escrowId
						createdAt: createdAtMs,
						isRefundable,
					};
				});
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
