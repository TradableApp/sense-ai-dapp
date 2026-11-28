import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getContract, prepareContractCall, sendAndConfirmTransaction } from 'thirdweb';
import { useActiveAccount, useActiveWallet } from 'thirdweb/react';
import { type AbiEvent, decodeEventLog, getAbiItem, toEventSelector, toHex } from 'viem';

import InsufficientBalanceNotice, {
	offersAWayToGetMore,
} from '@/components/InsufficientBalanceNotice';
import { CONTRACTS, LOCAL_CHAIN_ID, TESTNET_CHAIN_ID } from '@/config/contracts';
import { FEE_TOKEN, type FeeTokenProfile, TRANSFER_RESTRICTION_ABI } from '@/config/feeToken';
import { client } from '@/config/thirdweb';
import { useSession } from '@/features/auth/SessionProvider';
import useFaucetRequest, { FAUCET_OFFER_TOAST_ID } from '@/hooks/useFaucetRequest';
import usePaymentGate from '@/hooks/usePaymentGate';
import EVMAIAgentABI from '@/lib/abi/EVMAIAgent.json';
import EVMAIAgentEscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';
import branchTitle from '@/lib/branchTitle';
import { messageNamesError } from '@/lib/contractErrorSelector';
import { encryptData } from '@/lib/crypto';
import eciesEncrypt from '@/lib/ecies';
import type { FeeTokenCheckState, PaidAction } from '@/lib/feeTokenCheck';
import { CANCEL_ACTION, REFUND_ACTION, refusedTransferMessage } from '@/lib/feeTokenRefusal';
import {
	NOTHING_REFUNDED_MESSAGE,
	NothingRefundedError,
	receiptCarries,
	receiptRefunded,
} from '@/lib/nothingRefunded';
import { NotRecordedError, notRecordedMessage } from '@/lib/notRecorded';
import { PaymentSwitchedOffError } from '@/lib/paymentGate';
import {
	BRANCH_ACTION,
	METADATA_ACTION,
	REGENERATE_ACTION,
	revertedMessage,
	SEND_MESSAGE_ACTION,
	throwIfReverted,
	TransactionRevertedError,
} from '@/lib/revertedTransaction';
import {
	notConfirmedMessage,
	rethrowUnconfirmed,
	TransactionNotConfirmedError,
} from '@/lib/unconfirmedTransaction';

import { getTokenBalanceQueryKey } from './useTokenBalance';

type EvmLog = {
	address: `0x${string}`;
	topics: [`0x${string}`, ...`0x${string}`[]];
	data: `0x${string}`;
};

type SendOptions = Parameters<typeof sendAndConfirmTransaction>[0];

/**
 * Sends a transaction and waits for its receipt, which thirdweb resolves whether the
 * transaction succeeded or reverted: anything but `success` throws `TransactionRevertedError`
 * for `action`, so nothing after it runs as if it had happened. A receipt that has not come
 * within thirdweb's wait throws `TransactionNotConfirmedError`: the transaction was sent and
 * may still be mined. The only sender here (the receipt-status guard).
 *
 * thirdweb's wait is 100 blocks, and `sendAndConfirmTransaction` takes no other: neither
 * thirdweb's chain definitions nor this repo give a chain's block time to set one from.
 */
async function sendConfirmed(
	transaction: SendOptions['transaction'],
	account: SendOptions['account'],
	action: string,
): ReturnType<typeof sendAndConfirmTransaction> {
	const receipt = await sendAndConfirmTransaction({ transaction, account }).catch(
		rethrowUnconfirmed(action),
	);
	throwIfReverted(receipt, action);
	return receipt;
}

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
	/**
	 * Whether the conversation was branched from another. A branch exists from the moment it is
	 * made (the oracle stores its conversation file, with where it was branched from, when it
	 * confirms the branch), so its prompts are never "new", whatever `conversationHasAnswer`
	 * says. Flagged new, the oracle would write the conversation file again without the origin.
	 */
	hasBranchOrigin?: boolean;
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
	hasBranchOrigin = false,
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
		//
		// A branch is never new: see `hasBranchOrigin`.
		isNewConversation: !conversationId || (conversationHasAnswer === false && !hasBranchOrigin),
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
 * @param {FeeTokenProfile} feeToken - the token that pays the fees; names the token in messages
 * @param {FeeTokenCheckState} verdict - what the fee token check found; words a refused cancellation
 * @returns {(error: unknown, action: string) => void}
 */
