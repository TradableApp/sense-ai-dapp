import { httpsCallable } from 'firebase/functions';

import { functions } from '@/config/firebase';
import store from '@/store/store';

/**
 * Sends feedback to the 'fireSendGridEmail' cloud function.
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function sendFeedback(data, userAddress, displayName) {
	const { device } = store.getState();
	const payload = {
		templateName: 'd-bd111474dbf34fdb8e2bff7b166f36e3',
		subject: 'SenseAI has received feedback',
		from_email: data.email,
		from_name: displayName || userAddress,
		reply_email: data.email,
		reply_name: displayName || userAddress,
		to_email: 'support@tradable.app',
		to_name: 'Tradable Support',
		unique_body: data.feedback.replace(/(?:\r\n|\r|\n)/g, '<br>'),
		unique_id: userAddress,
		env: import.meta.env.MODE,
		project_id: import.meta.env.VITE_PROJECT_ID,
		device: JSON.stringify(device, null, '	'),
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
	const { device } = store.getState();
	const payload = {
		templateName: 'd-9bd340d5ca244acc84e18f25a0c70584',
		subject: `SenseAI has received a support request: ${data.topic}`,
		from_email: data.email,
		from_name: displayName || userAddress,
		reply_email: data.email,
		reply_name: displayName || userAddress,
		to_email: 'support@tradable.app',
		to_name: 'Tradable Support',
		unique_title: data.subject,
		unique_body: data.request.replace(/(?:\r\n|\r|\n)/g, '<br>'),
		unique_id: userAddress,
		priority: 'low priority',
		env: import.meta.env.MODE,
		project_id: import.meta.env.VITE_PROJECT_ID,
		device: JSON.stringify(device, null, '	'),
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
