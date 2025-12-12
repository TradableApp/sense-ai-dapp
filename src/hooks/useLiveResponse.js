import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { ethers } from 'ethers';
import { useSelector } from 'react-redux';
import { getContract, prepareEvent } from 'thirdweb';
import { useActiveWallet, useContractEvents } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { client, deploymentChain } from '@/config/thirdweb';
import { useSession } from '@/features/auth/SessionProvider';
import { wait } from '@/lib/utils';

/**
 * Listens for live blockchain events to ensure cross-device synchronization and real-time UI updates.
 *
 * It handles events for:
 * - User Actions (Costing Tokens):
 *   - `PromptSubmitted`: A new question is asked. (Updates usage plan, creates pending message).
 *   - `RegenerationRequested`: An answer is re-rolled. (Updates usage plan, creates pending message).
 *   - `BranchRequested`: A conversation is forked. (Updates usage plan).
 *   - `MetadataUpdateRequested`: A conversation is renamed/deleted. (Updates usage plan).
 *
 * - Oracle Fulfillments (State Changes):
 *   - `AnswerMessageAdded`: An AI response is delivered. (Resolves pending message).
 *   - `ConversationBranched`: The new forked conversation is created. (Updates conversation list).
 *   - `ConversationMetadataUpdated`: The rename/delete is confirmed. (Updates conversation list).
 *
 * - User Cancellations/Refunds:
 *   - `PromptCancelled`: A pending prompt is cancelled by the user. (Updates usage plan, resolves pending message).
 *   - `PaymentRefunded`: A stuck prompt is refunded. (Updates usage plan, resolves pending message).
 */
