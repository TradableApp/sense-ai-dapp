import { describe, expect, it } from 'vitest';

import uiReducer, {
	closeModal,
	dismissStorageDegraded,
	openModal,
	setStorageDegraded,
	type UiState,
} from './uiSlice';

const initialState: UiState = {
	priorityModal: { type: null, props: {} },
	overlayModal: { type: null, props: {} },
	currentModal: { type: null, props: {} },
	storageDegraded: false,
	storageDegradedDismissed: false,
};

describe('uiSlice', () => {
	it('has correct initial state', () => {
		const state = uiReducer(undefined, { type: '@@INIT' });
		expect(state).toEqual(initialState);
	});

	describe('openModal', () => {
		it('opens modal in current position by default', () => {
			const state = uiReducer(initialState, openModal({ type: 'confirm', props: { id: '1' } }));
			expect(state.currentModal).toEqual({ type: 'confirm', props: { id: '1' } });
			expect(state.overlayModal).toEqual(initialState.overlayModal);
			expect(state.priorityModal).toEqual(initialState.priorityModal);
		});

		it('opens modal in overlay position', () => {
			const state = uiReducer(
				initialState,
				openModal({ type: 'detail', props: {}, position: 'overlay' }),
			);
			expect(state.overlayModal).toEqual({ type: 'detail', props: {} });
			expect(state.currentModal).toEqual(initialState.currentModal);
		});

		it('opens modal in priority position', () => {
			const state = uiReducer(
				initialState,
				openModal({ type: 'reauth', props: { reason: 'expired' }, position: 'priority' }),
			);
			expect(state.priorityModal).toEqual({ type: 'reauth', props: { reason: 'expired' } });
		});

		it('defaults props to empty object', () => {
			const state = uiReducer(initialState, openModal({ type: 'simple' }));
			expect(state.currentModal).toEqual({ type: 'simple', props: {} });
		});
	});

	describe('closeModal', () => {
		it('closes specific modal type from currentModal', () => {
			const withModal: UiState = {
				...initialState,
				currentModal: { type: 'confirm', props: {} },
			};
			const state = uiReducer(withModal, closeModal('confirm'));
			expect(state.currentModal).toEqual(initialState.currentModal);
		});

		it('closes specific modal type from overlayModal', () => {
			const withModal: UiState = {
				...initialState,
				overlayModal: { type: 'detail', props: {} },
			};
			const state = uiReducer(withModal, closeModal('detail'));
			expect(state.overlayModal).toEqual(initialState.overlayModal);
		});

		it('closes specific modal type from priorityModal', () => {
			const withModal: UiState = {
				...initialState,
				priorityModal: { type: 'reauth', props: {} },
			};
			const state = uiReducer(withModal, closeModal('reauth'));
			expect(state.priorityModal).toEqual(initialState.priorityModal);
		});

		it('closes topmost modal when no type specified (priority first)', () => {
			const allOpen: UiState = {
				priorityModal: { type: 'reauth', props: {} },
				overlayModal: { type: 'detail', props: {} },
				currentModal: { type: 'confirm', props: {} },
				storageDegraded: false,
				storageDegradedDismissed: false,
			};
			const state = uiReducer(allOpen, closeModal(undefined));
			expect(state.priorityModal).toEqual(initialState.priorityModal);
			expect(state.overlayModal).toEqual({ type: 'detail', props: {} });
			expect(state.currentModal).toEqual({ type: 'confirm', props: {} });
		});

		it('closes overlay when no type specified and no priority modal', () => {
			const withOverlay: UiState = {
				...initialState,
				overlayModal: { type: 'detail', props: {} },
				currentModal: { type: 'confirm', props: {} },
			};
			const state = uiReducer(withOverlay, closeModal(undefined));
			expect(state.overlayModal).toEqual(initialState.overlayModal);
			expect(state.currentModal).toEqual({ type: 'confirm', props: {} });
		});

		it('closes current when no type specified and no overlay or priority', () => {
			const withCurrent: UiState = {
				...initialState,
				currentModal: { type: 'confirm', props: {} },
			};
			const state = uiReducer(withCurrent, closeModal(undefined));
			expect(state.currentModal).toEqual(initialState.currentModal);
		});

		it('is a no-op if specified type does not match any open modal', () => {
			const state = uiReducer(initialState, closeModal('nonexistent'));
			expect(state).toEqual(initialState);
		});
	});

	describe('setStorageDegraded', () => {
		// Set by useConversations after each sync pass from the count of payloads that could
		// not be fetched from any source; read by StorageUnavailableBanner.
		it('flags payload storage as degraded', () => {
			const state = uiReducer(initialState, setStorageDegraded(true));
			expect(state.storageDegraded).toBe(true);
			expect(state.currentModal).toEqual(initialState.currentModal);
		});

		it('clears the flag once a sync pass fetched everything', () => {
			const degraded: UiState = { ...initialState, storageDegraded: true };
			expect(uiReducer(degraded, setStorageDegraded(false)).storageDegraded).toBe(false);
		});

		it('keeps a dismissal while the same outage continues', () => {
			const dismissed = uiReducer(
				uiReducer(initialState, setStorageDegraded(true)),
				dismissStorageDegraded(),
			);
			expect(dismissed.storageDegradedDismissed).toBe(true);
			expect(uiReducer(dismissed, setStorageDegraded(true)).storageDegradedDismissed).toBe(true);
		});

		it('re-arms the banner on recovery so a new outage is announced again', () => {
			const dismissed: UiState = {
				...initialState,
				storageDegraded: true,
				storageDegradedDismissed: true,
			};
			const recovered = uiReducer(dismissed, setStorageDegraded(false));
			expect(recovered.storageDegradedDismissed).toBe(false);
			expect(uiReducer(recovered, setStorageDegraded(true)).storageDegradedDismissed).toBe(false);
		});
	});
});