export function buildErrorHandler(
	isTestnet: boolean,
	isLocalnet: boolean,
	faucetAmount: number,
	handleFaucetRequest: () => Promise<void>,
	feeToken: FeeTokenProfile = FEE_TOKEN,
	verdict: FeeTokenCheckState = 'unknown',
): (_error: unknown, _action: string) => void {
	return function genericOnError(error: unknown, action: string): void {
		if (error instanceof PaymentSwitchedOffError) {
			// Refused by the payment gate before anything was sent; the banner says the same.
			toast.error(error.notice.title, { description: error.notice.description });
			return;
		}
		// The chain's own answer, not a fault here: told to the user, not printed as an error.
		if (error instanceof TransactionRevertedError) {
			const { title, description } = revertedMessage(error.action);
			toast.error(title, { description });
			return;
		}
		// Sent and not yet confirmed: it may still go through, so it is not called a failure.
		if (error instanceof TransactionNotConfirmedError) {
			const { title, description } = notConfirmedMessage(error.action);
			toast.warning(title, { description });
			return;
		}
		if (error instanceof NotRecordedError) {
			const { title, description } = notRecordedMessage(error.action);
			toast.error(title, { description });
			return;
		}
		if (error instanceof NothingRefundedError) {
			toast.error(NOTHING_REFUNDED_MESSAGE.title, {
				description: NOTHING_REFUNDED_MESSAGE.description,
			});
			return;
		}
		console.error(`Failed to ${action}:`, error);
		const errorMessage =
			(error instanceof Error
				? error.message
				: typeof error === 'object' && error !== null && 'message' in error
				? String((error as { message: unknown }).message)
				: String(error)) || '';

		const isError = (abi: readonly unknown[], name: string) =>
			messageNamesError(errorMessage, abi, name);

		// A cancel takes its fee from the user's wallet through the plan (cancelPrompt in
		// EVMAIAgentEscrow), so it is refused when the plan's remaining limit, the token approval
		// or the balance is below the fee. Raising the limit is switched off while a prompt is
		// pending, so the message says what is left to the user.
		if (
			action === CANCEL_ACTION &&
			(isError(EVMAIAgentEscrowABI.abi, 'InsufficientSpendingLimitAllowance') ||
				isError(feeToken.abi, 'ERC20InsufficientAllowance') ||
				isError(feeToken.abi, 'ERC20InsufficientBalance'))
		) {
			toast.error('Could Not Cancel', {
				description:
					"The cancellation fee could not be taken: your plan's remaining limit, the token approval or your balance is below it. Nothing was cancelled. The prompt can be refunded one hour after it was sent, unless it is answered first.",
			});
			return;
		}

		// --- Token Errors ---
		if (isError(feeToken.abi, 'ERC20InsufficientBalance')) {
			const faucetOffer =
				isTestnet || isLocalnet
					? {
							label: `Get ${faucetAmount} ${isLocalnet ? 'Localnet' : 'Testnet'} ${
								feeToken.symbol
							}`,
							onRequest: handleFaucetRequest,
					  }
					: null;
			toast.error(`Insufficient ${feeToken.symbol} Balance`, {
				description: <InsufficientBalanceNotice profile={feeToken} faucetOffer={faucetOffer} />,
				// Kept up while it offers something to click; a faucet request closes it by this id.
				id: FAUCET_OFFER_TOAST_ID,
				duration: offersAWayToGetMore(feeToken, !!faucetOffer) ? Infinity : 4000,
			});
			return;
		}

		if (isError(feeToken.abi, 'ERC20InsufficientAllowance')) {
			toast.error('Spending Limit Reached', {
				description:
					'The contract is not authorized to spend your tokens. Please increase your limit.',
			});
			return;
		}

		// A token that moves only to or from listed addresses refuses a transfer whose other
		// party is not listed. Nothing the user can do changes that. Looked for whichever token
		// the build is for: only that kind of token can raise it, and a build pointed at the
		// wrong token should still explain the failure.
		if (isError(TRANSFER_RESTRICTION_ABI, 'TransferNotAllowed')) {
			const { title, description } = refusedTransferMessage(action, verdict);
			toast.error(title, { description });
			return;
		}

		if (isError(feeToken.abi, 'EnforcedPause')) {
			const { title, description } = refusedTransferMessage(action, verdict, 'paused');
			toast.error(title, { description });
			return;
		}

		if (isError(EVMAIAgentEscrowABI.abi, 'SafeERC20FailedOperation')) {
			toast.error('Payment Failed', {
				description:
					'The token transfer did not go through, so no tokens were taken. Please try again.',
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
				// The button is offered only after the hour (and a margin) on this device's clock, so
				// a refusal means the network's clock has not yet reached it. A device clock that runs
				// ahead makes that wait as long as it is ahead, so no time is promised.
				description:
					"The hour since the request was sent has not yet passed on the network, though it may have on this device's clock. The refund opens once it has.",
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
	const { requestTokensFromOffer: handleFaucetRequest, faucetAmount } = useFaucetRequest();
	const queryClient = useQueryClient();
	const { ownerAddress } = useSession();
	const paymentGate = usePaymentGate();
	// Every paying mutation asks this first, so a new caller cannot send what the payment gate
	// (the fee token check and the prompts switch) refuses. Cancel and refund never ask:
	// getting money back stays possible.
	const refuseIfSwitchedOff = (action: PaidAction) => {
		if (paymentGate.blocks(action))
			throw new PaymentSwitchedOffError(paymentGate.state, action, FEE_TOKEN.symbol);
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
		FEE_TOKEN,
		paymentGate.state.feeToken,
	);

	// A transaction that was mined spent gas and may have met a changed state (an answer that
	// landed, a plan changed elsewhere) even when it reverted or did nothing, so the plan and the
	// balance are read again before the failure is told. So they are for one that was sent and
	// not yet confirmed, which may still be mined.
	const onFailure =
		(action: string, queryKeysToRefresh: string[] = []) =>
		(error: Error) => {
			if (
				error instanceof TransactionRevertedError ||
				error instanceof NotRecordedError ||
				error instanceof NothingRefundedError ||
				error instanceof TransactionNotConfirmedError
			) {
				genericOnSuccess(queryKeysToRefresh);
			}
			genericOnError(error, action);
		};

	// A paid send that was not confirmed may still land: the history is asked for again, so a
	// send that did shows through the sync. The messages query is keyed without the session key
	// (see Chat.tsx); a conversation id of 0 is a new conversation, which has no messages yet.
	const onPaidSendFailure =
		(action: string) =>
		(
			error: Error,
			{ sessionKey, conversationId }: { sessionKey: CryptoKey; conversationId?: number | string },
		) => {
			if (error instanceof TransactionNotConfirmedError) {
				queryClient.invalidateQueries({ queryKey: ['conversations', sessionKey, ownerAddress] });
				if (conversationId) {
					queryClient.invalidateQueries({
						queryKey: ['messages', String(conversationId), ownerAddress],
					});
				}
			}
			onFailure(action)(error);
		};

	// --- MUTATIONS ---

	/**
	 * Represents the mutation for both creating a new conversation and sending a follow-up prompt.
	 * It calls the `initiatePrompt` function on the smart contract.
	 * Upon success, it parses the transaction receipt to find and return the real, on-chain IDs.
	 */
	const initiatePromptMutation = useMutation({
		mutationKey: ['paid-send', 'prompt'],
		mutationFn: async ({
			conversationId,
			promptText,
			sessionKey,
			parentId,
			parentCID,
			conversationHasAnswer,
			hasBranchOrigin,
		}: {
			conversationId: number | string;
			promptText: string;
			sessionKey: CryptoKey;
			parentId: number | null;
			parentCID: string | null;
			conversationHasAnswer?: boolean;
			hasBranchOrigin?: boolean;
		}) => {
			refuseIfSwitchedOff('prompt');
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
					hasBranchOrigin,
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
			const transactionReceipt = await sendConfirmed(tx, activeAccount, SEND_MESSAGE_ACTION);
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
		onError: onPaidSendFailure(SEND_MESSAGE_ACTION),
	});

	/**
	 * Represents the mutation for regenerating an AI response.
	 * It calls the `initiateRegeneration` function on the smart contract.
	 */
	const regenerateMutation = useMutation({
		mutationKey: ['paid-send', 'regenerate'],
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
			refuseIfSwitchedOff('prompt');
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
			const transactionReceipt = await sendConfirmed(tx, activeAccount, REGENERATE_ACTION);
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
		onError: onPaidSendFailure(REGENERATE_ACTION),
	});

	/**
	 * Represents the mutation for branching a conversation.
	 * It calls the `initiateBranch` function on the smart contract.
	 */
	const branchConversationMutation = useMutation({
		mutationKey: ['paid-send', 'branch'],
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
			refuseIfSwitchedOff('branch');
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain || !sessionKey || !activeAccount) {
				throw new Error('Wallet not connected or session not ready.');
			}

			const contractConfig = CONTRACTS[chain.id];

			if (!contractConfig?.escrow) {
				throw new Error('Contracts not configured for this chain.');
			}

			// Cut here, so no caller can send a title the oracle refuses after the fee is paid.
			const { encryptedPayload, roflEncryptedKey } = await createEncryptedPayloads(sessionKey, {
				originalTitle: branchTitle(originalTitle),
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
			const transactionReceipt = await sendConfirmed(tx, activeAccount, BRANCH_ACTION);
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
		// A branch adds a conversation and no message: it names no conversationId, so only the list
		// is asked for.
		onError: onPaidSendFailure(BRANCH_ACTION),
	});

	/**
	 * Represents the mutation for updating metadata (renaming or deleting).
	 * It calls the `initiateMetadataUpdate` function on the smart contract.
	 */
	const metadataUpdateMutation = useMutation({
		mutationKey: ['metadata-send'],
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
			refuseIfSwitchedOff('metadata');
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

			// A reverted change throws here, and so does one the agent did not record for this
			// conversation, so the history's save on this device never runs for either.
			const receipt = await sendConfirmed(tx, activeAccount, METADATA_ACTION);
			if (
				!receiptCarries(
					receipt.logs,
					contractConfig.agent.address,
					contractConfig.agent.abi as readonly unknown[],
					'MetadataUpdateRequested',
					'conversationId',
					conversationId,
				)
			) {
				throw new NotRecordedError(METADATA_ACTION);
			}
			return { conversationId };
		},
		onSuccess: () => {
			// Immediate RPC update
			genericOnSuccess();
		},
		onError: onFailure(METADATA_ACTION),
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

			const receipt = await sendConfirmed(tx, activeAccount!, CANCEL_ACTION);
			if (
				!receiptCarries(
					receipt.logs,
					contractConfig.escrow.address,
					contractConfig.escrow.abi as readonly unknown[],
					'PromptCancelled',
					'answerMessageId',
					answerMessageId,
				)
			) {
				throw new NotRecordedError(CANCEL_ACTION);
			}
		},
		onSuccess: () => {
			toast.success('Prompt Cancelled', {
				description: 'The prompt has been cancelled and tokens refunded.',
			});

			// Immediate RPC update
			genericOnSuccess();
		},
		onError: onFailure(CANCEL_ACTION),
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

			const receipt = await sendConfirmed(tx, activeAccount!, REFUND_ACTION);
			if (
				!receiptRefunded(
					receipt.logs,
					contractConfig.escrow.address,
					contractConfig.escrow.abi as readonly unknown[],
					answerMessageId,
				)
			) {
				throw new NothingRefundedError();
			}
		},
		onSuccess: () => {
			toast.success('Refund Processed', {
				description: 'Your pending request count has been cleared.',
			});

			// Immediate RPC update. The stuck requests are read again too: each is checked against
			// the escrow, which no longer holds this one, so it is not offered a second time.
			genericOnSuccess(['stuckRequests']);
		},
		onError: onFailure(REFUND_ACTION, ['stuckRequests']),
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
