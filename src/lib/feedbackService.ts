import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';

import { functions } from '@/config/firebase';
import { type AnswerRating, ratingDeployment, ratingDocId } from '@/lib/answerRating';

interface FeedbackPayload {
	sessionKey: CryptoKey;
	conversationId: string | number;
	messageId: string | number;
	/** null removes the rating. */
	feedbackValue: AnswerRating | null;
}

/**
 * Saves or removes one answer's rating through the submitAiFeedback callable.
 *
 * What is sent is the rating id (computed from the session key), the value, and the build's chain
 * id and agent address. No wallet address and no conversation or message id leave the device.
 * A failure is logged by the error's name only and re-thrown, so the caller can put its control
 * back.
 */
const sendAiFeedback = async ({
	sessionKey,
	conversationId,
	messageId,
	feedbackValue,
}: FeedbackPayload): Promise<void> => {
	try {
		if (!functions) throw new Error('Firebase functions not initialized');
		const deployment = ratingDeployment();
		if (!deployment) throw new Error('This build names no chain id and agent address.');
		const { chainId, agentAddress } = deployment;
		const docId = await ratingDocId(sessionKey, {
			chainId,
			agentAddress,
			conversationId,
			messageId,
		});
		const submitAiFeedback = httpsCallable(functions, 'submitAiFeedback');
		await submitAiFeedback({ docId, feedbackValue, chainId, agentAddress });
		if (feedbackValue === null) {
			toast.success('Rating Removed', { description: 'Your rating for this answer was removed.' });
		} else {
			toast.success('Feedback Submitted', {
				description: 'Thank you for helping us improve our AI.',
			});
		}
	} catch (error) {
		console.error(
			'[feedbackService] Error sending AI feedback:',
			error instanceof Error ? error.name : typeof error,
		);
		toast.error('Feedback Failed', {
			description: 'Could not submit your feedback at this time.',
		});
		// Re-throw the error so the UI component knows the submission failed
		throw error;
	}
};

export default sendAiFeedback;
