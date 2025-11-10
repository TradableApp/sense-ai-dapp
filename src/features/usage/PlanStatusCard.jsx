import { useState } from 'react';

import { Clock, Settings } from 'lucide-react';

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
	const { allowance, spentAmount, expiresAt, pendingEscrowCount } = plan;

	const spentPercentage = allowance > 0 ? (spentAmount / allowance) * 100 : 0;
	const formattedAllowance = new Intl.NumberFormat().format(allowance);
	const formattedSpentAmount = new Intl.NumberFormat().format(spentAmount);
	const hasPendingPrompts = pendingEscrowCount > 0;

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
				</CardContent>
				<CardFooter className="pt-4">
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="w-full">
									<Button
										variant="outline"
										className="h-10 w-full text-base font-medium"
										disabled={hasPendingPrompts}
										onClick={() => setIsManageModalOpen(true)}
									>
										<Settings className="mr-2 h-4 w-4" />
										Manage Limit
									</Button>
								</div>
							</TooltipTrigger>
							{hasPendingPrompts && (
								<TooltipContent>
									<p>You cannot change your limit while prompts are pending.</p>
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
