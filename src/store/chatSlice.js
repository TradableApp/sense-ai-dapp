/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
	activeConversationId: null,
	isRenameModalOpen: false,
	conversationToRename: null, // Will hold { id, title }
};

export const chatSlice = createSlice({
	name: 'chat',
	initialState,
	reducers: {
		setActiveConversationId: (state, action) => {
			state.activeConversationId = action.payload;
		},
		clearActiveConversation: state => {
			state.activeConversationId = null;
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
	openRenameModal,
	closeRenameModal,
} = chatSlice.actions;

export default chatSlice.reducer;
