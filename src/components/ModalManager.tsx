import { useSelector } from 'react-redux';

import FeedbackModal from '@/features/feedback/FeedbackModal';
import DisclaimerModal from '@/features/legal/DisclaimerModal';
import PrivacyModal from '@/features/legal/PrivacyModal';
import TermsModal from '@/features/legal/TermsModal';
import SupportModal from '@/features/support/SupportModal';

export const modalLookup = {
	Feedback: FeedbackModal,
	Support: SupportModal,
	Privacy: PrivacyModal,
	Terms: TermsModal,
	Disclaimer: DisclaimerModal,
};

const renderModal = modal => {
	if (!modal?.type) return null;
	const ModalComponent = modalLookup[modal.type];
	if (!ModalComponent) {
		console.warn(`Modal type "${modal.type}" not found in modalLookup.`);
		return null;
	}
	return <ModalComponent key={modal.type} {...modal.props} />;
};

export default function ModalManager() {
	const { currentModal, overlayModal, priorityModal } = useSelector(state => state.ui);

	return (
		<>
			{renderModal(currentModal)}
			{renderModal(overlayModal)}
			{renderModal(priorityModal)}
		</>
	);
}
