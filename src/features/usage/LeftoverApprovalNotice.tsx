import { useId } from 'react';

import { Loader2, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FEE_TOKEN } from '@/config/feeToken';

import { REMOVE_APPROVAL_LABEL } from './ApprovalNotClearedError';
import useLeftoverApproval from './useLeftoverApproval';
import { useClearApprovalMutation, useIsPlanSendUnderWay } from './usePlanMutations';

/**
 * Tells of a token approval left for the escrow while no plan is active, and removes it: one
 * approval of zero through the plan mutations, which read the limit again first and send
 * nothing if a plan stands by then. Removing a permission never asks the payment gate.
 * Shown where no plan is (the onboarding screen); renders nothing otherwise, or when a read
 * failed.
 */
export default function LeftoverApprovalNotice() {
	const { data: isLeftover } = useLeftoverApproval();
	const clearApprovalMutation = useClearApprovalMutation();
	const isUnderWay = useIsPlanSendUnderWay();
	const headingId = useId();
	const textId = useId();

	if (!isLeftover) return null;

	return (
		<section
			aria-labelledby={headingId}
			className="flex w-full max-w-md items-start gap-3 rounded-md border border-border/50 bg-background/95 p-4 text-sm text-muted-foreground shadow-lg"
		>
			<ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
			<div className="flex-1 space-y-3">
				<h2 id={headingId} className="font-semibold text-foreground">
					Token approval left
				</h2>
				<p id={textId}>
					No plan is active, but your wallet still approves the AI agent to use your{' '}
					{FEE_TOKEN.symbol}, left from an earlier plan. You can remove that approval; setting a new
					limit replaces it.
				</p>
				<Button
					type="button"
					size="sm"
					variant="outline"
					aria-describedby={textId}
					disabled={isUnderWay}
					onClick={() => clearApprovalMutation.mutate()}
				>
					{clearApprovalMutation.isPending && (
						<Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden="true" />
					)}
					{REMOVE_APPROVAL_LABEL}
				</Button>
			</div>
		</section>
	);
}
