import { describe, expect, it } from 'vitest';

import appReducer, {
	type AppState,
	setAppError,
	setFirebaseReady,
	setThirdwebReady,
} from './appSlice';

const initialState: AppState = {
	status: 'loading',
	isThirdwebReady: false,
	isFirebaseReady: false,
	error: null,
};

describe('appSlice', () => {
	it('has correct initial state', () => {
		const state = appReducer(undefined, { type: '@@INIT' });
		expect(state).toEqual(initialState);
	});

	describe('setThirdwebReady', () => {
		it('sets isThirdwebReady to true', () => {
			const state = appReducer(initialState, setThirdwebReady());
			expect(state.isThirdwebReady).toBe(true);
		});

		it('does not set status to ready if Firebase is not ready', () => {
			const state = appReducer(initialState, setThirdwebReady());
			expect(state.status).toBe('loading');
		});

		it('sets status to ready if Firebase is already ready', () => {
			const withFirebase: AppState = { ...initialState, isFirebaseReady: true };
			const state = appReducer(withFirebase, setThirdwebReady());
			expect(state.status).toBe('ready');
		});
	});

	describe('setFirebaseReady', () => {
		it('sets isFirebaseReady to true', () => {
			const state = appReducer(initialState, setFirebaseReady());
			expect(state.isFirebaseReady).toBe(true);
		});

		it('does not set status to ready if Thirdweb is not ready', () => {
			const state = appReducer(initialState, setFirebaseReady());
			expect(state.status).toBe('loading');
		});

		it('sets status to ready if Thirdweb is already ready', () => {
			const withThirdweb: AppState = { ...initialState, isThirdwebReady: true };
			const state = appReducer(withThirdweb, setFirebaseReady());
			expect(state.status).toBe('ready');
		});
	});

	describe('setAppError', () => {
		it('sets status to error and stores the error message', () => {
			const state = appReducer(initialState, setAppError('Something went wrong'));
			expect(state.status).toBe('error');
			expect(state.error).toBe('Something went wrong');
		});

		it('overrides ready status with error', () => {
			const readyState: AppState = {
				...initialState,
				status: 'ready',
				isThirdwebReady: true,
				isFirebaseReady: true,
			};
			const state = appReducer(readyState, setAppError('Fatal'));
			expect(state.status).toBe('error');
		});
	});

	it('both providers ready in sequence sets status to ready', () => {
		let state = appReducer(initialState, setThirdwebReady());
		state = appReducer(state, setFirebaseReady());
		expect(state.status).toBe('ready');
		expect(state.isThirdwebReady).toBe(true);
		expect(state.isFirebaseReady).toBe(true);
	});

	it('both providers ready in reverse order sets status to ready', () => {
		let state = appReducer(initialState, setFirebaseReady());
		state = appReducer(state, setThirdwebReady());
		expect(state.status).toBe('ready');
	});
});
