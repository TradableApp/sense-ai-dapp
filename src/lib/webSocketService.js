import { addReasoningStepById, updateMessageContentById } from '@/store/chatSlice';

class WebSocketService {
	constructor() {
		this.socket = null;
		this.dispatch = null;
	}

	/**
	 * Initializes the service and connects the websocket.
	 * This should be called once the user session is established.
	 * @param {function} dispatch - The Redux store's dispatch function.
	 * @param {string} authToken - A token to authenticate the websocket connection (e.g., a SIWE signature).
	 */
	init(dispatch, authToken) {
		if (this.socket || !dispatch || !authToken) {
			return;
		}
		this.dispatch = dispatch;

		const WEBSOCKET_URL = import.meta.env.VITE_ORACLE_WEBSOCKET_URL;
		if (!WEBSOCKET_URL) {
			console.warn('VITE_ORACLE_WEBSOCKET_URL not set. Live updates will be disabled.');
			return;
		}

		console.log('[WebSocketService] Initializing connection...');
		// The auth token is sent as a query parameter for the TEE to verify.
		this.socket = new WebSocket(`${WEBSOCKET_URL}?auth=${authToken}`);

		this.socket.onopen = () => {
			console.log('[WebSocketService] Connection established.');
		};

		this.socket.onmessage = event => {
			this.handleMessage(event.data);
		};

		this.socket.onclose = () => {
			console.log('[WebSocketService] Connection closed.');
			this.socket = null;
		};

		this.socket.onerror = error => {
			console.error('[WebSocketService] Error:', error);
		};
	}

	/**
	 * Parses incoming messages from the TEE and dispatches the appropriate Redux actions.
	 * @param {string} rawMessage - The raw JSON string from the websocket.
	 */
	handleMessage(rawMessage) {
		try {
			const message = JSON.parse(rawMessage);
			console.log('[WebSocketService] Received message:', message);

			switch (message.type) {
				case 'reasoning_step':
					this.dispatch(
						addReasoningStepById({
							answerMessageId: message.answerMessageId,
							reasoningStep: message.payload,
						}),
					);
					break;

				case 'final_answer':
					// This handles the "race condition". It dispatches the final answer,
					// and if The Graph sync comes later, it will just overwrite the same data.
					this.dispatch(
						updateMessageContentById({
							answerMessageId: message.answerMessageId,
							...message.payload, // Payload should contain { content, sources, reasoningDuration }
						}),
					);
					break;

				default:
					console.warn('[WebSocketService] Received unknown message type:', message.type);
			}
		} catch (error) {
			console.error('[WebSocketService] Failed to parse incoming message:', error);
		}
	}

	/**
	 * Closes the websocket connection.
	 * Should be called on user logout.
	 */
	disconnect() {
		if (this.socket) {
			this.socket.close();
		}
	}
}

// Export a singleton instance so the whole app shares one connection.
const webSocketService = new WebSocketService();
export default webSocketService;
