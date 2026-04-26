import { useAppSelector } from '@/store/hooks';

import FeedbackModal from '@/features/feedback/FeedbackModal';
import DisclaimerModal from '@/features/legal/DisclaimerModal';
import PrivacyModal from '@/features/legal/PrivacyModal';
import TermsModal from '@/features/legal/TermsModal';
import SupportModal from '@/features/support/SupportModal';

interface Modal {
	type: string;
	props?: any;
}

interface UIState {
	currentModal?: Modal;
	overlayModal?: Modal;
	priorityModal?: Modal;
}

export const modalLookup = {
	Feedback: FeedbackModal,
	Support: SupportModal,
	Privacy: PrivacyModal,
	Terms: TermsModal,
	Disclaimer: DisclaimerModal,
};

const renderModal = (modal: Modal | undefined) => {
	if (!modal?.type) return null;
	const ModalComponent = modalLookup[modal.type as keyof typeof modalLookup];
	if (!ModalComponent) {
		console.warn(`Modal type "${modal.type}" not found in modalLookup.`);
		return null;
	}
	return <ModalComponent key={modal.type} {...modal.props} />;
};

export default function ModalManager() {
	const { currentModal, overlayModal, priorityModal } = useAppSelector((state) => state.ui) as UIState;

	return (
		<>
			{renderModal(currentModal)}
			{renderModal(overlayModal)}
			{renderModal(priorityModal)}
		</>
	);
}
