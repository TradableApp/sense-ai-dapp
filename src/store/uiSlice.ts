/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
	// A tiered system to manage modal layers.
	// 'priority' is for critical modals (e.g., re-auth).
	// 'overlay' can be for secondary modals on top of a primary one.
	// 'current' is the default for standard modals.
	priorityModal: { type: null, props: {} },
	overlayModal: { type: null, props: {} },
	currentModal: { type: null, props: {} },
};

export const uiSlice = createSlice({
	name: 'ui',
	initialState,
	reducers: {
		/**
		 * Opens a modal in a specific tier.
		 * @param payload {{type: string, props?: object, position?: 'current'|'overlay'|'priority'}}
		 */
		openModal: (state, action) => {
			const { type, props = {}, position = 'current' } = action.payload;
			const modalKey = `${position}Modal`; // e.g., 'currentModal'
			state[modalKey] = { type, props };
		},

		/**
		 * Closes a modal. If no specific type is provided, it closes the top-most visible modal.
		 */
		closeModal: (state, action) => {
			const typeToClose = action.payload;
			if (typeToClose) {
				if (state.priorityModal.type === typeToClose) {
					state.priorityModal = initialState.priorityModal;
				} else if (state.overlayModal.type === typeToClose) {
					state.overlayModal = initialState.overlayModal;
				} else if (state.currentModal.type === typeToClose) {
					state.currentModal = initialState.currentModal;
				}

				// Close in order of priority if no type is specified.
			} else if (state.priorityModal.type) {
				state.priorityModal = initialState.priorityModal;
			} else if (state.overlayModal.type) {
				state.overlayModal = initialState.overlayModal;
			} else {
				state.currentModal = initialState.currentModal;
			}
		},
	},
});

export const { openModal, closeModal } = uiSlice.actions;

export default uiSlice.reducer;
