import * as Sentry from '@sentry/react';
import { useQuery } from '@tanstack/react-query';
import { GraphQLClient } from 'graphql-request';
import { type Chain, getContract, readContract } from 'thirdweb';
import { useActiveWallet } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { client } from '@/config/thirdweb';
import { GET_STUCK_PAYMENTS_QUERY } from '@/lib/graph/queries';
import type {
	GetStuckPaymentsQuery,
	GetStuckPaymentsQueryVariables,
} from '@/lib/graph/query-types';
import {
	fetchPendingPayments,
	STUCK_PAGE_SIZE,
	type StuckPayment,
	verifyStuck,
} from '@/lib/stuckPayments';

const THE_GRAPH_API_URL = import.meta.env.VITE_THE_GRAPH_API_URL;
const graphQLClient = new GraphQLClient(THE_GRAPH_API_URL);

// The escrow's `escrows(id)` tuple: the status is its fourth field.
const ESCROW_STATUS_FIELD = 3;

let hasReportedFailure = false;

/**
 * Reports a failed read once per page load, by the error's name only: thirdweb's and the
 * GraphQL client's messages carry the endpoint URL and the call data.
 */
function reportFailure(error: unknown): void {
	if (hasReportedFailure) return;
	hasReportedFailure = true;
	try {
		Sentry.captureException(new Error('Reading the stuck requests failed.'), {
			tags: { check: 'stuck-requests' },
			extra: { errorName: error instanceof Error ? error.name : typeof error },
			fingerprint: ['stuck-requests-failed'],
		});
	} catch {
		// The query still fails and is retried; a failed report changes nothing.
	}
}

function pageRequester(user: string) {
	return async (skip: number) => {
		const variables: GetStuckPaymentsQueryVariables = { user, first: STUCK_PAGE_SIZE, skip };
		const data = await graphQLClient.request<GetStuckPaymentsQuery>(
			GET_STUCK_PAYMENTS_QUERY,
			variables,
		);
		return data.payments ?? [];
	};
}

function statusReader(chain: Chain, escrow: { address: string; abi: unknown }) {
	const contract = getContract({
		client,
		chain,
		address: escrow.address,
		abi: escrow.abi as Parameters<typeof getContract>[0]['abi'],
	});
	return async (id: string) => {
		const escrowInfo = await readContract({
			contract,
			method: 'escrows' as any,
			params: [id],
		});
		return Number((escrowInfo as readonly unknown[])[ESCROW_STATUS_FIELD]);
	};
}

/**
 * The wallet's prompts whose payment the escrow still holds, and whether each can be refunded.
 * A failed read (the subgraph or the escrow) fails the query, so it is retried and its last
 * answer kept, and is reported once per page load: answering "nothing stuck" would hide a
 * payment the user can get back.
 */
export default function useStuckRequests() {
	const activeWallet = useActiveWallet();
	const ownerAddress = activeWallet?.getAccount()?.address;
	const chain = activeWallet?.getChain();
	const chainId = chain?.id;

	return useQuery({
		queryKey: ['stuckRequests', chainId, ownerAddress],
		queryFn: async (): Promise<StuckPayment[]> => {
			const escrow = chainId ? CONTRACTS[chainId]?.escrow : undefined;
			if (!THE_GRAPH_API_URL || !ownerAddress || !chain || !escrow) return [];
			try {
				const candidates = await fetchPendingPayments(pageRequester(ownerAddress.toLowerCase()));
				if (candidates.length === 0) return [];
				// The subgraph can list a payment the escrow has settled: the escrow has the last word.
				return await verifyStuck(candidates, statusReader(chain, escrow), Date.now());
			} catch (error) {
				reportFailure(error);
				throw error;
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
