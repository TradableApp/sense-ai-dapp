import { useCallback, useEffect, useMemo, useRef } from 'react';

import * as Sentry from '@sentry/react';
import { useQueryClient } from '@tanstack/react-query';
import { getContract, readContract } from 'thirdweb';
import { useActiveWallet } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { client, deploymentChain } from '@/config/thirdweb';
import { useSession } from '@/features/auth/SessionProvider';
import { wait } from '@/lib/utils';
import { useAppSelector } from '@/store/hooks';
import type { RootState } from '@/store/store';

import {
	createStatePoller,
	deriveInvalidations,
	ESCROW_PROBE_METHODS,
	type EscrowSnapshot,
} from './liveStateProbe';
import { getTokenBalanceQueryKey } from './useTokenBalance';

// How often the fallback poll re-checks for a pending answer (see effect 6).
const PENDING_ANSWER_POLL_MS = 4_000;

interface CachedMessage {
	role: string;
	content: string | null;
	status?: string;
}

/**
 * True when the active conversation's cached messages include an assistant message
 * that is still awaiting content (i.e. "Thinking…") and isn't cancelled/refunded.
 */
function hasPendingAnswer(messages: unknown): boolean {
	return (
		Array.isArray(messages) &&
		(messages as CachedMessage[]).some(
			m =>
				m.role === 'assistant' &&
				(m.content === null || m.content === undefined) &&
				m.status !== 'cancelled' &&
				m.status !== 'refunded',
		)
	);
}

/**
 * Keeps the UI in sync with the user's on-chain activity, across devices, without watching
 * contract logs.
 *
 * Instead of subscribing to eleven agent/escrow events (one `eth_getLogs` per event per
 * block on the public RPC — the 429 storm of sense-ai-dapp#77, and impossible on
 * mainnet.base.org, which refuses `eth_getLogs`), the hook polls two cheap `eth_call`s
 * once per block through `liveStateProbe`:
 *
 * - `pendingEscrowCount(user)` moves UP on every paid action from any device (prompt,
 *   regeneration, branch, metadata update) and DOWN when the oracle fulfils it or the user
 *   cancels / is refunded. This is the signal the Prompt*, Regeneration*, Branch*,
 *   Metadata*, AnswerMessageAdded, PromptCancelled and PaymentRefunded events carried.
 * - `spendingLimits(user)` moves on SpendingLimitSet / SpendingLimitCancelled (and on fees).
 *
 * A change maps onto the same TanStack Query invalidations the events used to drive
 * (`deriveInvalidations`), fed through the retry/backoff sync queue below. The counter
 * cannot name the conversation, so the active chat is refreshed on any pending-count
 * move — the same thing the pending-answer fallback poll (effect 3) already does.
 *
 * A submit-and-fulfil inside one 2 s tick nets the count out but still leaves
 * `spentAmount` higher, so it is seen as a change. Branch and rename fees are paid directly
 * (count unchanged); their oracle fulfilment moves no escrow state, so the sync queue's
 * schedule runs long enough to catch it on a later refetch.
 */
