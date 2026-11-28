import {
	type QueryClient,
	useIsMutating,
	useMutation,
	type UseMutationResult,
	useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { type Chain, getContract, prepareContractCall } from 'thirdweb';
import { useActiveWallet, useSendAndConfirmTransaction } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { FEE_TOKEN } from '@/config/feeToken';
import { client } from '@/config/thirdweb';
import { useIsAwaitingFirstAnswer } from '@/hooks/useFeeTokenCheck';
import usePaymentGate from '@/hooks/usePaymentGate';
import { getTokenBalanceQueryKey } from '@/hooks/useTokenBalance';
import { describeFailure } from '@/lib/feeTokenCheckFailure';
import { AWAITING_CHECK_REASON } from '@/lib/feeTokenRefusal';
import { PaymentSwitchedOffError } from '@/lib/paymentGate';
import { isReceiptNotFound } from '@/lib/unconfirmedTransaction';
import { wait } from '@/lib/utils';

import ApprovalNotClearedError, {
	type ApprovalNotClearedStep,
	REMOVE_APPROVAL_LABEL,
} from './ApprovalNotClearedError';
import ClearApprovalRefusedError from './ClearApprovalRefusedError';
import { readEscrowAllowance, readLimitStands, readPendingCount } from './escrowReads';
import LimitNotSetError from './LimitNotSetError';
import PromptPendingError, {
	isPendingPromptsRefusal,
	PROMPT_PENDING_TITLE,
	promptPendingMessage,
} from './PromptPendingError';

/** An approval whose receipt did not come within thirdweb's wait. */
const APPROVAL_UNCONFIRMED =
	'The approval was sent but is not confirmed yet and may still be mined. No limit was sent. Check your wallet, then set the plan again once the approval shows there.';

/**
 * What a failure says: a fixed sentence on what holds, then the first line of the error,
 * scrubbed and capped (thirdweb's text runs on with the RPC URL, which can carry a key, and
 * the call data, which holds the wallet address).
 */
function failureDescription(lead: string, error: unknown): string {
	const { line } = describeFailure(error);
	return line ? `${lead} Reason: ${line}` : lead;
}

const SET_FAILED = 'The plan was not set. Please try again.';
const REVOKE_FAILED = 'The plan was not revoked and still stands. Please try again.';

/** A cancel whose receipt did not come within thirdweb's wait. */
const REVOKE_UNCONFIRMED =
	'The revoke was sent but is not confirmed yet and may still be mined. Check your wallet. The plan here updates once it is; if a token approval is left then, the dashboard offers to remove it.';

/**
 * Setting and revoking a spending plan: the only transactions the plan dialog sends.
 *
 * Setting a plan approves the fee token, so it asks the payment gate first and refuses before
 * anything is built while plans are switched off, or while the fee token check has not yet
 * answered once. Revoking never asks: taking back a permission must stay possible always.
 * Revoking cancels the escrow's limit and then sets the token approval for the escrow to
 * zero; removing that approval again, from the notice a half-finished revoke shows, never
 * asks either.
 */

interface PlanMutationOptions {
	/** The step being waited for, shown on the submit button. */
	onStatus: (_text: string) => void;
	/** Called once the plan has changed on chain and the queries have been asked again. */
	onDone: () => void;
}

export interface PlanRequest {
	limitInWei: bigint;
	expiresAtTimestamp: bigint;
}

type ContractConfig = (typeof CONTRACTS)[number];
type SendAndConfirm = ReturnType<typeof useSendAndConfirmTransaction>['mutateAsync'];
type ContractCall = Parameters<typeof prepareContractCall>[0];
type ContractAbi = Parameters<typeof getContract>[0]['abi'];

/** Setting a plan waits for the fee token check's first answer; nothing has been sent. */
class PlanHeldError extends Error {
	constructor() {
		super(AWAITING_CHECK_REASON);
		this.name = 'PlanHeldError';
	}
}

// How long to let the node catch up: before the second transaction (so it sees the first
// one's nonce) and before the queries are asked again (so they do not read the old state).
const NODE_CATCH_UP_MS = 2000;

/** The connected chain and its contracts, or an error saying which is missing. */
function connectedContracts(wallet: ReturnType<typeof useActiveWallet>) {
	// Read once: a network change between two reads would pair one chain with another's contracts.
	const chain = wallet?.getChain();
	if (!wallet || !chain?.id) throw new Error('Wallet not connected');
	const contracts = CONTRACTS[chain.id];
	if (!contracts) throw new Error('Contracts not configured for this chain');
	return { chain, contracts };
}

// The ABIs are JSON imports, so their method names are not known to the type checker; the
// casts below hand thirdweb a call it would otherwise type against an empty ABI.
function contractCall(
	chain: Chain,
	config: { address: string; abi: unknown },
	method: string,
	params?: readonly unknown[],
) {
	const contract = getContract({
		client,
		chain,
		address: config.address,
		abi: config.abi as ContractAbi,
	});
	return prepareContractCall({
		contract,
		method,
		...(params && { params }),
	} as unknown as ContractCall);
}

/**
 * Approves the limit for the escrow, then sets it there: two signatures in the wallet.
 * `beforeLimit` throws if the limit may no longer be set (the gate is asked again).
 */
async function approveAndSetLimit(
	send: SendAndConfirm,
	chain: Chain,
	contracts: ContractConfig,
	{ limitInWei, expiresAtTimestamp }: PlanRequest,
	onStatus: (_text: string) => void,
	beforeLimit: () => void,
): Promise<void> {
	onStatus('1/2: Approving...');
	const approvalToastId = toast.info(
		'Step 1/2: Please approve the token spending limit in your wallet.',
	);
	// The notice now showing. Only it is taken down on a failure: a dismissal of every toast
	// would also take down the notice of a new version.
	let noticeId = approvalToastId;
	let isApproved = false;
	try {
		const approval = await send(
			contractCall(chain, contracts.token, 'approve', [contracts.escrow.address, limitInWei]),
		);
		// A mined transaction that reverted still resolves; only its status says it failed.
		if (approval.status !== 'success') {
			throw new Error('The approval was reverted on chain, so nothing was approved.');
		}
		isApproved = true;
		toast.dismiss(approvalToastId);

		onStatus('Waiting for network...');
		await wait(NODE_CATCH_UP_MS);
		// Prompts may have closed while the approval was confirmed: the approval stands, so a
		// refusal here is a limit not set, which says so and how to revoke.
		beforeLimit();

		onStatus('2/2: Setting Limit...');
		const limitToastId = toast.info(
			'Step 2/2: Please confirm setting the new spending limit in your wallet.',
		);
		noticeId = limitToastId;
		const limit = await send(
			contractCall(chain, contracts.escrow, 'setSpendingLimit', [limitInWei, expiresAtTimestamp]),
		);
		if (limit.status !== 'success') {
			throw new Error('the limit transaction was reverted on chain');
		}
		toast.dismiss(limitToastId);
	} catch (error) {
		toast.dismiss(noticeId);
		throw isApproved ? new LimitNotSetError(error) : error;
	}
}

const SUCCESS_TITLE = 'Access Revoked';
const SUCCESS_DESCRIPTION = 'The AI agent can no longer spend your tokens.';

/** The removal alone: no plan was standing when it was sent, so it did not revoke one. */
const CLEARED_TITLE = 'Approval Removed';
const CLEARED_DESCRIPTION = 'The AI agent is no longer approved to use your tokens.';

// One id for the notice that offers the approval of zero again, so a second failure
// replaces it rather than stacking a second one, and a new plan can take it down.
const APPROVAL_NOT_CLEARED_TOAST_ID = 'plan-approval-not-cleared';

/**
 * Sets the approval for the escrow to zero: one signature. Anything short of a confirmed
 * success is an `ApprovalNotClearedError`, worded for the `step` it is part of.
 */
async function clearApproval(
	send: SendAndConfirm,
	chain: Chain,
	contracts: ContractConfig,
	notice: string,
	step: ApprovalNotClearedStep,
	owner: string | undefined,
): Promise<void> {
	const noticeId = toast.info(notice);
	try {
		const receipt = await send(
			contractCall(chain, contracts.token, 'approve', [contracts.escrow.address, 0n]),
		);
		if (receipt.status !== 'success') {
			throw new Error('The approval of zero was reverted on chain, so the approval is unchanged.');
		}
	} catch (error) {
		throw new ApprovalNotClearedError(error, undefined, step, owner);
	} finally {
		toast.dismiss(noticeId);
	}
}

function isSameAddress(one: string | undefined, other: string | undefined): boolean {
	return !!one && !!other && one.toLowerCase() === other.toLowerCase();
}

/**
 * Cancels the escrow's limit, then removes the approval for the escrow when one is left.
 * The limit goes first: if the second step is declined, the plan is still gone. The other
 * order would leave a limit standing with no approval behind it.
 */
async function cancelLimitAndClearApproval(
	send: SendAndConfirm,
	chain: Chain,
	contracts: ContractConfig,
	owner: string | undefined,
	currentAccount: () => string | undefined,
): Promise<void> {
	const revokeToastId = toast.info(
		'Please confirm the transaction in your wallet to revoke access.',
	);
	try {
		const cancel = await send(contractCall(chain, contracts.escrow, 'cancelSpendingLimit'));
		// A mined transaction that reverted still resolves; only its status says it failed.
		if (cancel.status !== 'success') {
			throw new Error('the revoke transaction was reverted on chain');
		}
	} finally {
		toast.dismiss(revokeToastId);
	}

	await wait(NODE_CATCH_UP_MS);
	let allowance: bigint;
	try {
		allowance = await readEscrowAllowance(chain, contracts, owner);
	} catch (error) {
		throw new ApprovalNotClearedError(error, 'unchecked', 'revoke', owner);
	}
	if (allowance === 0n) return;
	// thirdweb sends from the account selected now: another one would remove its own approval
	// and leave this one's in place.
	if (!isSameAddress(currentAccount(), owner)) {
		throw new ApprovalNotClearedError(
			new Error('The account changed'),
			'account-changed',
			'revoke',
			owner,
		);
	}
	// A plan set meanwhile from another tab or device (one query client holds only its own
	// plan transactions to one at a time): the approval is now that plan's, and an approval
	// of zero would leave it unable to pay for any prompt. Read as the removal on its own
	// reads it; a read that fails sends nothing.
	let isLimitStanding: boolean;
	try {
		isLimitStanding = await readLimitStands(chain, contracts, owner);
	} catch (error) {
		throw new ApprovalNotClearedError(error, 'plan-unchecked', 'revoke', owner);
	}
	if (isLimitStanding) {
		throw new ApprovalNotClearedError(
			new Error('A limit stands again'),
			'plan-active-again',
			'revoke',
			owner,
		);
	}

	await clearApproval(
		send,
		chain,
		contracts,
		'Step 2/2: Please confirm removing the token approval in your wallet.',
		'revoke',
		owner,
	);
}

/**
 * What the user is told when the approval was not removed, with the step offered again,
 * except after an account change: the step would go from the account selected now.
 */
function showApprovalNotCleared(error: ApprovalNotClearedError, retry: () => void): void {
	const show = error.kind === 'failed' ? toast.error : toast.warning;
	// Not after an account change (it would go from the account selected now), nor under a
	// plan set meanwhile (it would be refused, and the plan's approval is not to be removed).
	const isOffered = error.kind !== 'account-changed' && error.kind !== 'plan-active-again';
	show(error.title, {
		id: APPROVAL_NOT_CLEARED_TOAST_ID,
		description: error.message,
		// Kept until closed: the action is the only way here to send the step again.
		duration: Infinity,
		// Named even when absent: a notice shown under the same id keeps what it is not given.
		action: isOffered ? { label: REMOVE_APPROVAL_LABEL, onClick: retry } : undefined,
	});
}

/** Asks the plan and the wallet's balance again, after the node has caught up. */
async function refreshPlanQueries(
	queryClient: QueryClient,
	wallet: ReturnType<typeof useActiveWallet>,
): Promise<void> {
	await wait(NODE_CATCH_UP_MS);
	const chainId = wallet?.getChain()?.id ?? 0;
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: ['usagePlan'], refetchType: 'all' }),
		queryClient.invalidateQueries({
			queryKey: getTokenBalanceQueryKey(
				chainId,
				wallet?.getAccount()?.address,
				CONTRACTS[chainId]?.token?.address,
			),
			refetchType: 'all',
		}),
	]);
}

