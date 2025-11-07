import { cn } from '@/lib/utils';

import PlanStatusCard from './PlanStatusCard';
import RecentActivityCard from './RecentActivityCard'; // Import the new component
import OnboardingFlow from '../onboarding/OnboardingFlow';

// Mock data
// const mockPlan = null; // Set to null to test the onboarding flow
const mockPlan = {
	allowance: 1000,
	spentAmount: 250,
	// Set expiration to 15 days from now for testing
	expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
	// NEW: Add pendingEscrowCount to test the contract's locking mechanism.
	// Set to > 0 to test the disabled state, or 0 to test the enabled state.
	// pendingEscrowCount: 2,
	pendingEscrowCount: 0,
}; // Use this to test the status card

export default function UsageDashboard() {
	// This will be replaced with a real hook to fetch smart contract data.
	const { data: plan, isLoading } = { data: mockPlan, isLoading: false };

	if (isLoading) {
		// We can create a nice skeleton loader here later.
		return <div>Loading your usage plan...</div>;
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
				className={cn(
					'h-full',
					// We no longer need flexbox here, as the parent is handling it.
					plan && 'p-4 text-center',
					// If no plan (onboarding), make it a relative container so the absolute child can fill it.
					!plan && 'relative',
				)}
			>
				{plan ? (
					// If a plan exists, show the status dashboard.
					<div className="w-full max-w-4xl text-left">
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<PlanStatusCard plan={plan} />
							<RecentActivityCard /> {/* Add the new component here */}
						</div>
					</div>
				) : (
					// If no plan exists, show the guided onboarding flow.
					<OnboardingFlow />
				)}
			</div>
		</div>
	);
}
