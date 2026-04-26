import { useState } from 'react';

import WarpBackground from '@/components/magicui/warp-background';

import OnboardingCard from './OnboardingCard';
import ManagePlanModal from '../usage/ManagePlanModal';

export default function OnboardingFlow() {
	const [isModalOpen, setIsModalOpen] = useState(false);

	return (
		<>
			<WarpBackground className="absolute inset-0" />
			<div className="relative z-10 flex h-full w-full items-center justify-center p-4">
				<OnboardingCard onGetStarted={() => setIsModalOpen(true)} />
			</div>
			<ManagePlanModal open={isModalOpen} onOpenChange={setIsModalOpen} />
		</>
	);
}