/**
 * Starts reading the plan and balance again without waiting for it. Used where a notice with
 * an action has just been shown: while the mutation waits, a press of that action would be
 * refused as a transaction under way, and pressing closes the notice.
 */
function refreshPlanQueriesSoon(
	queryClient: QueryClient,
	wallet: ReturnType<typeof useActiveWallet>,
): void {
	refreshPlanQueries(queryClient, wallet).catch(error =>
		console.error('refreshPlanQueries Error:', error instanceof Error ? error.name : typeof error),
	);
}

/**
 * The key every plan transaction (set, revoke, remove the approval) is declared with, so one
 * under way is seen from the query client by every mounted dialog and notice.
 */
export const PLAN_SEND_KEY = ['plan-send'];

type PlanSend<TVariables> = UseMutationResult<void, Error, TVariables>;

/**
 * `mutation`, whose `mutate` does nothing and whose `mutateAsync` rejects, sending nothing,
 * while any plan transaction is under way. It is read from the query client's mutation
 * cache, which marks a mutation pending the moment it starts, so a second press in the same
 * moment is refused too, and so is one from a dialog opened again or from a notice.
 */
function startedAlone<TVariables>(
	mutation: PlanSend<TVariables>,
	queryClient: QueryClient,
): PlanSend<TVariables> {
	const isUnderWay = () => queryClient.isMutating({ mutationKey: PLAN_SEND_KEY }) > 0;
	return {
		...mutation,
		mutate: (variables, options) => {
			if (!isUnderWay()) mutation.mutate(variables, options);
		},
		// Rejects rather than resolving, so an awaited start never reads as one that ran.
		mutateAsync: async (variables, options) => {
			if (isUnderWay()) throw new Error('A plan transaction is already under way');
			await mutation.mutateAsync(variables, options);
		},
	} as PlanSend<TVariables>;
}

