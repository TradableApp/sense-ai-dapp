import { useSelector } from 'react-redux';

import FeedbackModal from '@/features/feedback/FeedbackModal';
import SupportModal from '@/features/support/SupportModal';

export const modalLookup = {
	Feedback: FeedbackModal,
	Support: SupportModal,
};

const renderModal = modal => {
	if (!modal?.type) return null;
	const ModalComponent = modalLookup[modal.type];
	if (!ModalComponent) {
		console.warn(`Modal type "${modal.type}" not found in modalLookup.`);
		return null;
	}
	// IMPROVEMENT: Use the modal type for the key, as our system only allows one of each type.
	// This is more stable than using an array index.
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
