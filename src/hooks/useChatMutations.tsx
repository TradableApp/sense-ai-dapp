import React from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getContract, prepareContractCall, sendAndConfirmTransaction } from 'thirdweb';
import { useActiveAccount, useActiveWallet } from 'thirdweb/react';
// eslint-disable-next-line camelcase
import { eth_getTransactionReceipt, getRpcClient } from 'thirdweb/rpc';
import {
	type AbiEvent,
	type AbiFunction,
	decodeEventLog,
	getAbiItem,
	toEventSelector,
	toFunctionSelector,
	toHex,
} from 'viem';

import { Button } from '@/components/ui/button';
import { CONTRACTS, LOCAL_CHAIN_ID, TESTNET_CHAIN_ID } from '@/config/contracts';
import { client } from '@/config/thirdweb';
import useFaucetConfig from '@/hooks/useFaucetConfig';
import AbleTokenABI from '@/lib/abi/AbleToken.json';
import EVMAIAgentABI from '@/lib/abi/EVMAIAgent.json';
import EVMAIAgentEscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';
import { encryptData } from '@/lib/crypto';
import eciesEncrypt from '@/lib/ecies';
import requestTestTokens, { FAUCET_AMOUNT_ABLE } from '@/lib/faucetService';
import { wait } from '@/lib/utils';

import { getTokenBalanceQueryKey } from './useTokenBalance';

type EvmLog = {
	address: `0x${string}`;
	topics: [`0x${string}`, ...`0x${string}`[]];
	data: `0x${string}`;
};

export async function createEncryptedPayloads(
	sessionKey: CryptoKey,
	payload: Record<string, unknown>,
): Promise<{ encryptedPayload: string; roflEncryptedKey: string }> {
	const encryptedPayloadString = await encryptData(sessionKey, payload);
	const encryptedPayloadBytes = new TextEncoder().encode(encryptedPayloadString);
	const encryptedPayload = toHex(encryptedPayloadBytes);

	const rawSessionKey = await window.crypto.subtle.exportKey('raw', sessionKey);

	const oraclePublicKey = import.meta.env.VITE_ORACLE_PUBLIC_KEY;
	if (!oraclePublicKey) {
		throw new Error('VITE_ORACLE_PUBLIC_KEY is not set in .env');
	}

	const cipherBlob = await eciesEncrypt(oraclePublicKey, new Uint8Array(rawSessionKey));
	const roflEncryptedKey = toHex(cipherBlob);

	return { encryptedPayload, roflEncryptedKey };
}

interface InitiatePromptPayloadInput {
	promptText: string;
	conversationId: number | string;
	parentId: number | null;
	parentCID: string | null;
	/**
	 * Whether the target conversation already has a delivered (content-bearing) answer.
	 * Defaults to `true` (a normal follow-up) when omitted. When this is `false` for an
	 * existing conversationId, the conversation has never been confirmed on-chain — its
	 * only prior prompt(s) were cancelled, so `ConversationAdded` was never emitted (it
	 * fires only when the oracle delivers the first answer with a conversationCID). The
	 * resend must therefore be treated as new so the oracle re-initialises the
	 * conversation on storage and `ConversationAdded` finally fires; otherwise the
	 * subgraph never creates the Conversation entity and the dApp's owner-filtered sync
	 * never surfaces the answer (it stays stuck "Thinking…" forever). The UI's
	 * one-pending-prompt-at-a-time rule makes "no delivered answer" an exact signal: by
	 * the time a resend is possible the prior prompt is either answered (confirmed) or
	 * cancelled (unconfirmed). Edit-of-first-message is unaffected — that conversation
	 * has a delivered answer, so this stays `true`.
	 */
	conversationHasAnswer?: boolean;
}

