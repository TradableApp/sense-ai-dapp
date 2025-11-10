import useUsagePlan from '@/hooks/useUsagePlan'; // 1. IMPORT THE HOOK
import { cn } from '@/lib/utils';

import PlanStatusCard from './PlanStatusCard';
import RecentActivityCard from './RecentActivityCard';
import OnboardingFlow from '../onboarding/OnboardingFlow';

export default function UsageDashboard() {
	// Get live data and loading status from ThirdWeb useReadContract
	const { data: plan, isLoading, isError } = useUsagePlan();

	if (isLoading) {
		// This can be replaced with a more elegant skeleton loader later
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-muted-foreground">Loading your usage plan...</p>
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-destructive">Failed to load usage plan. Please try again.</p>
			</div>
		);
	}

	// This style object applies your negative margin fix to break out of the parent's padding.
	const onboardingParentStyles = {
		width: 'calc(100% + 2rem)',
		height: 'calc(100% + 2rem)',
		margin: '-1rem',
		overflow: 'hidden',
	};
	const onboardingChildStyles = {
		width: 'calc(100% + 4rem)',
		height: 'calc(100% + 4rem)',
		margin: '-2rem',
	};

	return (
		<div
			style={!plan ? onboardingParentStyles : undefined}
			className={cn('h-full', plan && 'flex items-center justify-center')}
		>
			<div
				style={!plan ? onboardingChildStyles : undefined}
				className={cn('h-full', plan && 'p-4 text-center', !plan && 'relative')}
			>
				{plan ? (
					<div className="w-full max-w-4xl text-left">
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<PlanStatusCard plan={plan} />
							<RecentActivityCard />
						</div>
					</div>
				) : (
					<OnboardingFlow />
				)}
			</div>
		</div>
	);
}
