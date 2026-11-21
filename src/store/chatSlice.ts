/* eslint-disable no-param-reassign */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

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
	// Shape matches the oracle's answer MessageFile + the Reasoning/Source UI components
	// (see components/ai/reasoning.tsx / source.tsx) and lib/types Message.
	sources?: Array<{ title: string; url: string }>;
	reasoning?: Array<{ title: string; description: string }>;
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
		appendLiveMessages: (state, action: PayloadAction<ActiveMessage[]>) => {
			// On-chain ids are unique: a message already here (shown from its receipt after a save
			// was given up on, then added by the save that finished late) is not added twice.
			const present = new Set(
				state.activeConversationMessages.flatMap(m => (m.id == null ? [] : [String(m.id)])),
			);
			const added = action.payload.filter(m => m.id == null || !present.has(String(m.id)));
			state.activeConversationMessages.push(...added);
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
	openRenameModal,
	closeRenameModal,
} = chatSlice.actions;

export default chatSlice.reducer;