/**
 * Builds the plaintext `initiatePrompt` payload before it is encrypted for the oracle.
 *
 * `previousMessageId` MUST be a string (or null): the oracle's payload validator
 * (`z.string().nullable().optional()`) rejects a numeric id and silently DROPS the
 * prompt, so a follow-up would never be answered. `parentId` is numeric on the client
 * (used for threading/sort), hence the explicit coercion. We use `!= null` rather than
 * `||` so a legitimate parent message id of `0` is preserved instead of collapsing to null.
 *
 * Exported (pure) so the oracle's type contract is unit-testable independently of the
 * mutation hook.
 */
export function buildInitiatePromptPayload({
	promptText,
	conversationId,
	parentId,
	parentCID,
	conversationHasAnswer,
}: InitiatePromptPayloadInput): Record<string, unknown> {
	return {
		promptText,
		// `!conversationId` is intentional and is NOT the same falsy idiom as the
		// `parentId` handling below. The new-conversation sentinel is the numeric `0`
		// the hook passes when there's no active conversation, so a `conversationId` of
		// 0 genuinely means "new" — unlike `parentId`, where 0 is a real id to preserve.
		// Existing conversations always arrive as a non-empty string id.
		//
		// An existing conversation with NO delivered answer (its only prior prompt was
		// cancelled) is also "new" for indexing: ConversationAdded fires only when the
		// oracle delivers the first answer with a conversationCID, so until then the
		// Conversation entity was never created. Treating the resend as new makes the
		// oracle re-initialise it and finally emit ConversationAdded. See
		// `conversationHasAnswer`.
		isNewConversation: !conversationId || conversationHasAnswer === false,
		previousMessageId: parentId != null ? String(parentId) : null,
		previousMessageCID: parentCID || null,
	};
}

/**
 * Builds the centralized contract-error handler. Exported for testability.
 * @param {boolean} isTestnet
 * @param {boolean} isLocalnet
 * @param {number} faucetAmount
 * @param {Function} handleFaucetRequest
 * @returns {(error: unknown, action: string) => void}
 */
