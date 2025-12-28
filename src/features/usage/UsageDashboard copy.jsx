import useUsagePlan from '@/hooks/useUsagePlan';
import { cn } from '@/lib/utils';

import PlanStatusCard from './PlanStatusCard';
import RecentActivityCard from './RecentActivityCard';
import OnboardingFlow from '../onboarding/OnboardingFlow';

export default function UsageDashboard() {
	const { data: plan, isLoading, isError } = useUsagePlan();

	if (isLoading) {
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
			className={cn(
				'h-full',
				// Add a subtle background for the dashboard view
				plan && 'bg-muted/10 p-4 md:p-8',
			)}
		>
			<div
				style={!plan ? onboardingChildStyles : undefined}
				className={cn('h-full', !plan && 'relative')}
			>
				{plan ? (
					// DASHBOARD LAYOUT
					// Used max-w-4xl to keep it compact and centered like your screenshot
					<div className="mx-auto max-w-4xl">
						{/* Header Section */}
						<div className="mb-8">
							<h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
							<p className="text-muted-foreground">Overview of your AI agent usage and billing.</p>
						</div>

						{/* Stack Layout (PlanStatusCard on Top, Activity Below) */}
						<div className="flex flex-col gap-6">
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
