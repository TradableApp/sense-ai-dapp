/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

interface AsyncState {
	loading: Record<string, boolean>;
	errors: Record<string, unknown>;
}

const initialState: AsyncState = {
	loading: {},
	errors: {},
};

const asyncSlice = createSlice({
	name: 'async',
	initialState,
	reducers: {
		asyncActionStart: (state, action: { payload: string }) => {
			const type = action.payload;
			// Clear any previous errors for this action type
			if (state.errors[type]) {
				delete state.errors[type];
			}
			state.loading[type] = true;
		},
		asyncActionFinish: (state, action: { payload: string }) => {
			const type = action.payload;
			if (state.loading[type]) {
				delete state.loading[type];
			}
		},
		asyncActionError: (state, action: { payload: { type: string; error: unknown } }) => {
			const { type, error } = action.payload;
			if (state.loading[type]) {
				delete state.loading[type];
			}
			state.errors[type] = error;
		},
	},
});

export const { asyncActionStart, asyncActionFinish, asyncActionError } = asyncSlice.actions;

export default asyncSlice.reducer;
