import { Link } from 'react-router-dom';
import { ShieldCheck, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import useUsagePlan from '@/hooks/useUsagePlan';

export default function ActivatePlanCTA() {
	const { isLoading: isLoadingPlan } = useUsagePlan();

	if (isLoadingPlan) {
		return (
			<div className="flex h-24 items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-background p-8 text-center">
			<div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
				<ShieldCheck className="h-8 w-8 text-primary" />
			</div>
			<h3 className="text-lg font-semibold">Activate Your Agent</h3>
			<p className="mb-4 max-w-xs text-sm text-muted-foreground">
				You need to set a spending limit before you can start a conversation.
			</p>
			<Button asChild>
				<Link to="/">Go to Dashboard to Activate</Link>
			</Button>
		</div>
	);
}
