import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { type Chain, getContract, prepareContractCall } from 'thirdweb';
import { useActiveWallet, useSendAndConfirmTransaction } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { FEE_TOKEN } from '@/config/feeToken';
import { client } from '@/config/thirdweb';
import { useIsAwaitingFirstAnswer } from '@/hooks/useFeeTokenCheck';
import usePaymentGate from '@/hooks/usePaymentGate';
import { getTokenBalanceQueryKey } from '@/hooks/useTokenBalance';
import { AWAITING_CHECK_REASON } from '@/lib/feeTokenRefusal';
import { PaymentSwitchedOffError } from '@/lib/paymentGate';
import { wait } from '@/lib/utils';

import LimitNotSetError from './LimitNotSetError';

/**
 * Setting and revoking a spending plan: the only transactions the plan dialog sends.
 *
 * Setting a plan approves the fee token, so it asks the payment gate first and refuses before
 * anything is built while plans are switched off, or while the fee token check has not yet
 * answered once. Revoking never asks: taking back a permission must stay possible always.
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

/** Approves the limit for the escrow, then sets it there: two signatures in the wallet. */
async function approveAndSetLimit(
	send: SendAndConfirm,
	chain: Chain,
	contracts: ContractConfig,
	{ limitInWei, expiresAtTimestamp }: PlanRequest,
	onStatus: (_text: string) => void,
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

function useSetPlanMutation({ onStatus, onDone }: PlanMutationOptions) {
	const activeWallet = useActiveWallet();
	const { mutateAsync: send } = useSendAndConfirmTransaction();
	const queryClient = useQueryClient();
	const paymentGate = usePaymentGate();
	const isAwaitingFirstAnswer = useIsAwaitingFirstAnswer();

	return useMutation<void, Error, PlanRequest>({
		mutationFn: async plan => {
			// The form is disabled too; this is the refusal that holds whoever calls it.
			if (paymentGate.blocks('plan'))
				throw new PaymentSwitchedOffError(paymentGate.state, 'plan', FEE_TOKEN.symbol);
			// Nothing has said yet that this is the right token to approve.
			if (isAwaitingFirstAnswer) throw new PlanHeldError();
			const { chain, contracts } = connectedContracts(activeWallet);
			await approveAndSetLimit(send, chain, contracts, plan, onStatus);
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
			// Refused or held before anything was sent: not a failed transaction.
			const wasNotSent = error instanceof PaymentSwitchedOffError || error instanceof PlanHeldError;
			toast.error(wasNotSent ? 'Not sent' : 'Transaction Failed', {
				description: error.message || 'An unexpected error occurred. Please try again.',
			});
		},
	});
}

function useRevokePlanMutation({ onDone }: Pick<PlanMutationOptions, 'onDone'>) {
	const activeWallet = useActiveWallet();
	const { mutateAsync: send } = useSendAndConfirmTransaction();
	const queryClient = useQueryClient();

	return useMutation<void, Error, void>({
		mutationFn: async () => {
			const { chain, contracts } = connectedContracts(activeWallet);
			const revokeToastId = toast.info(
				'Please confirm the transaction in your wallet to revoke access.',
			);
			try {
				await send(contractCall(chain, contracts.escrow, 'cancelSpendingLimit'));
			} finally {
				toast.dismiss(revokeToastId);
			}
		},
		onSuccess: async () => {
			toast.success('Access Revoked', {
				description: 'The AI agent can no longer spend your tokens.',
			});
			await refreshPlanQueries(queryClient, activeWallet);
			onDone();
		},
		onError: error => {
			console.error('revokeMutation Error:', error);
			toast.error('Revoke Failed', {
				description: error.message || 'Could not revoke access. Please try again.',
			});
		},
	});
}

export default function usePlanMutations(options: PlanMutationOptions) {
	return {
		setPlanMutation: useSetPlanMutation(options),
		revokeMutation: useRevokePlanMutation(options),
	};
}