/**
 * Refuses, before anything is built, a plan while the escrow holds one of the wallet's prompts
 * pending: the escrow refuses the limit then (`HasPendingPrompts`), and the approval sent
 * before it would already have replaced the old one. The dialog is disabled too, but on the
 * count it last read; a prompt sent from another tab since is seen only here. A read that
 * fails refuses nothing: the escrow still refuses the limit itself, which is then a limit not
 * set and says so.
 */
async function refuseIfPromptPending(
	chain: Chain,
	contracts: ContractConfig,
	owner: string | undefined,
): Promise<void> {
	let pending: bigint;
	try {
		pending = await readPendingCount(chain, contracts, owner);
	} catch (error) {
		console.error(
			'setPlanMutation pending count read Error:',
			error instanceof Error ? error.name : typeof error,
		);
		return;
	}
	if (pending > 0n) throw new PromptPendingError();
}

function useSetPlanMutation({ onStatus, onDone }: PlanMutationOptions) {
	const activeWallet = useActiveWallet();
	const { mutateAsync: send } = useSendAndConfirmTransaction();
	const queryClient = useQueryClient();
	const paymentGate = usePaymentGate();
	const isAwaitingFirstAnswer = useIsAwaitingFirstAnswer();
	const refuseIfClosedNow = () => {
		if (paymentGate.blocksNow('plan'))
			throw new PaymentSwitchedOffError(paymentGate.stateNow(), 'plan', FEE_TOKEN.symbol);
	};

	const mutation = useMutation<void, Error, PlanRequest>({
		mutationKey: PLAN_SEND_KEY,
		mutationFn: async plan => {
			// The form is disabled too; this is the refusal that holds whoever calls it.
			if (paymentGate.blocks('plan'))
				throw new PaymentSwitchedOffError(paymentGate.state, 'plan', FEE_TOKEN.symbol);
			// Nothing has said yet that this is the right token to approve.
			if (isAwaitingFirstAnswer) throw new PlanHeldError();
			const { chain, contracts } = connectedContracts(activeWallet);
			await refuseIfPromptPending(chain, contracts, activeWallet?.getAccount()?.address);
			// The notice's action sends an approval of zero: pressed after this plan, it would
			// leave the new limit with nothing to spend. Taken down only once a plan will be sent.
			toast.dismiss(APPROVAL_NOT_CLEARED_TOAST_ID);
			await approveAndSetLimit(send, chain, contracts, plan, onStatus, refuseIfClosedNow);
		},
		onSuccess: async () => {
			toast.success('Spending Limit Set!', { description: 'Your new plan is now active.' });
			await refreshPlanQueries(queryClient, activeWallet);
			onDone();
		},
		onError: async error => {
			console.error('setPlanMutation Error:', error);
			if (error instanceof LimitNotSetError) {
				// Half done: the approval is on chain, so what the dialog shows is read again.
				if (error.isUnconfirmed) {
					toast.warning('Limit Not Confirmed', { description: error.message });
				} else {
					toast.error('Limit Not Set', { description: error.message });
				}
				await refreshPlanQueries(queryClient, activeWallet);
				return;
			}
			// No receipt came for the approval: it was sent and may still be mined, so it is not
			// called a failure, and what the dialog shows is read again.
			if (isReceiptNotFound(error)) {
				toast.warning('Approval Not Confirmed', { description: APPROVAL_UNCONFIRMED });
				await refreshPlanQueries(queryClient, activeWallet);
				return;
			}
			// Refused or held before anything was sent: not a failed transaction.
			// Their words are the gate's own, with nothing from the chain in them.
			if (error instanceof PaymentSwitchedOffError || error instanceof PlanHeldError) {
				toast.error('Not sent', { description: error.message });
				return;
			}
			if (error instanceof PromptPendingError) {
				toast.error(PROMPT_PENDING_TITLE, { description: error.message });
				return;
			}
			toast.error('Transaction Failed', { description: failureDescription(SET_FAILED, error) });
		},
	});
	return startedAlone(mutation, queryClient);
}

