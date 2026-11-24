/* eslint-disable no-param-reassign */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

interface ModalState {
	type: string | null;
	props: Record<string, unknown>;
}

type ModalTier = 'priorityModal' | 'overlayModal' | 'currentModal';

export interface UiState {
	priorityModal: ModalState;
	overlayModal: ModalState;
	currentModal: ModalState;
	/**
	 * True while the last sync pass left payloads that no storage source could serve.
	 * Set by useConversations from the sync result; read by StorageUnavailableBanner.
	 */
	storageDegraded: boolean;
	/** The user dismissed the banner for the current outage. Cleared when storage recovers. */
	storageDegradedDismissed: boolean;
	/**
	 * True while the last sync pass could not read The Graph (nothing stored, cursor held).
	 * Set by useConversations from the sync result; read by StorageUnavailableBanner and the
	 * notice of a branch held for its history.
	 */
	graphUnavailable: boolean;
	/** The user dismissed that notice for the current failure. Cleared by a pass that read it. */
	graphUnavailableDismissed: boolean;
}

const initialState: UiState = {
	// A tiered system to manage modal layers.
	// 'priority' is for critical modals (e.g., re-auth).
	// 'overlay' can be for secondary modals on top of a primary one.
	// 'current' is the default for standard modals.
	priorityModal: { type: null, props: {} },
	overlayModal: { type: null, props: {} },
	currentModal: { type: null, props: {} },
	storageDegraded: false,
	storageDegradedDismissed: false,
	graphUnavailable: false,
	graphUnavailableDismissed: false,
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
			const modalKey = `${position}Modal` as ModalTier; // e.g., 'currentModal'
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

		/** Flags (or clears) the "history temporarily unavailable" state after a sync pass. */
		setStorageDegraded: (state, action: PayloadAction<boolean>) => {
			state.storageDegraded = action.payload;
			// Recovery re-arms the banner so the next outage is announced again.
			if (!action.payload) state.storageDegradedDismissed = false;
		},

		/** Hides the banner for the current outage, in every place it is rendered. */
		dismissStorageDegraded: state => {
			state.storageDegradedDismissed = true;
		},

		/** Flags (or clears) the "history could not be refreshed" state after a sync pass. */
		setGraphUnavailable: (state, action: PayloadAction<boolean>) => {
			state.graphUnavailable = action.payload;
			// A pass that read The Graph re-arms the notice so the next failure is announced again.
			if (!action.payload) state.graphUnavailableDismissed = false;
		},

		/** Hides that notice for the current failure, in every place it is rendered. */
		dismissGraphUnavailable: state => {
			state.graphUnavailableDismissed = true;
		},
	},
});

export const {
	openModal,
	closeModal,
	setStorageDegraded,
	dismissStorageDegraded,
	setGraphUnavailable,
	dismissGraphUnavailable,
} = uiSlice.actions;

export default uiSlice.reducer;
