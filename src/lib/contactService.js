/* eslint-disable no-promise-executor-return */
/**
 * @file This file contains the client-side logic for sending user communications
 * like feedback and support requests to a secure backend endpoint.
 */

/**
 * Sends feedback to a secure backend endpoint.
 *
 * @param {string} feedbackText The user's feedback content.
 * @param {string} userAddress The connected wallet address of the user.
 * @returns {Promise<{success: boolean, message: string}>} A promise that resolves with the result.
 */
export async function sendFeedback(feedbackText, userAddress) {
	console.log('[contactService] Preparing to send feedback:', { feedbackText, userAddress });
	// TODO: Replace with your actual serverless function endpoint.
	try {
		await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API delay
		console.log('[contactService] Mock feedback API call successful.');
		return { success: true, message: 'Feedback sent successfully!' };
	} catch (error) {
		console.error('[contactService] Error sending feedback:', error);
		return { success: false, message: 'Failed to send feedback. Please try again.' };
	}
}

/**
 * Sends a support request to a secure backend endpoint.
 *
 * @param {object} data The support request data.
 * @param {string} data.topic The topic of the request.
 * @param {string} data.subject The subject line.
 * @param {string} data.request The detailed request body.
 * @param {string} userAddress The connected wallet address of the user.
 * @returns {Promise<{success: boolean, message: string}>} A promise that resolves with the result.
 */
export async function sendSupportRequest(data, userAddress) {
	const payload = { ...data, userAddress };
	console.log('[contactService] Preparing to send support request:', payload);
	// TODO: Replace with your actual serverless function endpoint.
	try {
		await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API delay
		console.log('[contactService] Mock support API call successful.');
		return { success: true, message: 'Support request sent successfully!' };
	} catch (error) {
		console.error('[contactService] Error sending support request:', error);
		return { success: false, message: 'Failed to send support request. Please try again.' };
	}
}