function useRevokePlanMutation({
	onDone,
	retryClear,
}: Pick<PlanMutationOptions, 'onDone'> & { retryClear: (_owner: string | undefined) => void }) {
	const activeWallet = useActiveWallet();
	const { mutateAsync: send } = useSendAndConfirmTransaction();
	const queryClient = useQueryClient();

	const mutation = useMutation<void, Error, void>({
		mutationKey: PLAN_SEND_KEY,
		mutationFn: async () => {
			const { chain, contracts } = connectedContracts(activeWallet);
			await cancelLimitAndClearApproval(
				send,
				chain,
				contracts,
				activeWallet?.getAccount()?.address,
				() => activeWallet?.getAccount()?.address,
			);
		},
		onSuccess: async () => {
			toast.success(SUCCESS_TITLE, { description: SUCCESS_DESCRIPTION });
			await refreshPlanQueries(queryClient, activeWallet);
			onDone();
		},
		onError: async error => {
			console.error('revokeMutation Error:', error.name);
			if (error instanceof ApprovalNotClearedError) {
				// The limit is cancelled: the plan is gone, so the dialog closes and the
				// dashboard is read again, and the notice offers the step that is left.
				showApprovalNotCleared(error, () => retryClear(error.owner));
				refreshPlanQueriesSoon(queryClient, activeWallet);
				onDone();
				return;
			}
			// No receipt came for the cancel: it may still be mined, so nothing is called revoked
			// or failed, and what the dashboard shows is read again.
			if (isReceiptNotFound(error)) {
				toast.warning('Revoke Not Confirmed', { description: REVOKE_UNCONFIRMED });
				await refreshPlanQueries(queryClient, activeWallet);
				return;
			}
			// The escrow refuses a revoke while a prompt is pending: trying again cannot help
			// until that prompt is settled, so this says when it can.
			if (isPendingPromptsRefusal(error)) {
				toast.error(PROMPT_PENDING_TITLE, { description: promptPendingMessage('revoke') });
				return;
			}
			toast.error('Revoke Failed', { description: failureDescription(REVOKE_FAILED, error) });
		},
	});
	return startedAlone(mutation, queryClient);
}

