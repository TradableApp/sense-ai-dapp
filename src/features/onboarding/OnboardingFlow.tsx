import { useState } from 'react';

import WarpBackground from '@/components/magicui/warp-background';

import OnboardingCard from './OnboardingCard';
import LeftoverApprovalNotice from '../usage/LeftoverApprovalNotice';
import ManagePlanModal from '../usage/ManagePlanModal';

export default function OnboardingFlow() {
	const [isModalOpen, setIsModalOpen] = useState(false);

	return (
		<>
			<WarpBackground className="absolute inset-0" />
			<div className="relative z-10 flex h-full w-full flex-col items-center justify-center p-4">
				{/* No plan is shown here, so an approval a plan left behind is told of here. */}
				<LeftoverApprovalNotice />
				<OnboardingCard onGetStarted={() => setIsModalOpen(true)} />
			</div>
			<ManagePlanModal open={isModalOpen} onOpenChange={setIsModalOpen} existingPlan={null} />
		</>
	);
}
