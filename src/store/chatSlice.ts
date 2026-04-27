/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

interface ConversationRef {
	id: string;
	title: string;
}

export interface ActiveMessage {
	id?: string | number;
	parentId?: number | null;
	messageCID?: string | null;
	content?: string | null;
	status?: string;
	createdAt?: number;
	role?: string;
	answerMessageId?: string;
	sources?: unknown;
	reasoning?: unknown[];
	reasoningDuration?: number;
	[key: string]: unknown;
}

export interface ChatState {
	activeConversationId: string | null;
	activeConversationMessages: ActiveMessage[];
	isRenameModalOpen: boolean;
	conversationToRename: ConversationRef | null;
}

const initialState: ChatState = {
	activeConversationId: null,
	activeConversationMessages: [],
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

		// When we set a new conversation ID, we must immediately clear the messages
		// from the previous one. This prevents stale state and simplifies logic in the component.
		setActiveConversationId: (state, action) => {
			const newId = action.payload;
			if (state.activeConversationId !== newId) {
				state.activeConversationId = newId;
				state.activeConversationMessages = [];
			}
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
		addReasoningStepById: (state, action) => {
			const { answerMessageId, reasoningStep } = action.payload;
			const message = state.activeConversationMessages.find(
				m => m.answerMessageId === answerMessageId,
			);
			if (message) {
				if (!message.reasoning) message.reasoning = [];
				message.reasoning.push(reasoningStep);
			}
		},
		updateMessageContentById: (state, action) => {
			const { answerMessageId, content, sources, reasoningDuration } = action.payload;
			const message = state.activeConversationMessages.find(
				m => m.answerMessageId === answerMessageId,
			);
			if (message) {
				message.content = content;
				message.sources = sources;
				message.reasoningDuration = reasoningDuration;
				delete message.answerMessageId;
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
	addReasoningStepById,
	updateMessageContentById,
	openRenameModal,
	closeRenameModal,
} = chatSlice.actions;

export default chatSlice.reducer;