/**
 * What the user is told when the removal was refused before anything was sent. A standing
 * plan takes the old notice down (its action would undo the plan) and offers nothing; a
 * limit that could not be read replaces it, offering the removal again.
 */
function showClearRefused(error: ClearApprovalRefusedError, retry: () => void): void {
	if (error.kind === 'plan-active') {
		toast.dismiss(APPROVAL_NOT_CLEARED_TOAST_ID);
		toast.warning(error.title, { description: error.message });
		return;
	}
	if (error.kind === 'account-changed') {
		// Replaces the notice whose action it was, and offers nothing: the removal would go
		// from the account selected now.
		toast.warning(error.title, {
			id: APPROVAL_NOT_CLEARED_TOAST_ID,
			description: error.message,
			duration: Infinity,
			action: undefined,
		});
		return;
	}
	toast.warning(error.title, {
		id: APPROVAL_NOT_CLEARED_TOAST_ID,
		description: error.message,
		duration: Infinity,
		action: { label: REMOVE_APPROVAL_LABEL, onClick: retry },
	});
}

/**
 * Who a removal is for. A notice that offers the removal again passes the account it was
 * raised for, and the removal then refuses, sending nothing, while another account is
 * selected: it would go from that one. Without it (the onboarding notice, which is read for
 * the account selected now), the removal is for the account selected when it is pressed.
 */
