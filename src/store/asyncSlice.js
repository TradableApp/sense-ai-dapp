/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
	loading: {},
	errors: {},
};

const asyncSlice = createSlice({
	name: 'async',
	initialState,
	reducers: {
		asyncActionStart: (state, action) => {
			const type = action.payload;
			// Clear any previous errors for this action type
			if (state.errors[type]) {
				delete state.errors[type];
			}
			state.loading[type] = true;
		},
		asyncActionFinish: (state, action) => {
			const type = action.payload;
			if (state.loading[type]) {
				delete state.loading[type];
			}
		},
		asyncActionError: (state, action) => {
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
