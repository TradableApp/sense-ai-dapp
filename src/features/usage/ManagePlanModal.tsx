import { useEffect, useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { getContract, prepareContractCall } from 'thirdweb';
import { useActiveWallet, useSendAndConfirmTransaction } from 'thirdweb/react';
import { parseUnits } from 'viem';
import { z } from 'zod';

import FeeTokenMismatchBanner from '@/components/FeeTokenMismatchBanner';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import Input from '@/components/ui/input';
import Label from '@/components/ui/label';
import { CONTRACTS, LOCAL_CHAIN_ID, TESTNET_CHAIN_ID } from '@/config/contracts';
import { defaultPlanLimit, FEE_TOKEN } from '@/config/feeToken';
import { client } from '@/config/thirdweb';
import useFaucetRequest from '@/hooks/useFaucetRequest';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import useTokenBalance, { getTokenBalanceQueryKey } from '@/hooks/useTokenBalance';
import { FeeTokenBlockedError } from '@/lib/feeTokenCheck';
import { wait } from '@/lib/utils';

import shouldResetPlanForm from './planFormReset';
import PlanValueEstimate from './PlanValueEstimate';

const managePlanSchema = z.object({
	limit: z
		.number({ invalid_type_error: 'Limit must be a number.' })
		.positive({ message: 'Limit must be greater than zero.' }),
	days: z
		.number({ invalid_type_error: 'Days must be a number.' })
		.int()
		.positive({ message: 'Duration must be at least one day.' }),
});

type FormValues = z.infer<typeof managePlanSchema>;

const DEFAULT_DAYS = 365;

interface ExistingPlan {
	allowance: number;
	pendingEscrowCount: number;
}

interface ManagePlanModalProps {
	open: boolean;
	onOpenChange: (_open: boolean) => void;
	existingPlan: ExistingPlan | null;
}

export default function ManagePlanModal({
	open,
	onOpenChange,
	existingPlan,
}: ManagePlanModalProps) {
	const activeWallet = useActiveWallet();
	const chainId = activeWallet?.getChain()?.id;
	const isLocalnet = chainId === LOCAL_CHAIN_ID;
	const isTestnet = chainId === TESTNET_CHAIN_ID;

	// The faucet amount is live (adjustable via Firestore general/sense_ai).
	const { requestTokens, faucetAmount } = useFaucetRequest();

	// Use the confirmation-aware hook
	const { mutateAsync: sendAndConfirm } = useSendAndConfirmTransaction();
	const queryClient = useQueryClient();
	const [statusText, setStatusText] = useState('');
	const [isRequestingTokens, setIsRequestingTokens] = useState(false);

	const { data: balanceData, isLoading: isLoadingBalance } = useTokenBalance(
		chainId,
		activeWallet?.getAccount()?.address,
	);
	// The raw BigInt is now in `balanceData.value`
	const formattedBalance = balanceData ? Number(balanceData.displayValue) : 0;

	// What a new plan is first offered: a fixed amount, or what the wallet holds, as the fee
	// token's profile says. An existing plan keeps its own limit.
	const suggestedLimit = defaultPlanLimit(FEE_TOKEN, balanceData ? formattedBalance : undefined);
	const initialLimit = existingPlan ? existingPlan.allowance : suggestedLimit;

	const {
		register,
		handleSubmit,
		watch,
		reset,
		formState: { errors, isValid, isDirty },
	} = useForm<FormValues>({
		resolver: zodResolver(managePlanSchema),
		mode: 'onChange',
		defaultValues: {
			limit: initialLimit,
			days: DEFAULT_DAYS,
		},
	});

	// See shouldResetPlanForm: always on opening, and afterwards only while nothing is typed.
	const wasOpen = useRef(false);
	useEffect(() => {
		if (shouldResetPlanForm({ open, wasOpen: wasOpen.current, isDirty })) {
			reset({
				limit: initialLimit,
				days: DEFAULT_DAYS,
			});
		}
		wasOpen.current = open;
		// `isDirty` is read, not watched: becoming dirty must not trigger a reset.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, existingPlan, initialLimit, reset]);

	const currentLimit = watch('limit');
	const isExceedingBalance =
		!isLoadingBalance && balanceData !== undefined && currentLimit > formattedBalance;

	// Logic to block actions if there are pending prompts
	const hasPendingPrompts = (existingPlan?.pendingEscrowCount ?? 0) > 0;
	// Setting a plan approves the token; not while the chain disagrees about which token.
	const feeTokenCheck = useFeeTokenCheck();
	const isPlanSwitchedOff = feeTokenCheck.blocks('plan');

	const setPlanMutation = useMutation<
		void,
		Error,
		{ limitInWei: bigint; expiresAtTimestamp: bigint }
	>({
		mutationFn: async ({
			limitInWei,
			expiresAtTimestamp,
		}: {
			limitInWei: bigint;
			expiresAtTimestamp: bigint;
		}): Promise<void> => {
			// The form is disabled too; this is the refusal that holds whoever calls it.
			if (isPlanSwitchedOff) throw new FeeTokenBlockedError(feeTokenCheck.verdict);
			if (!activeWallet || !chainId) {
				throw new Error('Wallet not connected');
			}

			const contractConfig = CONTRACTS[chainId];

			if (!contractConfig) {
				throw new Error('Contracts not configured for this chain');
			}

			// Get the full chain object from the wallet
			const connectedChain = activeWallet.getChain();

			if (!connectedChain) {
				throw new Error('Could not determine connected chain.');
			}

			setStatusText('1/2: Approving...');
			const approvalToastId = toast.info(
				'Step 1/2: Please approve the token spending limit in your wallet.',
			);

			try {
				const tokenContract = getContract({
					client,
					chain: connectedChain,
					address: contractConfig.token.address,
					abi: contractConfig.token.abi as Parameters<typeof getContract>[0]['abi'],
				});

				const approveTx = prepareContractCall({
					contract: tokenContract,
					method: 'approve',
					params: [contractConfig.escrow.address, limitInWei],
				} as unknown as Parameters<typeof prepareContractCall>[0]);

				await sendAndConfirm(approveTx);
				toast.dismiss(approvalToastId);

				// We wait 2 seconds to ensure the RPC has indexed the updated nonce
				// from the first transaction before sending the second one.
				setStatusText('Waiting for network...');
				await wait(2000);

				setStatusText('2/2: Setting Limit...');
				const limitToastId = toast.info(
					'Step 2/2: Please confirm setting the new spending limit in your wallet.',
				);

				const escrowContract = getContract({
					client,
					chain: connectedChain,
					address: contractConfig.escrow.address,
					abi: contractConfig.escrow.abi as Parameters<typeof getContract>[0]['abi'],
				});

				const setSubTx = prepareContractCall({
					contract: escrowContract,
					method: 'setSpendingLimit',
					params: [limitInWei, expiresAtTimestamp],
				} as unknown as Parameters<typeof prepareContractCall>[0]);

				await sendAndConfirm(setSubTx);
				toast.dismiss(limitToastId);
			} catch (error) {
				toast.dismiss(); // Clear loading toasts on error
				throw error;
			}
		},
		onSuccess: async () => {
			toast.success('Spending Limit Set!', {
				description: 'Your new plan is now active.',
			});
			// Wait 2 seconds to allow the RPC node to index the new state.
			// Without this, invalidateQueries fetches stale data instantly.
			await wait(2000);

			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['usagePlan'], refetchType: 'all' }),
				queryClient.invalidateQueries({
					// Real thirdweb wallet-balance key (not the dead ['tokenBalance'] literal — CU-86d3dvy2y).
					queryKey: getTokenBalanceQueryKey(
						chainId ?? 0,
						activeWallet?.getAccount()?.address,
						CONTRACTS[chainId ?? 0]?.token?.address,
					),
					refetchType: 'all',
				}),
			]);
			onOpenChange(false);
		},
		onError: error => {
			console.error('setPlanMutation Error:', error);

			toast.error('Transaction Failed', {
				description: error.message || 'An unexpected error occurred. Please try again.',
			});
		},
	});

	const revokeMutation = useMutation<void, Error, void>({
		mutationFn: async () => {
			if (!activeWallet || !chainId) {
				throw new Error('Wallet not connected');
			}

			const contractConfig = CONTRACTS[chainId];

			if (!contractConfig) {
				throw new Error('Contracts not configured for this chain');
			}

			// Get the full chain object from the wallet
			const connectedChain = activeWallet.getChain();

			if (!connectedChain) {
				throw new Error('Could not determine connected chain.');
			}

			const revokeToastId = toast.info(
				'Please confirm the transaction in your wallet to revoke access.',
			);

			const escrowContract = getContract({
				client,
				chain: connectedChain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi as Parameters<typeof getContract>[0]['abi'],
			});
			const revokeTx = prepareContractCall({
				contract: escrowContract,
				method: 'cancelSpendingLimit',
			} as unknown as Parameters<typeof prepareContractCall>[0]);
			await sendAndConfirm(revokeTx);
			toast.dismiss(revokeToastId);
		},
		onSuccess: async () => {
			toast.success('Access Revoked', {
				description: 'The AI agent can no longer spend your tokens.',
			});

			// Wait 2 seconds to allow the RPC node to index the new state.
			// Without this, invalidateQueries fetches stale data instantly.
			await wait(2000);

			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['usagePlan'], refetchType: 'all' }),
				queryClient.invalidateQueries({
					// Real thirdweb wallet-balance key (not the dead ['tokenBalance'] literal — CU-86d3dvy2y).
					queryKey: getTokenBalanceQueryKey(
						chainId ?? 0,
						activeWallet?.getAccount()?.address,
						CONTRACTS[chainId ?? 0]?.token?.address,
					),
					refetchType: 'all',
				}),
			]);
			onOpenChange(false);
		},
		onError: error => {
			console.error('revokeMutation Error:', error);

			toast.error('Revoke Failed', {
				description: error.message || 'Could not revoke access. Please try again.',
			});
		},
	});

	const onSubmit = (data: FormValues) => {
		if (isPlanSwitchedOff) return;
		const limitInWei = parseUnits(data.limit.toString(), FEE_TOKEN.decimals);
		const nowInSeconds = Math.floor(Date.now() / 1000);
		const expiresAtTimestamp = BigInt(nowInSeconds + (data.days as number) * 24 * 60 * 60);
		setPlanMutation.mutate({ limitInWei, expiresAtTimestamp });
	};

	const handleRevoke = () => {
		revokeMutation.mutate();
	};

	const handleFaucetRequest = async () => {
		setIsRequestingTokens(true);
		try {
			await requestTokens();
		} finally {
			setIsRequestingTokens(false);
		}
	};

	const isProcessing = setPlanMutation.isPending || revokeMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={openState => !isProcessing && onOpenChange(openState)}>
			<DialogContent className="sm:max-w-[480px]">
				<DialogHeader>
					<DialogTitle>{existingPlan ? 'Manage' : 'Set'} Your Spending Limit</DialogTitle>
					<DialogDescription>
						Approve the total amount of {FEE_TOKEN.symbol} the AI agent can use. This requires{' '}
						{existingPlan ? 'up to ' : ''}two transactions.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
					{/* The page's own banner is behind this dialog. */}
					<FeeTokenMismatchBanner />
					<div className="space-y-2">
						<Label htmlFor="limit">Spending Limit ({FEE_TOKEN.symbol})</Label>
						<Input
							id="limit"
							type="number"
							placeholder={String(suggestedLimit)}
							{...register('limit', { valueAsNumber: true })}
							disabled={
								hasPendingPrompts ||
								isProcessing ||
								setPlanMutation.isPending ||
								revokeMutation.isPending
							}
						/>
						{errors.limit && <p className="text-sm text-destructive">{errors.limit.message}</p>}

						{isExceedingBalance && (
							<div className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400 border border-amber-500/20">
								<div className="flex items-center gap-2 mb-2">
									<AlertCircle className="w-4 h-4" />
									<span className="font-semibold">Insufficient Balance</span>
								</div>
								<p className="mb-3">
									You have {formattedBalance.toFixed(2)} {FEE_TOKEN.symbol}, but you are trying to
									set a limit of {currentLimit}.
								</p>

								{(isTestnet || isLocalnet) && (
									<Button
										type="button"
										size="sm"
										variant="secondary"
										className="w-full h-8 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 border-amber-500/20"
										onClick={handleFaucetRequest}
										disabled={isRequestingTokens}
									>
										{isRequestingTokens ? (
											<>
												<Loader2 className="mr-2 h-3 w-3 animate-spin" /> Sending Tokens...
											</>
										) : (
											`Get ${faucetAmount} ${isLocalnet ? 'Localnet' : 'Testnet'} ${
												FEE_TOKEN.symbol
											}`
										)}
									</Button>
								)}
							</div>
						)}

						<PlanValueEstimate limit={currentLimit} chainId={chainId} />
					</div>
					<div className="space-y-2">
						<Label htmlFor="days">Expires In (Days)</Label>
						<Input
							id="days"
							type="number"
							placeholder={String(DEFAULT_DAYS)}
							{...register('days', { valueAsNumber: true })}
							disabled={
								hasPendingPrompts ||
								isProcessing ||
								setPlanMutation.isPending ||
								revokeMutation.isPending
							}
						/>
						{errors.days && <p className="text-sm text-destructive">{errors.days.message}</p>}
					</div>

					<DialogFooter className="flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
						<div className="w-full sm:w-auto">
							{existingPlan && (
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button
											type="button"
											variant="destructive"
											disabled={
												hasPendingPrompts ||
												isProcessing ||
												setPlanMutation.isPending ||
												revokeMutation.isPending
											}
											className="w-full sm:w-auto"
										>
											{revokeMutation.isPending ? (
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											) : (
												<Trash2 className="mr-2 h-4 w-4" />
											)}
											{revokeMutation.isPending ? 'Revoking...' : 'Revoke'}
										</Button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>Are you sure?</AlertDialogTitle>
											<AlertDialogDescription>
												This will revoke the AI agent's permission to spend your {FEE_TOKEN.symbol}.
												You will need to set a new limit to continue using the service. This action
												requires a transaction.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel disabled={revokeMutation.isPending}>
												Cancel
											</AlertDialogCancel>
											<AlertDialogAction onClick={handleRevoke} disabled={revokeMutation.isPending}>
												{revokeMutation.isPending && (
													<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												)}
												{revokeMutation.isPending ? 'Revoking...' : 'Confirm Revoke'}
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							)}
						</div>

						<div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:justify-end">
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={isProcessing || setPlanMutation.isPending || revokeMutation.isPending}
								className="w-full sm:w-auto"
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={
									isPlanSwitchedOff ||
									hasPendingPrompts ||
									!isValid ||
									isProcessing ||
									setPlanMutation.isPending ||
									revokeMutation.isPending
								}
								className="w-full sm:w-auto"
							>
								{setPlanMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
								{setPlanMutation.isPending ? statusText : existingPlan ? 'Save Changes' : 'Confirm'}
							</Button>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
