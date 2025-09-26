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
		// --- FIX: Only set the ID. Do NOT clear messages here. ---
		// The Chat component's useQuery is responsible for fetching and setting the new messages.
		setActiveConversationId: (state, action) => {
			state.activeConversationId = action.payload;
		},
		clearActiveConversation: state => {
			state.activeConversationId = null;
			state.activeConversationMessages = [];
		},
		setActiveConversationMessages: (state, action) => {
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
