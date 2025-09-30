/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
	activeConversationId: null,
	activeConversationMessages: [], // This is the "hot" in-memory state for the active chat
	isRenameModalOpen: false,
	conversationToRename: null,
};

export const chatSlice = createSlice({
	name: 'chat',
	initialState,
	reducers: {
		// --- NEW ACTION TO RESET THE STATE ---
		// This reducer ignores any action payload and simply returns the slice
		// to its pristine, initial state.
		clearUserSession: () => initialState,

		// --- FIX: Make this an atomic state update ---
		// When we set a new conversation ID, we must immediately clear the messages
		// from the previous one. This prevents stale state and simplifies logic in the component.
		setActiveConversationId: (state, action) => {
			const newId = action.payload;
			// --- DEBUG LOG ---
			console.log(
				`%c[chatSlice.js-LOG] Reducer: setActiveConversationId. Payload: ${newId}. Current active ID: ${state.activeConversationId}`,
				'color: purple; font-weight: bold;',
			);
			if (state.activeConversationId !== newId) {
				state.activeConversationId = newId;
				state.activeConversationMessages = [];
				// --- DEBUG LOG ---
				console.log(
					`%c[chatSlice.js-LOG] State updated. New active ID: ${state.activeConversationId}, messages CLEARED.`,
					'color: purple; font-weight: bold;',
				);
			}
		},
		clearActiveConversation: state => {
			console.log(
				`%c[chatSlice.js-LOG] Reducer: clearActiveConversation.`,
				'color: purple; font-weight: bold;',
			);

			// ... (no change needed here, it's already correct)
			state.activeConversationId = null;
			state.activeConversationMessages = [];
		},
		setActiveConversationMessages: (state, action) => {
			// --- DEBUG LOG ---
			console.log(
				`%c[chatSlice.js-LOG] Reducer: setActiveConversationMessages. Hydrating with ${action.payload.length} messages.`,
				'color: purple; font-weight: bold;',
			);
			state.activeConversationMessages = action.payload;
		},
		appendLiveMessages: (state, action) => {
			state.activeConversationMessages.push(...action.payload);
		},
		addReasoningStepByCorrelationId: (state, action) => {
			const { correlationId, reasoningStep } = action.payload;
			const message = state.activeConversationMessages.find(m => m.correlationId === correlationId);
			if (message) {
				if (!message.reasoning) message.reasoning = [];
				message.reasoning.push(reasoningStep);
			}
		},
		updateMessageContentByCorrelationId: (state, action) => {
			const { correlationId, content, sources, reasoningDuration } = action.payload;
			const message = state.activeConversationMessages.find(m => m.correlationId === correlationId);
			if (message) {
				message.content = content;
				message.sources = sources;
				message.reasoningDuration = reasoningDuration;
				delete message.correlationId;
			}
		},
		openRenameModal: (state, action) => {
			state.isRenameModalOpen = true;
			state.conversationToRename = action.payload;
		},
		closeRenameModal: state => {
			state.isRenameModalOpen = false;
			state.conversationToRename = null;
		},
	},
});

export const {
	clearUserSession,
	setActiveConversationId,
	clearActiveConversation,
	setActiveConversationMessages,
	appendLiveMessages,
	addReasoningStepByCorrelationId,
	updateMessageContentByCorrelationId,
	openRenameModal,
	closeRenameModal,
} = chatSlice.actions;

export default chatSlice.reducer;