export function buildErrorHandler(
	isTestnet: boolean,
	isLocalnet: boolean,
	faucetAmount: number,
	handleFaucetRequest: () => Promise<void>,
): (_error: unknown, _action: string) => void {
	return function genericOnError(error: unknown, action: string): void {
		console.error(`Failed to ${action}:`, error);
		const errorMessage =
			(error instanceof Error
				? error.message
				: typeof error === 'object' && error !== null && 'message' in error
				? String((error as { message: unknown }).message)
				: String(error)) || '';

		const isError = (abi: Parameters<typeof getAbiItem>[0]['abi'], name: string) => {
			const item = getAbiItem({ abi, name });
			if (!item) return false;
			return (
				errorMessage.includes(toFunctionSelector(item as AbiFunction)) ||
				errorMessage.includes(name)
			);
		};

		// --- Token Errors ---
		if (isError(AbleTokenABI.abi, 'ERC20InsufficientBalance')) {
			toast.error('Insufficient ABLE Balance', {
				description: (
					<div className="flex flex-col gap-3 mt-1">
						<p>You need more ABLE tokens to pay for this action.</p>
						{(isTestnet || isLocalnet) && (
							<Button
								size="sm"
								variant="outline"
								className="w-full border-primary/20 bg-primary/10 hover:bg-primary/20 text-primary"
								onClick={handleFaucetRequest as React.MouseEventHandler<HTMLButtonElement>}
							>
								{`Get ${faucetAmount} ${isLocalnet ? 'Localnet' : 'Testnet'} ABLE`}
							</Button>
						)}
					</div>
				),
				// Persist when a faucet is available (testnet/localnet) so the button
				// stays visible; otherwise use the sonner toast default 4s.
				duration: isTestnet || isLocalnet ? Infinity : 4000,
			});
			return;
		}

		if (isError(AbleTokenABI.abi, 'ERC20InsufficientAllowance')) {
			toast.error('Spending Limit Reached', {
				description:
					'The contract is not authorized to spend your tokens. Please increase your limit.',
			});
			return;
		}

		// --- Escrow Errors (EVMAIAgentEscrow.sol) ---
		if (isError(EVMAIAgentEscrowABI.abi, 'NoActiveSpendingLimit')) {
			toast.error('No Active Plan', {
				description: 'You must set a spending limit before starting a conversation.',
			});
			return;
		}
		if (isError(EVMAIAgentEscrowABI.abi, 'SpendingLimitExpired')) {
			toast.error('Plan Expired', {
				description: 'Your spending limit has expired. Please renew it in the dashboard.',
			});
			return;
		}
		if (isError(EVMAIAgentEscrowABI.abi, 'InsufficientSpendingLimitAllowance')) {
			toast.error('Limit Reached', {
				description: 'You have used up your spending limit for this period.',
			});
			return;
		}
		if (isError(EVMAIAgentEscrowABI.abi, 'HasPendingPrompts')) {
			toast.error('Pending Action', {
				description: 'You cannot change your plan while a prompt is still processing.',
			});
			return;
		}
		if (isError(EVMAIAgentEscrowABI.abi, 'PromptNotCancellableYet')) {
			toast.error('Too Soon to Cancel', {
				description: 'Please wait a few seconds before cancelling the prompt.',
			});
			return;
		}
		if (isError(EVMAIAgentEscrowABI.abi, 'PromptNotRefundableYet')) {
			toast.error('Too Soon to Refund', {
				description: 'You must wait 1 hour after the request was created before refunding.',
			});
			return;
		}
		if (isError(EVMAIAgentEscrowABI.abi, 'NotPromptOwner')) {
			toast.error('Access Denied', {
				description: 'You are not the owner of this prompt.',
			});
			return;
		}
		if (isError(EVMAIAgentEscrowABI.abi, 'EscrowNotPending')) {
			toast.error('Action Invalid', {
				description: 'This request has already been completed, cancelled, or refunded.',
			});
			return;
		}
		if (isError(EVMAIAgentEscrowABI.abi, 'EscrowNotFound')) {
			toast.error('Request Not Found', {
				description: 'The payment record for this request could not be found.',
			});
			return;
		}

		// --- Agent Errors (EVMAIAgent.sol) ---
		if (isError(EVMAIAgentABI.abi, 'RegenerationAlreadyPending')) {
			toast.error('Regeneration in Progress', {
				description:
					'A regeneration for this message is already pending. Please wait or cancel it.',
			});
			return;
		}
		if (isError(EVMAIAgentABI.abi, 'JobAlreadyFinalized')) {
			toast.error('Request Already Finalized', {
				description:
					'This prompt has already been answered or cancelled. Please refresh your page.',
			});
			return;
		}
		if (isError(EVMAIAgentABI.abi, 'Unauthorized')) {
			toast.error('Access Denied', {
				description: 'You do not have permission to modify this conversation.',
			});
			return;
		}
		if (isError(EVMAIAgentABI.abi, 'InvalidPromptMessageId')) {
			toast.error('Invalid Message', {
				description: 'The prompt you are trying to reply to does not exist.',
			});
			return;
		}

		// --- Generic Fallback ---
		if (errorMessage.includes('User rejected') || errorMessage.includes('User denied')) {
			toast.warning('Transaction Cancelled', {
				description: 'You rejected the request in your wallet. Please try again.',
			});
			return;
		}

		toast.error(`Failed to ${action}`, {
			description: 'An unexpected error occurred. Check console for details.',
		});
	};
}

/**
 * Query keys to invalidate after a token-costing transaction confirms (the `genericOnSuccess` path,
 * hit by every chat mutation). The wallet-balance entry MUST be the real thirdweb key built by
 * `getTokenBalanceQueryKey` — invalidating the literal `['tokenBalance']` is a silent no-op, since
 * the balance query is keyed `['walletBalance', …]`, which left the balance stale after every prompt
 * (CU-86d3dvy2y). Extra keys are each wrapped as their own single-element query key.
 */
