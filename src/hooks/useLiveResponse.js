import { useEffect, useRef } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { ethers } from 'ethers';
import { getContract, prepareEvent } from 'thirdweb';
import { useActiveWallet, useContractEvents } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { client } from '@/config/thirdweb';
import { useSession } from '@/features/auth/SessionProvider'; // Import session for cache key
import { wait } from '@/lib/utils';

/**
 * Listens for the 'AnswerMessageAdded' event on the Agent contract.
 * When fired, it triggers a sync with The Graph to pull the new message content.
 * Includes smart retry logic that stops once data is received.
 */
export default function useLiveResponse(conversationId) {
	const activeWallet = useActiveWallet();
	const chain = activeWallet?.getChain();
	const chainId = chain?.id;
	const queryClient = useQueryClient();
	const { sessionKey, ownerAddress } = useSession(); // Needed to inspect the cache

	const contractConfig = CONTRACTS[chainId];

	// Standard Contract Setup
	const agentContract = getContract({
		client,
		chain,
		address: contractConfig.agent.address,
		abi: contractConfig.agent.abi,
	});

	// Event Preparation
	let answerEvent = null;
	if (contractConfig?.agent?.abi) {
		try {
			const iface = new ethers.Interface(contractConfig.agent.abi);
			const fragment = iface.getEvent('AnswerMessageAdded');
			const signature = fragment.format('full');
			answerEvent = prepareEvent({ signature });
		} catch (error) {
			console.error('[useLiveResponse] Failed to derive event signature from ABI:', error);
		}
	}
	if (!answerEvent) {
		answerEvent = prepareEvent({
			signature:
				'event AnswerMessageAdded(uint256 indexed conversationId, uint256 indexed messageId, string messageCID)',
		});
	}

	// Use the Hook to get DATA (events array)
	const { data: events } = useContractEvents({
		contract: agentContract,
		events: [answerEvent],
		enabled: !!agentContract && !!conversationId && !!answerEvent,
		watch: true,
	});

	// Track the number of events we've seen to detect NEW ones
	const prevEventCountRef = useRef(0);

	useEffect(() => {
		// If no events or array is empty, do nothing
		if (!events || events.length === 0) {
			return;
		}

		// If the count increased, we have new events!
		if (events.length > prevEventCountRef.current) {
			// Get the new events
			const newEvents = events.slice(prevEventCountRef.current);

			// 1. Filter for events belonging to THIS conversation
			const conversationEvents = newEvents.filter(
				e => e.args.conversationId.toString() === conversationId,
			);

			if (conversationEvents.length > 0) {
				// 2. Filter out events for messages we have already fully synced.
				// We want to sync if:
				// a) We don't have the message at all (Fetched from another device/tab)
				// b) We have the message, but content is null (It's a "Thinking..." placeholder)
				const queryKey = ['messages', conversationId, sessionKey, ownerAddress];
				const cachedMessages = queryClient.getQueryData(queryKey) || [];
				const cachedMap = new Map(cachedMessages.map(m => [m.id, m]));

				const unSyncedEvents = conversationEvents.filter(e => {
					const msgId = e.args.messageId.toString();
					const msg = cachedMap.get(msgId);
					// If msg doesn't exist OR msg exists but is still thinking (content is null) -> Sync it
					return !msg || msg.content === null;
				});

				if (unSyncedEvents.length > 0) {
					console.log(
						'[useLiveResponse] New answer detected. Starting smart sync...',
						unSyncedEvents,
					);

					(async () => {
						const attempts = [2000, 3000, 5000, 5000, 5000, 5000, 5000];

						await attempts.reduce(async (previousPromise, ms) => {
							const shouldContinue = await previousPromise;
							if (!shouldContinue) return false; // Stop chain if previous step found data

							await wait(ms);
							console.log(`[useLiveResponse] Syncing after ${ms}ms delay...`);

							// Perform the sync
							await queryClient.invalidateQueries({ queryKey: ['conversations'] });
							await queryClient.invalidateQueries({ queryKey });

							// Check if we have data now
							const freshMessages = queryClient.getQueryData(queryKey) || [];
							const freshMap = new Map(freshMessages.map(m => [m.id, m]));

							// Check if ALL relevant events are now resolved (content is not null)
							const allResolved = unSyncedEvents.every(e => {
								const msgId = e.args.messageId.toString();
								const msg = freshMap.get(msgId);
								return msg && msg.content !== null;
							});

							if (allResolved) {
								console.log('[useLiveResponse] Data synced successfully. Stopping retries.');
								return false; // Stop retrying
							}
							return true; // Continue to next retry
						}, Promise.resolve(true));
					})();
				} else {
					// console.log('[useLiveResponse] Events detected but already synced. Skipping.');
				}
			}

			prevEventCountRef.current = events.length;
		}
	}, [events, conversationId, queryClient, sessionKey, ownerAddress]);
}
