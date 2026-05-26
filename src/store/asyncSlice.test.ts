import { describe, expect, it } from 'vitest';

import asyncReducer, { asyncActionError, asyncActionFinish, asyncActionStart } from './asyncSlice';

const initialState = { loading: {}, errors: {} };

describe('asyncSlice', () => {
	it('has correct initial state', () => {
		const state = asyncReducer(undefined, { type: '@@INIT' });
		expect(state).toEqual(initialState);
	});

	describe('asyncActionStart', () => {
		it('sets loading flag for action type', () => {
			const state = asyncReducer(initialState, asyncActionStart('FETCH_DATA'));
			expect(state.loading.FETCH_DATA).toBe(true);
		});

		it('clears previous error for the same action type', () => {
			const withError = { loading: {}, errors: { FETCH_DATA: 'old error' } };
			const state = asyncReducer(withError, asyncActionStart('FETCH_DATA'));
			expect(state.errors.FETCH_DATA).toBeUndefined();
			expect(state.loading.FETCH_DATA).toBe(true);
		});

		it('does not affect other action types', () => {
			const existing = { loading: { OTHER: true }, errors: {} };
			const state = asyncReducer(existing, asyncActionStart('FETCH_DATA'));
			expect(state.loading.OTHER).toBe(true);
			expect(state.loading.FETCH_DATA).toBe(true);
		});
	});

	describe('asyncActionFinish', () => {
		it('removes loading flag for action type', () => {
			const loading = { loading: { FETCH_DATA: true }, errors: {} };
			const state = asyncReducer(loading, asyncActionFinish('FETCH_DATA'));
			expect(state.loading.FETCH_DATA).toBeUndefined();
		});

		it('is a no-op if action type was not loading', () => {
			const state = asyncReducer(initialState, asyncActionFinish('NONEXISTENT'));
			expect(state).toEqual(initialState);
		});
	});

	describe('asyncActionError', () => {
		it('removes loading flag and stores error', () => {
			const loading = { loading: { FETCH_DATA: true }, errors: {} };
			const state = asyncReducer(
				loading,
				asyncActionError({ type: 'FETCH_DATA', error: 'Network timeout' }),
			);
			expect(state.loading.FETCH_DATA).toBeUndefined();
			expect(state.errors.FETCH_DATA).toBe('Network timeout');
		});

		it('stores complex error objects', () => {
			const error = { code: 500, message: 'Internal error' };
			const state = asyncReducer(
				initialState,
				asyncActionError({ type: 'SUBMIT', error }),
			);
			expect(state.errors.SUBMIT).toEqual(error);
		});
	});

	it('full lifecycle: start → finish', () => {
		let state = asyncReducer(initialState, asyncActionStart('LOAD'));
		expect(state.loading.LOAD).toBe(true);

		state = asyncReducer(state, asyncActionFinish('LOAD'));
		expect(state.loading.LOAD).toBeUndefined();
		expect(state.errors.LOAD).toBeUndefined();
	});

	it('full lifecycle: start → error', () => {
		let state = asyncReducer(initialState, asyncActionStart('LOAD'));
		state = asyncReducer(state, asyncActionError({ type: 'LOAD', error: 'fail' }));
		expect(state.loading.LOAD).toBeUndefined();
		expect(state.errors.LOAD).toBe('fail');
	});
});