export function postTxInvalidationKeys(
	chainId: number | undefined,
	address: string | undefined,
	tokenAddress: string | undefined,
	extraKeys: string[] = [],
): unknown[][] {
	return [
		['usagePlan'],
		getTokenBalanceQueryKey(chainId, address, tokenAddress),
		...extraKeys.map(key => [key]),
	];
}

/**
 * A centralized hook for managing all "write" transactions for chat and history.
 * It returns a collection of pre-configured `useMutation` hooks that components can use.
 */
export default function useChatMutations() {
	const activeAccount = useActiveAccount();
	const activeWallet = useActiveWallet();
	const chainId = activeWallet?.getChain()?.id;
	const isTestnet = chainId === TESTNET_CHAIN_ID;
	const isLocalnet = chainId === LOCAL_CHAIN_ID;
	const { data: faucetConfig } = useFaucetConfig();
	const faucetAmount = faucetConfig?.amount ?? FAUCET_AMOUNT_ABLE;
	const queryClient = useQueryClient();

	const handleFaucetRequest = async () => {
		toast.dismiss();

		const loadingToastId = toast.loading(
			isLocalnet ? 'Requesting Localnet Tokens...' : 'Requesting Testnet Tokens...',
		);

		const address = activeWallet?.getAccount()?.address ?? '';
		const { success, txHash, amount } = await requestTestTokens(address, faucetAmount);
		const dispensed = amount ?? faucetAmount;

		toast.dismiss(loadingToastId);

		if (success && txHash) {
			// 1. Show initial Toast with Explorer Link
			const sentToastId = toast.info('Tokens Sent', {
				description: 'Waiting for network confirmation...',
				// Localnet (Hardhat) has no block explorer; only offer the link on testnet.
				...(isLocalnet
					? {}
					: {
							action: {
								label: 'View on Explorer',
								onClick: () => window.open(`https://sepolia.basescan.org/tx/${txHash}`, '_blank'),
							},
					  }),
				duration: 10000,
			});

			// 2. Poll for confirmation using Thirdweb RPC
			try {
				// Get the RPC client for the current chain
				if (!activeWallet) throw new Error('Wallet not connected');
				const chain = activeWallet.getChain();
				if (!chain) throw new Error('Chain not found');
				const rpcRequest = getRpcClient({ client, chain });

				let attempts = 0;
				const maxAttempts = 30; // Try for ~60 seconds (2s interval)
				while (attempts < maxAttempts) {
					try {
						// Check if receipt exists
						// eslint-disable-next-line no-await-in-loop
						const receipt = await eth_getTransactionReceipt(rpcRequest, {
							hash: txHash as `0x${string}`,
						});

						if (receipt) {
							toast.dismiss(sentToastId); // Dismiss the "Tokens Sent" info toast
							toast.success('Tokens Received', {
								description: `${dispensed} ABLE tokens have been added to your wallet.`,
							});

							// Refresh balance
							const queryKey = getTokenBalanceQueryKey(
								chainId ?? 0,
								address,
								CONTRACTS[chainId ?? 0]?.token?.address,
							);
							// eslint-disable-next-line no-await-in-loop
							await queryClient.invalidateQueries({ queryKey });

							break;
						}
					} catch (e) {
						// Receipt not found yet, ignore
					}

					// eslint-disable-next-line no-await-in-loop
					await wait(2000);
					attempts += 1;
				}
			} catch (error) {
				console.error('Error waiting for faucet receipt:', error);
			}
		}
	};

	// We invalidate 'usagePlan' (Allowance, Pending Count) and the wallet balance immediately after a
	// transaction confirms, as these live on-chain and update instantly. Graph data ('conversations',
	// 'messages', 'stuckRequests') is handled by useLiveResponse. The balance key MUST be the real
	// ['walletBalance', …] key (postTxInvalidationKeys → getTokenBalanceQueryKey), not ['tokenBalance'].
	const genericOnSuccess = (queryKeysToInvalidate: string[] = []) => {
		postTxInvalidationKeys(
			chainId,
			activeAccount?.address,
			CONTRACTS[chainId ?? 0]?.token?.address,
			queryKeysToInvalidate,
		).forEach(queryKey => queryClient.invalidateQueries({ queryKey }));
	};

	const genericOnError = buildErrorHandler(
		isTestnet,
		isLocalnet,
		faucetAmount,
		handleFaucetRequest,
	);

	// --- MUTATIONS ---

	/**
	 * Represents the mutation for both creating a new conversation and sending a follow-up prompt.
	 * It calls the `initiatePrompt` function on the smart contract.
	 * Upon success, it parses the transaction receipt to find and return the real, on-chain IDs.
	 */
	const initiatePromptMutation = useMutation({
		mutationFn: async ({
			conversationId,
			promptText,
			sessionKey,
			parentId,
			parentCID,
			conversationHasAnswer,
		}: {
			conversationId: number | string;
			promptText: string;
			sessionKey: CryptoKey;
			parentId: number | null;
			parentCID: string | null;
			conversationHasAnswer?: boolean;
		}) => {
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain || !sessionKey || !activeAccount) {
				throw new Error('Wallet not connected or session not ready.');
			}

			const contractConfig = CONTRACTS[chain.id];

			if (!contractConfig?.escrow) {
				throw new Error('Contracts not configured for this chain.');
			}
			const { encryptedPayload, roflEncryptedKey } = await createEncryptedPayloads(
				sessionKey,
				buildInitiatePromptPayload({
					promptText,
					conversationId,
					parentId,
					parentCID,
					conversationHasAnswer,
				}),
			);

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi as Parameters<typeof getContract>[0]['abi'],
			});
			const tx = prepareContractCall({
				contract: escrowContract,
				method: 'initiatePrompt',
				params: [conversationId || 0, encryptedPayload, roflEncryptedKey],
			} as unknown as Parameters<typeof prepareContractCall>[0]);
			const transactionReceipt = await sendAndConfirmTransaction({
				transaction: tx,
				account: activeAccount,
			});
			const promptSubmittedTopic = toEventSelector(
				getAbiItem({ abi: contractConfig.agent.abi, name: 'PromptSubmitted' }) as AbiEvent,
			);
			const logs = transactionReceipt.logs as unknown as EvmLog[];
			const log = logs.find(
				l =>
					l.address.toLowerCase() === contractConfig.agent.address.toLowerCase() &&
					l.topics[0] === promptSubmittedTopic,
			);

			if (!log) throw new Error('PromptSubmitted event log not found in transaction receipt.');
			const { args } = decodeEventLog({
				abi: contractConfig.agent.abi,
				topics: log.topics,
				data: log.data,
			}) as unknown as {
				args: { conversationId: bigint; promptMessageId: bigint; answerMessageId: bigint };
			};

			return {
				conversationId: args.conversationId.toString(),
				promptMessageId: args.promptMessageId.toString(),
				answerMessageId: args.answerMessageId.toString(),
			};
		},
		onSuccess: () => {
			// Immediate RPC update
			genericOnSuccess();
		},
		onError: error => genericOnError(error, 'send message'),
	});

	/**
	 * Represents the mutation for regenerating an AI response.
	 * It calls the `initiateRegeneration` function on the smart contract.
	 */
	const regenerateMutation = useMutation({
		mutationFn: async ({
			conversationId,
			promptMessageId,
			originalAnswerMessageId,
			instructions,
			sessionKey,
			promptMessageCID,
			originalAnswerMessageCID,
		}: {
			conversationId: number | string;
			promptMessageId: number | string;
			originalAnswerMessageId: number | string;
			instructions: string;
			sessionKey: CryptoKey;
			promptMessageCID: string;
			originalAnswerMessageCID: string;
		}) => {
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain || !sessionKey || !activeAccount) {
				throw new Error('Wallet not connected or session not ready.');
			}

			const contractConfig = CONTRACTS[chain.id];

			if (!contractConfig?.escrow) {
				throw new Error('Contracts not configured for this chain.');
			}

			const { encryptedPayload, roflEncryptedKey } = await createEncryptedPayloads(sessionKey, {
				instructions,
				promptMessageCID,
				originalAnswerMessageCID,
			});

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi as Parameters<typeof getContract>[0]['abi'],
			});
			const tx = prepareContractCall({
				contract: escrowContract,
				method: 'initiateRegeneration',
				params: [
					conversationId,
					promptMessageId,
					originalAnswerMessageId,
					encryptedPayload,
					roflEncryptedKey,
				],
			} as unknown as Parameters<typeof prepareContractCall>[0]);
			const transactionReceipt = await sendAndConfirmTransaction({
				transaction: tx,
				account: activeAccount,
			});
			const eventTopic = toEventSelector(
				getAbiItem({ abi: contractConfig.agent.abi, name: 'RegenerationRequested' }) as AbiEvent,
			);
			const logs = transactionReceipt.logs as unknown as EvmLog[];
			const log = logs.find(
				l =>
					l.address.toLowerCase() === contractConfig.agent.address.toLowerCase() &&
					l.topics[0] === eventTopic,
			);
			if (!log) throw new Error('RegenerationRequested event log not found.');
			const { args } = decodeEventLog({
				abi: contractConfig.agent.abi,
				topics: log.topics,
				data: log.data,
			}) as unknown as {
				args: { answerMessageId: bigint };
			};
			return { newAnswerMessageId: args.answerMessageId.toString() };
		},
		onSuccess: () => {
			// Immediate RPC update
			genericOnSuccess();
		},
		onError: error => genericOnError(error, 'regenerate response'),
	});

	/**
	 * Represents the mutation for branching a conversation.
	 * It calls the `initiateBranch` function on the smart contract.
	 */
	const branchConversationMutation = useMutation({
		mutationFn: async ({
			originalConversationId,
			branchPointMessageId,
			originalTitle,
			sessionKey,
		}: {
			originalConversationId: number | string;
			branchPointMessageId: number | string;
			originalTitle: string;
			sessionKey: CryptoKey;
		}) => {
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain || !sessionKey || !activeAccount) {
				throw new Error('Wallet not connected or session not ready.');
			}

			const contractConfig = CONTRACTS[chain.id];

			if (!contractConfig?.escrow) {
				throw new Error('Contracts not configured for this chain.');
			}

			const { encryptedPayload, roflEncryptedKey } = await createEncryptedPayloads(sessionKey, {
				originalTitle,
			});

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi as Parameters<typeof getContract>[0]['abi'],
			});
			const tx = prepareContractCall({
				contract: escrowContract,
				method: 'initiateBranch',
				params: [originalConversationId, branchPointMessageId, encryptedPayload, roflEncryptedKey],
			} as unknown as Parameters<typeof prepareContractCall>[0]);
			const transactionReceipt = await sendAndConfirmTransaction({
				transaction: tx,
				account: activeAccount,
			});
			const eventTopic = toEventSelector(
				getAbiItem({ abi: contractConfig.agent.abi, name: 'BranchRequested' }) as AbiEvent,
			);
			const logs = transactionReceipt.logs as unknown as EvmLog[];
			const log = logs.find(
				l =>
					l.address.toLowerCase() === contractConfig.agent.address.toLowerCase() &&
					l.topics[0] === eventTopic,
			);
			if (!log) throw new Error('BranchRequested event log not found.');
			const { args } = decodeEventLog({
				abi: contractConfig.agent.abi,
				topics: log.topics,
				data: log.data,
			}) as unknown as {
				args: { newConversationId: bigint };
			};
			return { newConversationId: args.newConversationId.toString() };
		},
		onSuccess: () => {
			// Immediate RPC update
			genericOnSuccess();
		},
		onError: error => genericOnError(error, 'branch conversation'),
	});

	/**
	 * Represents the mutation for updating metadata (renaming or deleting).
	 * It calls the `initiateMetadataUpdate` function on the smart contract.
	 */
	const metadataUpdateMutation = useMutation({
		mutationFn: async ({
			conversationId,
			title,
			isDeleted,
			sessionKey,
		}: {
			conversationId: number | string;
			title: string;
			isDeleted: boolean;
			sessionKey: CryptoKey;
		}) => {
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain || !sessionKey || !activeAccount) {
				throw new Error('Wallet not connected or session not ready.');
			}

			const contractConfig = CONTRACTS[chain.id];

			if (!contractConfig?.escrow) {
				throw new Error('Contracts not configured for this chain.');
			}

			const { encryptedPayload, roflEncryptedKey } = await createEncryptedPayloads(sessionKey, {
				title,
				isDeleted,
			});

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi as Parameters<typeof getContract>[0]['abi'],
			});
			const tx = prepareContractCall({
				contract: escrowContract,
				method: 'initiateMetadataUpdate',
				params: [conversationId, encryptedPayload, roflEncryptedKey],
			} as unknown as Parameters<typeof prepareContractCall>[0]);

			await sendAndConfirmTransaction({
				transaction: tx,
				account: activeAccount,
			});
			return { conversationId };
		},
		onSuccess: () => {
			// Immediate RPC update
			genericOnSuccess();
		},
		onError: error => genericOnError(error, 'update conversation'),
	});

	/**
	 * Represents the mutation for cancelling a pending prompt.
	 * It calls the `cancelPrompt` function on the smart contract.
	 * Useful if the Oracle is down or taking too long.
	 */
	const cancelPromptMutation = useMutation({
		mutationFn: async ({ answerMessageId }: { answerMessageId: number | string }) => {
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain) throw new Error('Wallet not connected');

			const contractConfig = CONTRACTS[chain.id];
			if (!contractConfig?.escrow) throw new Error('Contracts not configured for this chain.');

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi as Parameters<typeof getContract>[0]['abi'],
			});

			const tx = prepareContractCall({
				contract: escrowContract,
				method: 'cancelPrompt',
				params: [answerMessageId],
			} as unknown as Parameters<typeof prepareContractCall>[0]);

			await sendAndConfirmTransaction({
				transaction: tx,
				account: activeAccount!,
			});
		},
		onSuccess: () => {
			toast.success('Prompt Cancelled', {
				description: 'The prompt has been cancelled and tokens refunded.',
			});

			// Immediate RPC update
			genericOnSuccess();
		},
		onError: error => genericOnError(error, 'cancel prompt'),
	});

	/**
	 * Represents the mutation for processing a refund for a stuck prompt (older than 1 hour).
	 * It calls the `processRefund` function on the smart contract.
	 */
	const processRefundMutation = useMutation({
		mutationFn: async ({ answerMessageId }: { answerMessageId: number | string }) => {
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain) throw new Error('Wallet not connected');

			const contractConfig = CONTRACTS[chain.id];
			if (!contractConfig?.escrow) throw new Error('Contracts not configured for this chain.');

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi as Parameters<typeof getContract>[0]['abi'],
			});

			const tx = prepareContractCall({
				contract: escrowContract,
				method: 'processRefund',
				params: [answerMessageId],
			} as unknown as Parameters<typeof prepareContractCall>[0]);

			await sendAndConfirmTransaction({
				transaction: tx,
				account: activeAccount!,
			});
		},
		onSuccess: () => {
			toast.success('Refund Processed', {
				description: 'Your pending request count has been cleared.',
			});

			// Immediate RPC update
			genericOnSuccess();
		},
		onError: error => genericOnError(error, 'process refund'),
	});

	return {
		initiatePromptMutation,
		regenerateMutation,
		branchConversationMutation,
		metadataUpdateMutation,
		cancelPromptMutation,
		processRefundMutation,
	};
}