export default function useLiveResponse() {
	const activeWallet = useActiveWallet();
	const chain = activeWallet?.getChain();
	const chainId = chain?.id;
	const queryClient = useQueryClient();
	const { sessionKey, ownerAddress } = useSession();

	// Get active conversation from Redux Store
	const activeConversationId = useSelector(state => state.chat.activeConversationId);

	const contractConfig = CONTRACTS[chainId];
	const targetChain = chainId === deploymentChain.id ? deploymentChain : chain;

	// Memoize contracts to prevent unnecessary re-initialization
	const { agentContract, escrowContract } = useMemo(() => {
		const agent = contractConfig
			? getContract({
					client,
					chain: targetChain,
					address: contractConfig.agent.address,
					abi: contractConfig.agent.abi,
			  })
			: null;

		const escrow = contractConfig
			? getContract({
					client,
					chain: targetChain,
					address: contractConfig.escrow.address,
					abi: contractConfig.escrow.abi,
			  })
			: null;
		return { agentContract: agent, escrowContract: escrow };
	}, [contractConfig, targetChain]);

	// --- 1. Prepare Events ---
	const agentEvents = useMemo(() => {
		const events = [];
		if (contractConfig?.agent?.abi) {
			try {
				const iface = new ethers.Interface(contractConfig.agent.abi);
				const eventsToWatch = [
					'AnswerMessageAdded',
					'PromptSubmitted',
					'RegenerationRequested',
					'BranchRequested',
					'ConversationBranched',
					'MetadataUpdateRequested',
					'ConversationMetadataUpdated',
				];
				eventsToWatch.forEach(name => {
					const fragment = iface.getEvent(name);
					if (fragment) {
						events.push(prepareEvent({ signature: fragment.format('full') }));
					}
				});
			} catch (error) {
				console.error('[useLiveResponse] Failed to derive Agent events:', error);
			}
		}
		return events;
	}, [contractConfig?.agent?.abi]);

	const escrowEvents = useMemo(() => {
		const events = [];
		if (contractConfig?.escrow?.abi) {
			try {
				const iface = new ethers.Interface(contractConfig.escrow.abi);
				const eventsToWatch = ['PromptCancelled', 'PaymentRefunded'];
				eventsToWatch.forEach(name => {
					const fragment = iface.getEvent(name);
					if (fragment) {
						events.push(prepareEvent({ signature: fragment.format('full') }));
					}
				});
			} catch (error) {
				console.error('[useLiveResponse] Failed to derive Escrow events:', error);
			}
		}
		return events;
	}, [contractConfig?.escrow?.abi]);

	// --- 2. Listeners ---
	const { data: agentLog, isLoading: isAgentLoading } = useContractEvents({
		contract: agentContract,
		events: agentEvents,
		enabled: !!agentContract && agentEvents.length > 0,
		watch: true,
	});

	const { data: escrowLog, isLoading: isEscrowLoading } = useContractEvents({
		contract: escrowContract,
		events: escrowEvents,
		enabled: !!escrowContract && escrowEvents.length > 0,
		watch: true,
	});

	// --- 3. State Management for Sync Queue ---
	const prevAgentCountRef = useRef(0);
	const prevEscrowCountRef = useRef(0);
	const processedEventKeysRef = useRef(new Set()); // De-duplication Set
	const isInitializedRef = useRef(false); // Startup check

	// The Queue State
	const isSyncingRef = useRef(false);
	const pendingMessageIdsRef = useRef(new Set());
	const keysToInvalidateRef = useRef(new Set());
	const resetBackoffRef = useRef(false);

	const addInvalidationKey = useCallback(queryKey => {
		keysToInvalidateRef.current.add(JSON.stringify(queryKey));
	}, []);

	const processSyncQueue = useCallback(async () => {
		if (isSyncingRef.current) {
			resetBackoffRef.current = true;
			return;
		}

		isSyncingRef.current = true;
		console.log('[useLiveResponse] Starting sync loop...');

		const schedule = [2000, 3000, 5000, 5000, 5000];
		let attempt = 0;

		while (keysToInvalidateRef.current.size > 0) {
			if (resetBackoffRef.current) {
				console.log('[useLiveResponse] New event detected, resetting backoff.');
				attempt = 0;
				resetBackoffRef.current = false;
			}
			const delay = schedule[Math.min(attempt, schedule.length - 1)];

			// eslint-disable-next-line no-await-in-loop
			await wait(delay);
			console.log(`[useLiveResponse] Syncing (Attempt ${attempt + 1}, Delay ${delay}ms)`);

			const uniqueKeys = Array.from(keysToInvalidateRef.current).map(k => JSON.parse(k));

			const hasMessagesKey = uniqueKeys.some(k => k[0] === 'messages');
			const hasConversationsKey = uniqueKeys.some(k => k[0] === 'conversations');

			if (hasMessagesKey && !hasConversationsKey) {
				uniqueKeys.push(['conversations']);
			}

			if (uniqueKeys.length > 0) {
				// eslint-disable-next-line no-await-in-loop
				await Promise.all(uniqueKeys.map(key => queryClient.invalidateQueries({ queryKey: key })));
			}

			if (
				pendingMessageIdsRef.current.size > 0 &&
				activeConversationId &&
				sessionKey &&
				ownerAddress
			) {
				const queryKey = ['messages', activeConversationId, sessionKey, ownerAddress];
				const cachedMessages = queryClient.getQueryData(queryKey) || [];
				const messageMap = new Map(cachedMessages.map(m => [m.id, m]));

				const resolvedIds = [];
				pendingMessageIdsRef.current.forEach(id => {
					const msg = messageMap.get(id);

					// Stop syncing if content exists OR if status is cancelled/refunded
					if (
						msg &&
						(msg.content !== null || msg.status === 'cancelled' || msg.status === 'refunded')
					) {
						resolvedIds.push(id);
					}
				});

				resolvedIds.forEach(id => pendingMessageIdsRef.current.delete(id));

				if (resolvedIds.length > 0) {
					console.log(`[useLiveResponse] Resolved IDs: ${resolvedIds.join(', ')}`);
				}

				if (pendingMessageIdsRef.current.size === 0) {
					const msgKeyStr = JSON.stringify(queryKey);
					keysToInvalidateRef.current.delete(msgKeyStr);
					console.log('[useLiveResponse] All pending messages found. Stopping chat sync.');
				}
			}

			attempt += 1;

			const isWaitingForSpecifics = pendingMessageIdsRef.current.size > 0;
			const maxGenericAttempts = 5;
			const maxSpecificAttempts = 15;

			if (!isWaitingForSpecifics && attempt >= maxGenericAttempts) {
				console.log('[useLiveResponse] Generic sync complete.');
				keysToInvalidateRef.current.clear();
			} else if (attempt > maxSpecificAttempts) {
				console.warn('[useLiveResponse] Timeout waiting for sync.');
				pendingMessageIdsRef.current.clear();
				keysToInvalidateRef.current.clear();
			}
		}

		isSyncingRef.current = false;
		console.log('[useLiveResponse] Sync loop complete.');
	}, [activeConversationId, queryClient, sessionKey, ownerAddress]);

	// --- 4. Initialization Effect ---
	// Prevents processing old historical events on page load
	useEffect(() => {
		if (isInitializedRef.current) return;

		if (!isAgentLoading && agentLog) {
			prevAgentCountRef.current = agentLog.length;
		}
		if (!isEscrowLoading && escrowLog) {
			prevEscrowCountRef.current = escrowLog.length;
		}

		if (!isAgentLoading && !isEscrowLoading) {
			isInitializedRef.current = true;
		}
	}, [agentLog, escrowLog, isAgentLoading, isEscrowLoading]);

	// --- 5. Main Event Processor ---
	useEffect(() => {
		if (!isInitializedRef.current || !ownerAddress) return;

		let newWorkDetected = false;

		// --- HANDLE AGENT EVENTS ---
		if (agentLog && agentLog.length > prevAgentCountRef.current) {
			const newEvents = agentLog.slice(prevAgentCountRef.current);
			newEvents.forEach(e => {
				// DE-DUPLICATION CHECK
				const eventKey = `${e.transactionHash}-${e.logIndex}`;
				if (processedEventKeysRef.current.has(eventKey)) return;
				processedEventKeysRef.current.add(eventKey);

				const { args, eventName } = e;

				// **Direct Ownership Check** for events that have `indexed user`
				if (
					eventName === 'PromptSubmitted' ||
					eventName === 'RegenerationRequested' ||
					eventName === 'ConversationBranched' ||
					eventName === 'BranchRequested' ||
					eventName === 'MetadataUpdateRequested'
				) {
					if (args.user.toLowerCase() !== ownerAddress.toLowerCase()) {
						return; // Ignore event from other users
					}
				}

				if (
					eventName === 'PromptSubmitted' ||
					eventName === 'RegenerationRequested' ||
					eventName === 'BranchRequested' ||
					eventName === 'MetadataUpdateRequested'
				) {
					addInvalidationKey(['usagePlan']); // New prompt/regeneration always affects usage
					addInvalidationKey(['tokenBalance']);
					newWorkDetected = true;
				}

				if (eventName === 'ConversationBranched' || eventName === 'ConversationMetadataUpdated') {
					addInvalidationKey(['conversations']);
					newWorkDetected = true;
				}

				// Indirect ownership check for events filtered by active conversation
				if (activeConversationId) {
					const isRelevant =
						args.conversationId?.toString() === activeConversationId ||
						args.originalConversationId?.toString() === activeConversationId;

					if (
						isRelevant &&
						(eventName === 'AnswerMessageAdded' ||
							eventName === 'PromptSubmitted' ||
							eventName === 'RegenerationRequested')
					) {
						const msgId =
							eventName === 'AnswerMessageAdded'
								? args.messageId.toString()
								: eventName === 'RegenerationRequested'
								? args.answerMessageId.toString()
								: args.promptMessageId.toString();

						const queryKey = ['messages', activeConversationId, sessionKey, ownerAddress];

						const cachedMessages = queryClient.getQueryData(queryKey) || [];
						const existingMsg = cachedMessages.find(m => m.id === msgId);

						// If the message doesn't exist OR is still pending/thinking, add to watch list
						if (
							!existingMsg ||
							(existingMsg.content === null &&
								existingMsg.status !== 'cancelled' &&
								existingMsg.status !== 'refunded')
						) {
							addInvalidationKey(queryKey);
							pendingMessageIdsRef.current.add(msgId);
							newWorkDetected = true;
						}
					}
				}
			});
			prevAgentCountRef.current = agentLog.length;
		}

		// --- HANDLE ESCROW EVENTS ---
		if (escrowLog && escrowLog.length > prevEscrowCountRef.current) {
			const newEvents = escrowLog.slice(prevEscrowCountRef.current);
			newEvents.forEach(e => {
				const { eventName, transactionHash, logIndex } = e;
				console.log(
					'eventName',
					eventName,
					'transactionHash',
					transactionHash,
					'logIndex',
					logIndex,
				);

				// DE-DUPLICATION CHECK
				const eventKey = `${transactionHash}-${logIndex}`;
				if (processedEventKeysRef.current.has(eventKey)) return;
				processedEventKeysRef.current.add(eventKey);

				if (eventName === 'PromptCancelled') {
					if (e.args.user.toLowerCase() === ownerAddress.toLowerCase()) {
						addInvalidationKey(['stuckRequests']);
						addInvalidationKey(['usagePlan']);
						addInvalidationKey(['tokenBalance']);

						// Only invalidate the chat if it's the one we are currently looking at
						if (activeConversationId) {
							addInvalidationKey(['conversations']);
							addInvalidationKey(['messages', activeConversationId, sessionKey, ownerAddress]);
						}
						newWorkDetected = true;
					}
				}

				if (eventName === 'PaymentRefunded') {
					const stuckKey = ['stuckRequests', chainId, ownerAddress];
					const stuckList = queryClient.getQueryData(stuckKey) || [];
					if (stuckList.some(s => s.id === e.args.escrowId.toString())) {
						addInvalidationKey(['stuckRequests']);
						addInvalidationKey(['usagePlan']);
						addInvalidationKey(['tokenBalance']);

						if (activeConversationId) {
							addInvalidationKey(['conversations']);
							addInvalidationKey(['messages', activeConversationId, sessionKey, ownerAddress]);
						}
						newWorkDetected = true;
					}
				}
			});
			prevEscrowCountRef.current = escrowLog.length;
		}

		if (newWorkDetected) {
			processSyncQueue();
		}
	}, [
		activeConversationId,
		addInvalidationKey,
		agentLog,
		chainId,
		escrowLog,
		ownerAddress,
		processSyncQueue,
		queryClient,
		sessionKey,
	]);
}