export interface ClearRequest {
	owner: string | undefined;
}

/**
 * Sends the approval of zero for the escrow, and nothing else, once the spending limit has
 * been read and none stands (under a standing limit the approval is the plan's, and only
 * Revoke removes it) and an approval is left. Started from the notice a half-finished revoke
 * shows, which passes the account it was for, or from the onboarding notice of an approval
 * left with no plan.
 */
export function useClearApprovalMutation() {
	const activeWallet = useActiveWallet();
	const { mutateAsync: send } = useSendAndConfirmTransaction();
	const queryClient = useQueryClient();

	const mutation = useMutation<void, Error, ClearRequest | void>({
		mutationKey: PLAN_SEND_KEY,
		mutationFn: async request => {
			const selected = activeWallet?.getAccount()?.address;
			const owner = request ? request.owner : selected;
			try {
				if (request && !isSameAddress(selected, request.owner)) {
					throw new ClearApprovalRefusedError('account-changed', undefined, request.owner);
				}
				const { chain, contracts } = connectedContracts(activeWallet);
				let isLimitStanding: boolean;
				try {
					isLimitStanding = await readLimitStands(chain, contracts, owner);
				} catch (error) {
					throw new ClearApprovalRefusedError('plan-unchecked', error, owner);
				}
				if (isLimitStanding) throw new ClearApprovalRefusedError('plan-active', undefined, owner);
				// Removed since (another device, or an earlier step confirmed late): nothing to
				// sign. A read that fails sends it all the same: an approval of zero changes
				// nothing else.
				const allowance = await readEscrowAllowance(chain, contracts, owner).catch(error => {
					console.error(
						'clearApprovalMutation allowance read Error:',
						error instanceof Error ? error.name : typeof error,
					);
					return undefined;
				});
				if (allowance === 0n) return;
				await clearApproval(
					send,
					chain,
					contracts,
					'Please confirm removing the token approval in your wallet.',
					'removal',
					owner,
				);
			} catch (error) {
				const isOwnError =
					error instanceof ApprovalNotClearedError || error instanceof ClearApprovalRefusedError;
				throw isOwnError ? error : new ApprovalNotClearedError(error, undefined, 'removal', owner);
			}
		},
		onSuccess: async () => {
			toast.success(CLEARED_TITLE, { description: CLEARED_DESCRIPTION });
			await refreshPlanQueries(queryClient, activeWallet);
		},
		onError: async error => {
			console.error('clearApprovalMutation Error:', error.name);
			if (error instanceof ClearApprovalRefusedError) {
				const retry = () => startedAlone(mutation, queryClient).mutate({ owner: error.owner });
				showClearRefused(error, retry);
			} else if (error instanceof ApprovalNotClearedError) {
				const retry = () => startedAlone(mutation, queryClient).mutate({ owner: error.owner });
				showApprovalNotCleared(error, retry);
			}
			refreshPlanQueriesSoon(queryClient, activeWallet);
		},
	});
	return startedAlone(mutation, queryClient);
}

/** Whether a plan transaction is under way anywhere in the app. */
export function useIsPlanSendUnderWay(): boolean {
	return useIsMutating({ mutationKey: PLAN_SEND_KEY }) > 0;
}

export default function usePlanMutations(options: PlanMutationOptions) {
	const clearApprovalMutation = useClearApprovalMutation();
	const isUnderWay = useIsPlanSendUnderWay();
	return {
		isUnderWay,
		setPlanMutation: useSetPlanMutation(options),
		revokeMutation: useRevokePlanMutation({
			onDone: options.onDone,
			retryClear: owner => clearApprovalMutation.mutate({ owner }),
		}),
		clearApprovalMutation,
	};
}
