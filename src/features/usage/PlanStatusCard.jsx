import { useState } from 'react';

import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, Clock, Loader2, Settings } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import Progress from '@/components/ui/progress';
import Separator from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import useChatMutations from '@/hooks/useChatMutations';
import useStuckRequests from '@/hooks/useStuckRequests';

import ManagePlanModal from './ManagePlanModal';

/**
 * A helper function to format the expiration date into a "days remaining" string.
 */
function formatTimeRemaining(expiryDate) {
	if (!expiryDate) return 'No expiration set';
	const now = new Date();
	const differenceInMs = expiryDate.getTime() - now.getTime();
	if (differenceInMs <= 0) return 'Limit has expired';
	const daysRemaining = Math.ceil(differenceInMs / (1000 * 60 * 60 * 24));
	if (daysRemaining === 1) return 'Expires in 1 day';
	return `Expires in ${daysRemaining} days`;
}

export default function PlanStatusCard({ plan }) {
	const [isManageModalOpen, setIsManageModalOpen] = useState(false);
	const [isRefundingAll, setIsRefundingAll] = useState(false);

	const { allowance, spentAmount, expiresAt, pendingEscrowCount } = plan;

	// Hooks for Refund Functionality
	const { data: stuckRequests /* , isLoading: isLoadingStuck */ } = useStuckRequests();
	const { processRefundMutation } = useChatMutations();

	const spentPercentage = allowance > 0 ? (spentAmount / allowance) * 100 : 0;
	const formattedAllowance = new Intl.NumberFormat().format(allowance);
	const formattedSpentAmount = new Intl.NumberFormat().format(spentAmount);

	// We still want to visually warn them, but NOT disable the button
	const hasPendingPrompts = pendingEscrowCount > 0;
	const refundableRequests = stuckRequests?.filter(r => r.isRefundable) || [];

	const handleRefundAll = async () => {
		if (refundableRequests.length === 0) {
			return;
		}

		setIsRefundingAll(true);
		toast.info('Processing Refunds', {
			description: `You will need to confirm ${refundableRequests.length} transaction${
				refundableRequests.length === 1 ? '' : 's'
			} in your wallet.`,
		});

		// Using a linter-friendly for loop for sequential async operations.
		for (let i = 0; i < refundableRequests.length; i += 1) {
			const req = refundableRequests[i];
			try {
				// The `await` pauses the loop. The mutation's own onSuccess/onError will handle the toasts.
				// eslint-disable-next-line no-await-in-loop
				await processRefundMutation.mutateAsync({ answerMessageId: req.id });
			} catch (error) {
				// The mutation's onError will have already shown a toast.
				// We just need to log it and stop the process.
				console.error('Refund failed for request:', req.id, error);
				break;
			}
		}

		setIsRefundingAll(false);

		setIsRefundingAll(false);
	};

	return (
		<>
			<Card className="mb-8 w-full max-w-md rounded-2xl border-border/30 bg-background shadow-lg">
				<CardHeader>
					<CardTitle>Spending Limit Status</CardTitle>
					<CardDescription>This is your approved spending limit for the AI agent.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Progress value={spentPercentage} />
						<div className="flex justify-between text-sm font-medium text-muted-foreground">
							<span>{formattedSpentAmount} ABLE spent</span>
							<span>Total: {formattedAllowance} ABLE</span>
						</div>
					</div>
					<Separator />
					<div className="flex flex-col items-center justify-center gap-2 text-center text-sm sm:flex-row sm:justify-around">
						<div className="text-foreground/80">{formatTimeRemaining(expiresAt)}</div>
						<div className="flex items-center justify-center gap-1.5 font-medium text-amber-600 dark:text-amber-500">
							<Clock className="h-4 w-4" />
							<span>
								{pendingEscrowCount} Pending Prompt{pendingEscrowCount !== 1 && 's'}
							</span>
						</div>
					</div>

					{hasPendingPrompts && stuckRequests && stuckRequests.length > 0 && (
						<div className="rounded-md border border-orange-200/50 bg-orange-50/50 dark:bg-orange-950/10 dark:border-orange-900/30 p-3 mb-4">
							<div className="flex items-center justify-between mb-2">
								<div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
									<AlertCircle className="h-4 w-4" />
									<span className="text-sm font-semibold">Pending Prompts Detected</span>
								</div>
								{refundableRequests.length > 1 && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-6 px-2 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30"
										onClick={handleRefundAll}
										disabled={isRefundingAll}
									>
										{isRefundingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Refund All'}
									</Button>
								)}
							</div>
							<p className="text-xs text-muted-foreground mb-3">
								You have prompts that haven't completed. You cannot change or revoke your plan until
								they finalize or are refunded.
							</p>

							<div className="space-y-2 max-h-40 overflow-y-auto">
								{stuckRequests.map(req => (
									<div
										key={req.id}
										className="flex items-center justify-between bg-background p-2 rounded border text-xs"
									>
										<span>
											Request #{req.id}{' '}
											<span className="text-muted-foreground">
												({formatDistanceToNow(req.createdAt)} ago)
											</span>
										</span>

										{req.isRefundable ? (
											<Button
												size="sm"
												variant="outline"
												type="button"
												className="h-6 text-xs"
												onClick={e => {
													e.preventDefault();
													processRefundMutation.mutate({ answerMessageId: req.id });
												}}
												disabled={processRefundMutation.isPending || isRefundingAll}
											>
												{processRefundMutation.isPending && !isRefundingAll ? (
													<Loader2 className="w-3 h-3 animate-spin" />
												) : (
													'Refund'
												)}
											</Button>
										) : (
											<span className="text-muted-foreground italic px-2">Wait 1h to refund</span>
										)}
									</div>
								))}
							</div>
						</div>
					)}
				</CardContent>
				<CardFooter className="pt-4">
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="w-full">
									<Button
										variant="outline"
										className="h-10 w-full text-base font-medium"
										onClick={() => setIsManageModalOpen(true)}
										disabled={hasPendingPrompts}
									>
										<Settings className="mr-2 h-4 w-4" />
										Manage Limit
									</Button>
								</div>
							</TooltipTrigger>

							{hasPendingPrompts && (
								<TooltipContent>
									<p>Clear all pending prompts to manage your limit.</p>
								</TooltipContent>
							)}
						</Tooltip>
					</TooltipProvider>
				</CardFooter>
			</Card>

			<ManagePlanModal
				open={isManageModalOpen}
				onOpenChange={setIsManageModalOpen}
				existingPlan={plan}
			/>
		</>
	);
}
