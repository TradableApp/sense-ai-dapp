import { useEffect, useId, useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useActiveWallet } from 'thirdweb/react';
import { parseUnits } from 'viem';
import { z } from 'zod';

import CommunityLinksNotice from '@/components/CommunityLinksNotice';
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
import { LOCAL_CHAIN_ID, TESTNET_CHAIN_ID } from '@/config/contracts';
import { defaultPlanLimit, FEE_TOKEN, offersFullBalance } from '@/config/feeToken';
import useFaucetRequest from '@/hooks/useFaucetRequest';
import useFeeTokenCheck, {
	useAskFeeTokenAgain,
	useIsAwaitingFirstAnswer,
} from '@/hooks/useFeeTokenCheck';
import useTokenBalance from '@/hooks/useTokenBalance';
import { AWAITING_CHECK_REASON } from '@/lib/feeTokenRefusal';
import { cn } from '@/lib/utils';
import pointsToCommunity from '@/lib/whereToGetToken';

import shouldResetPlanForm from './planFormReset';
import PlanValueEstimate from './PlanValueEstimate';
import usePlanMutations from './usePlanMutations';

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

	// A wallet with none of a token the app offers no way to get is told where to ask.
	const isFaucetOffered = isTestnet || isLocalnet;
	const showsCommunityLinks = pointsToCommunity({
		balance: balanceData ? formattedBalance : undefined,
		profile: FEE_TOKEN,
		isFaucetOffered,
	});

	const currentLimit = watch('limit');
	// Said beside the field while the offer stands, so a whole balance is never approved unseen.
	const isFullBalanceOffer =
		!existingPlan &&
		offersFullBalance(FEE_TOKEN, balanceData ? formattedBalance : undefined) &&
		currentLimit === suggestedLimit;
	const isExceedingBalance =
		!isLoadingBalance && balanceData !== undefined && currentLimit > formattedBalance;

	// Logic to block actions if there are pending prompts
	const hasPendingPrompts = (existingPlan?.pendingEscrowCount ?? 0) > 0;
	// Setting a plan approves the token; not while the chain disagrees about which token.
	const feeTokenCheck = useFeeTokenCheck();
	const isPlanSwitchedOff = feeTokenCheck.blocks('plan');
	// Before the check's first answer the approval waits; the submit stays focusable and says why.
	const isAwaitingFirstAnswer = useIsAwaitingFirstAnswer();
	const askFeeTokenAgain = useAskFeeTokenAgain();
	const holdReasonId = useId();
	const fullBalanceId = useId();

	const { setPlanMutation, revokeMutation } = usePlanMutations({
		onStatus: setStatusText,
		onDone: () => onOpenChange(false),
	});

	const onSubmit = (data: FormValues) => {
		// A press while held asks the check at once, so "try again in a moment" holds true.
		if (isAwaitingFirstAnswer) askFeeTokenAgain();
		if (isPlanSwitchedOff || isAwaitingFirstAnswer) return;
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
						<div className="flex items-baseline justify-between gap-2">
							<Label htmlFor="limit">Spending Limit ({FEE_TOKEN.symbol})</Label>
							{isFullBalanceOffer && (
								<span id={fullBalanceId} className="text-xs text-muted-foreground">
									your full balance
								</span>
							)}
						</div>
						<Input
							id="limit"
							aria-describedby={isFullBalanceOffer ? fullBalanceId : undefined}
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

								{isFaucetOffered && (
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

						{showsCommunityLinks && (
							<div className="rounded-md border p-3 text-xs">
								<CommunityLinksNotice symbol={FEE_TOKEN.symbol} hasNone />
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

					{isAwaitingFirstAnswer && (
						<p id={holdReasonId} className="text-sm text-muted-foreground">
							{AWAITING_CHECK_REASON}
						</p>
					)}
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
								aria-disabled={isAwaitingFirstAnswer}
								aria-describedby={isAwaitingFirstAnswer ? holdReasonId : undefined}
								className={cn(
									'w-full sm:w-auto',
									isAwaitingFirstAnswer && 'cursor-not-allowed opacity-50',
								)}
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
