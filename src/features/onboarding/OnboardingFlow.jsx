import WarpBackground from '@/components/magicui/warp-background';

import OnboardingCard from './OnboardingCard';

export default function OnboardingFlow() {
	return (
		<>
			<WarpBackground className="absolute inset-0" />
			<div className="relative z-10 flex h-full w-full items-center justify-center p-4">
				<OnboardingCard />
			</div>
		</>
	);
}
