import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';

import { functions } from '@/config/firebase';

/**
 * Sends AI feedback to the dedicated cloud function.
 * @param {object} payload - The feedback data.
 * @param {string} payload.ownerAddress - The user's wallet address.
 * @param {string} payload.conversationId - The ID of the conversation.
 * @param {string} payload.messageId - The ID of the AI message being rated.
 * @param {string} payload.parentId - The ID of the user's prompt.
 * @param {'like' | 'dislike'} payload.feedbackValue - The feedback rating.
 * @returns {Promise<void>}
 */
const sendAiFeedback = async payload => {
	try {
		const submitAiFeedback = httpsCallable(functions, 'submitAiFeedback');
		await submitAiFeedback(payload);
		toast.success('Feedback Submitted', {
			description: 'Thank you for helping us improve our AI.',
		});
	} catch (error) {
		console.error('[feedbackService] Error sending AI feedback:', error);
		toast.error('Feedback Failed', {
			description: 'Could not submit your feedback at this time.',
		});
		// Re-throw the error so the UI component knows the submission failed
		throw error;
	}
};

export default sendAiFeedback;
