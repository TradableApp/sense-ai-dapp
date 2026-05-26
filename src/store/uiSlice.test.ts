import { describe, expect, it } from 'vitest';

import uiReducer, { closeModal, openModal, type UiState } from './uiSlice';

const initialState: UiState = {
	priorityModal: { type: null, props: {} },
	overlayModal: { type: null, props: {} },
	currentModal: { type: null, props: {} },
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
});
