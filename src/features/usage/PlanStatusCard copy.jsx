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

	const { data: stuckRequests } = useStuckRequests();
	const { processRefundMutation } = useChatMutations();

	const spentPercentage = allowance > 0 ? (spentAmount / allowance) * 100 : 0;
	const formattedAllowance = new Intl.NumberFormat().format(allowance);
	const formattedSpentAmount = new Intl.NumberFormat().format(spentAmount);

	const hasPendingPrompts = pendingEscrowCount > 0;
	const refundableRequests = stuckRequests?.filter(r => r.isRefundable) || [];

	const handleRefundAll = async () => {
		if (refundableRequests.length === 0) return;

		setIsRefundingAll(true);
		toast.info('Processing Refunds', {
			description: `Please confirm ${refundableRequests.length} transaction(s) in your wallet.`,
		});

		for (let i = 0; i < refundableRequests.length; i += 1) {
			const req = refundableRequests[i];
			try {
				// eslint-disable-next-line no-await-in-loop
				await processRefundMutation.mutateAsync({ answerMessageId: req.id });
			} catch (error) {
				console.error('Refund failed for request:', req.id, error);
				break;
			}
		}

		setIsRefundingAll(false);
	};

	return (
		<>
			<Card className="h-fit w-full border-border/30 bg-background shadow-lg">
				<CardHeader>
					<CardTitle>Spending Limit Status</CardTitle>
					<CardDescription>Your approved spending limit for the AI agent.</CardDescription>
				</CardHeader>
				<CardContent>
					{/* RESPONSIVE LAYOUT: Stacks on mobile, Side-by-Side on Desktop */}
					<div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
						{/* Left Side: Progress, Numbers & Expiry */}
						<div className="flex-1 space-y-4">
							<div className="space-y-1.5">
								<div className="flex justify-between text-sm font-medium">
									<span className="text-muted-foreground">Used</span>
									<span>{spentPercentage.toFixed(1)}%</span>
								</div>
								<Progress value={spentPercentage} className="h-2.5" />
							</div>
							<div className="flex justify-between text-sm">
								<div className="flex flex-col">
									<span className="text-muted-foreground text-xs uppercase tracking-wider">
										Spent
									</span>
									<span className="font-semibold">{formattedSpentAmount} ABLE</span>
								</div>
								<div className="flex flex-col text-right">
									<span className="text-muted-foreground text-xs uppercase tracking-wider">
										Limit
									</span>
									<span className="font-semibold">{formattedAllowance} ABLE</span>
								</div>
							</div>

							{/* Expiry moved here (Left side) */}
							<p className="text-xs text-muted-foreground pt-1">{formatTimeRemaining(expiresAt)}</p>
						</div>

						{/* Divider for Mobile Only */}
						<Separator className="md:hidden" />

						{/* Right Side: Pending & Actions */}
						<div className="flex flex-col gap-4 md:w-auto md:shrink-0 md:items-end">
							{/* Pending Prompts */}
							<div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-500">
								<Clock className="h-4 w-4" />
								<span>{pendingEscrowCount} Pending Prompts</span>
							</div>

							{/* Action Button */}
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="w-full md:w-auto">
											<Button
												variant="outline"
												className="w-full md:w-40"
												onClick={() => setIsManageModalOpen(true)}
												disabled={hasPendingPrompts}
											>
												<Settings className="mr-2 h-4 w-4" />
												Manage Limit
											</Button>
										</div>
									</TooltipTrigger>
									{hasPendingPrompts && (
										<TooltipContent side="bottom">
											<p>Clear pending prompts to manage limit.</p>
										</TooltipContent>
									)}
								</Tooltip>
							</TooltipProvider>
						</div>
					</div>

					{/* Refund Section - Full Width Alert */}
					{hasPendingPrompts && stuckRequests && stuckRequests.length > 0 && (
						<div className="mt-6 space-y-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
							<div className="flex items-start gap-3">
								<AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
								<div className="flex-1 space-y-1">
									<h4 className="font-semibold text-amber-700 dark:text-amber-500">
										Action Required
									</h4>
									<p className="text-amber-700/80 dark:text-amber-400/90 leading-relaxed">
										You have pending prompts. Transactions older than 1 hour can be refunded to
										unlock your plan.
									</p>
								</div>
							</div>

							<div className="space-y-2 pl-8">
								<div className="flex items-center justify-between">
									<span className="text-xs font-medium text-amber-700/60 dark:text-amber-400/60 uppercase tracking-wider">
										Pending Requests
									</span>
									{refundableRequests.length > 1 && (
										<Button
											size="xs"
											variant="ghost"
											className="h-6 text-xs hover:bg-amber-500/20 hover:text-amber-800 text-amber-700"
											onClick={handleRefundAll}
											disabled={isRefundingAll || processRefundMutation.isPending}
										>
											{isRefundingAll ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
											Refund All
										</Button>
									)}
								</div>

								<div className="max-h-32 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
									{stuckRequests.map(req => (
										<div
											key={req.id}
											className="flex items-center justify-between rounded-md bg-background/60 p-2 text-xs border border-border/50"
										>
											<div className="flex flex-col">
												<span className="font-medium">Request #{req.id}</span>
												<span className="text-muted-foreground text-[10px]">
													{formatDistanceToNow(req.createdAt)} ago
												</span>
											</div>

											{req.isRefundable ? (
												<Button
													size="sm"
													variant="secondary"
													className="h-7 text-xs px-3"
													onClick={() => processRefundMutation.mutate({ answerMessageId: req.id })}
													disabled={processRefundMutation.isPending || isRefundingAll}
												>
													{processRefundMutation.isPending && !isRefundingAll ? (
														<Loader2 className="w-3 h-3 animate-spin" />
													) : (
														'Refund'
													)}
												</Button>
											) : (
												<span className="text-muted-foreground italic px-2 py-1 bg-muted rounded">
													Wait 1h
												</span>
											)}
										</div>
									))}
								</div>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			<ManagePlanModal
				open={isManageModalOpen}
				onOpenChange={setIsManageModalOpen}
				existingPlan={plan}
			/>
		</>
	);
}