export default function useLiveResponse() {
	const activeWallet = useActiveWallet();
	const chain = activeWallet?.getChain();
	const chainId = chain?.id;
	const queryClient = useQueryClient();
	const { ownerAddress } = useSession();

	// Get active conversation from Redux Store
	const activeConversationId = useAppSelector(
		(state: RootState) => state.chat.activeConversationId,
	);

	// The in-memory thread (source of truth for what's displayed). The fallback
	// poll (effect 6) reads pending state from here via a ref — not from the query
	// cache — because an optimistic follow-up placeholder lands in Redux before the
	// messages query refetches, and a same-conversation follow-up keeps the same
	// query key (so the cache wouldn't reflect the new pending answer).
	const activeConversationMessages = useAppSelector(
		(state: RootState) => state.chat.activeConversationMessages,
	);
	const pendingAnswerRef = useRef(false);
	pendingAnswerRef.current = hasPendingAnswer(activeConversationMessages);

	const contractConfig = chainId ? CONTRACTS[chainId] : undefined;
	// The ABLE token address for this chain — the third component of the thirdweb wallet-balance key.
	const tokenAddress = contractConfig?.token?.address;
	const targetChain = chainId === deploymentChain.id ? deploymentChain : chain;

	// Memoize the escrow contract to prevent unnecessary re-initialization
	const escrowContract = useMemo(() => {
		if (!contractConfig || !targetChain) return null;
		return getContract({
			client,
			chain: targetChain,
			address: contractConfig.escrow.address,
			abi: contractConfig.escrow.abi as Parameters<typeof getContract>[0]['abi'],
		});
	}, [contractConfig, targetChain]);

	// --- 1. Sync queue state ---
	const isSyncingRef = useRef(false);
	const keysToInvalidateRef = useRef(new Set<string>());
	const resetBackoffRef = useRef(false);

	// `unknown[]` (not just primitives) so structured keys like the thirdweb wallet-balance key
	// `['walletBalance', chainId, addr, { tokenAddress }]` are accepted; they round-trip via JSON.
	const addInvalidationKey = useCallback((queryKey: unknown[]) => {
		keysToInvalidateRef.current.add(JSON.stringify(queryKey));
	}, []);

	const processSyncQueue = useCallback(async () => {
		if (isSyncingRef.current) {
			resetBackoffRef.current = true;
			return;
		}

		isSyncingRef.current = true;

		// The first steps absorb indexer lag; the tail keeps refetching long enough to catch
		// an oracle fulfilment (branch, rename) that moves no escrow state of its own.
		const schedule: number[] = [2000, 3000, 5000, 5000, 5000, 10000, 10000, 15000, 15000];
		let attempt = 0;

		try {
			while (keysToInvalidateRef.current.size > 0) {
				if (resetBackoffRef.current) {
					attempt = 0;
					resetBackoffRef.current = false;
				}
				const delay = schedule[Math.min(attempt, schedule.length - 1)];

				// eslint-disable-next-line no-await-in-loop
				await wait(delay);

				// Snapshot the batch: keys that arrive during the awaits below belong to the
				// next pass and must survive this pass's clean-up.
				const batch = Array.from(keysToInvalidateRef.current);
				const uniqueKeys = batch.map(k => JSON.parse(k));

				const hasMessagesKey = uniqueKeys.some(k => k[0] === 'messages');
				const hasConversationsKey = uniqueKeys.some(k => k[0] === 'conversations');

				// TODO: Workaround — when message-related queries are invalidated, also inject the
				// generic 'conversations' key into the sync queue. This ensures that queries like
				// `activeConversationMetadata` (which depend on conversations data) are refreshed
				// even when only message content changes. This is a temporary measure until query
				// keys are unified under a shared namespace (e.g., all queries keyed by conversation).
				if (hasMessagesKey && !hasConversationsKey) {
					uniqueKeys.push(['conversations']);
				}

				if (uniqueKeys.length > 0) {
					// eslint-disable-next-line no-await-in-loop
					await Promise.all(
						// `unknown[]` to match addInvalidationKey + TanStack's QueryKey — structured keys like
						// the wallet-balance key carry an object element, not just primitives.
						uniqueKeys.map((key: unknown[]) => queryClient.invalidateQueries({ queryKey: key })),
					);
				}

				attempt += 1;

				// Each change gets the full schedule, then its batch drains — only its batch.
				if (attempt >= schedule.length) {
					batch.forEach(k => keysToInvalidateRef.current.delete(k));
				}
			}
		} finally {
			isSyncingRef.current = false;
		}
	}, [queryClient]);

	// --- 2. Escrow state poller ---
	// The active conversation is read through a ref so switching chats does not restart the
	// poller (and lose its baseline).
	const activeConversationIdRef = useRef(activeConversationId);
	activeConversationIdRef.current = activeConversationId;

	const tokenBalanceKey = useMemo(
		() => getTokenBalanceQueryKey(chainId, ownerAddress ?? undefined, tokenAddress),
		[chainId, ownerAddress, tokenAddress],
	);

	useEffect(() => {
		if (!escrowContract || !ownerAddress) return undefined;

		// Two reads issued in the same tick → thirdweb batches them into ONE JSON-RPC POST.
		const read = async (): Promise<EscrowSnapshot> => {
			const [limit, pendingEscrowCount] = await Promise.all([
				readContract({
					contract: escrowContract,
					method: ESCROW_PROBE_METHODS.spendingLimits,
					params: [ownerAddress],
				}),
				readContract({
					contract: escrowContract,
					method: ESCROW_PROBE_METHODS.pendingEscrowCount,
					params: [ownerAddress],
				}),
			]);
			const [allowance, spentAmount, expiresAt] = limit;
			return { pendingEscrowCount, allowance, spentAmount, expiresAt };
		};

		const poller = createStatePoller({
			read,
			onChange: ({ prev, next }) => {
				deriveInvalidations(prev, next, {
					tokenBalanceKey,
					ownerAddress,
					activeConversationId: activeConversationIdRef.current,
				}).forEach(addInvalidationKey);
				processSyncQueue().catch((error: unknown) => {
					console.warn('[useLiveResponse] sync queue failed', error);
					Sentry.addBreadcrumb({
						category: 'rpc.poll',
						level: 'warning',
						message: 'live poll: sync queue failed',
						data: { reason: error instanceof Error ? error.message : String(error) },
					});
				});
			},
			report: (message, data) =>
				Sentry.addBreadcrumb({ category: 'rpc.poll', level: 'warning', message, data }),
			isHidden: () => document.visibilityState === 'hidden',
			random: Math.random,
		});

		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') poller.wake();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		poller.start();

		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange);
			poller.stop();
		};
	}, [addInvalidationKey, escrowContract, ownerAddress, processSyncQueue, tokenBalanceKey]);

	// --- 3. Fallback poll for a pending answer ---
	// The state poller is best-effort: it backs off under RPC pressure, pauses while the
	// tab is hidden, and cannot see a submit-and-fulfil that nets out inside one tick. A
	// missed/late answer would otherwise leave a prompt stuck on "Thinking…" forever.
	// While the active conversation has an outstanding (content-less) assistant
	// message, re-run the same refreshes a change would trigger: the conversation
	// sync (which hydrates the answer into the cache) and the messages query (which
	// renders it). The poll is self-limiting — it does nothing once the answer lands
	// — so it adds no steady-state load. The state poller stays the fast path.
	useEffect(() => {
		if (!activeConversationId || !ownerAddress) return undefined;

		const messagesKey = ['messages', activeConversationId, ownerAddress];
		let inFlight = false;

		const interval = setInterval(() => {
			if (inFlight || !pendingAnswerRef.current) return;

			inFlight = true;
			// Refresh the conversation sync first (hydrates the answer into the local
			// cache), then re-read the messages so the resolved content renders.
			queryClient
				.invalidateQueries({ queryKey: ['conversations'] })
				.then(() => queryClient.invalidateQueries({ queryKey: messagesKey }))
				.finally(() => {
					inFlight = false;
				});
		}, PENDING_ANSWER_POLL_MS);

		return () => clearInterval(interval);
	}, [activeConversationId, ownerAddress, queryClient]);
}
