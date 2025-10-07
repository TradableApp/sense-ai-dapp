import { httpsCallable } from 'firebase/functions';

import { functions } from '@/config/firebase';

/**
 * Sends feedback to the 'fireSendGridEmail' cloud function.
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function sendFeedback(data, userAddress, displayName) {
	const payload = {
		templateName: 'd-bd111474dbf34fdb8e2bff7b166f36e3', // Your feedback template ID
		subject: 'SenseAI has received feedback',
		from_email: data.email,
		from_name: displayName || userAddress,
		reply_email: data.email,
		reply_name: displayName || userAddress,
		to_email: 'support@tradable.app',
		to_name: 'Tradable Support',
		unique_body: data.feedback.replace(/(?:\r\n|\r|\n)/g, '<br>'),
		unique_id: userAddress, // Use wallet address as the unique ID
		// You can add other fields like 'env' or 'project_id' if your function needs them
	};

	try {
		const fireSendGridEmail = httpsCallable(functions, 'fireSendGridEmail');
		await fireSendGridEmail(payload);
		return { success: true, message: 'Feedback sent successfully!' };
	} catch (error) {
		console.error('[contactService] Error calling fireSendGridEmail for feedback:', error);
		const errorMessage = error.message || 'An unknown error occurred.';
		return { success: false, message: `Failed to send feedback: ${errorMessage}` };
	}
}

/**
 * Sends a support request to the 'fireSendGridEmail' cloud function.
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function sendSupportRequest(data, userAddress, displayName) {
	const payload = {
		templateName: 'd-9bd340d5ca244acc84e18f25a0c70584', // Your support request template ID
		subject: `SenseAI has received a support request: ${data.topic}`,
		from_email: data.email,
		from_name: displayName || userAddress,
		reply_email: data.email,
		reply_name: displayName || userAddress,
		to_email: 'support@tradable.app',
		to_name: 'Tradable Support',
		unique_title: data.subject,
		unique_body: data.request.replace(/(?:\r\n|\r|\n)/g, '<br>'),
		unique_id: userAddress, // Use wallet address as the unique ID
		// You might want to add 'priority' or other fields here based on your function's logic
	};

	try {
		const fireSendGridEmail = httpsCallable(functions, 'fireSendGridEmail');
		await fireSendGridEmail(payload);
		return { success: true, message: 'Support request sent successfully!' };
	} catch (error) {
		console.error('[contactService] Error calling fireSendGridEmail for support:', error);
		const errorMessage = error.message || 'An unknown error occurred.';
		return { success: false, message: `Failed to send support request: ${errorMessage}` };
	}
}
