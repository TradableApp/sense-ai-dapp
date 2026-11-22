import { useCallback, useEffect, useState } from 'react';

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
	refundableAt,
	STUCK_PAGE_SIZE,
	type StuckPayment,
	verifyStuck,
} from '@/lib/stuckPayments';

const THE_GRAPH_API_URL = import.meta.env.VITE_THE_GRAPH_API_URL;
const graphQLClient = new GraphQLClient(THE_GRAPH_API_URL);

// The escrow's `escrows(id)` tuple: the status is its fourth field.
const ESCROW_STATUS_FIELD = 3;

/**
 * How often the stuck requests are read again. Background polling of the subgraph spends a
 * shared quota (Studio: 3,000 queries a day), and status changes are already surfaced by the
 * block-driven live poller, so once a minute is enough to catch the one-hour refund timer.
 * (Literals: the graph-poll-cadence guard reads the values from source.)
 */
export const STUCK_POLL_MS = 60_000;

/**
 * How often when the last answer took more than one page: each page is a query against the
 * shared quota and each pending payment an escrow read, so a wallet with that many is read
 * less often.
 */
export const STUCK_POLL_MANY_PAGES_MS = 300_000;

/**
 * How often the refund hour is checked against the clock. It reads nothing: the list already
 * holds when each payment was made.
 */
export const REFUND_CLOCK_MS = 15_000;

/** What the query keeps: the stuck payments, and how many pages the answer took. */
interface StuckAnswer {
	stuck: StuckPayment[];
	pagesRead: number;
}

const tookManyPages = (query: { state: { data?: StuckAnswer } }) =>
	(query.state.data?.pagesRead ?? 0) > 1;

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
 * payment the user can get back. `isError` is for the place the list is shown, to say it
 * could not be checked just now. Read again every `STUCK_POLL_MS`, or `STUCK_POLL_MANY_PAGES_MS`
 * when the last answer took more than one page.
 */
export default function useStuckRequests() {
	const activeWallet = useActiveWallet();
	const ownerAddress = activeWallet?.getAccount()?.address;
	const chain = activeWallet?.getChain();
	const chainId = chain?.id;

	// The hour is checked against a clock of its own, so the Refund button unlocks when the hour
	// passes and not at the next read of the list.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), REFUND_CLOCK_MS);
		return () => clearInterval(timer);
	}, []);
	const select = useCallback((answer: StuckAnswer) => refundableAt(answer.stuck, now), [now]);

	return useQuery({
		queryKey: ['stuckRequests', chainId, ownerAddress],
		queryFn: async (): Promise<StuckAnswer> => {
			const escrow = chainId ? CONTRACTS[chainId]?.escrow : undefined;
			if (!THE_GRAPH_API_URL || !ownerAddress || !chain || !escrow) {
				return { stuck: [], pagesRead: 0 };
			}
			try {
				const { payments, pagesRead } = await fetchPendingPayments(
					pageRequester(ownerAddress.toLowerCase()),
				);
				if (payments.length === 0) return { stuck: [], pagesRead };
				// The subgraph can list a payment the escrow has settled: the escrow has the last word.
				const stuck = await verifyStuck(payments, statusReader(chain, escrow), Date.now());
				return { stuck, pagesRead };
			} catch (error) {
				reportFailure(error);
				throw error;
			}
		},
		select,
		enabled: !!ownerAddress && !!THE_GRAPH_API_URL,
		refetchInterval: query => (tookManyPages(query) ? STUCK_POLL_MANY_PAGES_MS : STUCK_POLL_MS),
	});
}
