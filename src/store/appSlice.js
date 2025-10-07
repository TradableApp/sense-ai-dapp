/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
	status: 'loading', // 'loading', 'ready', 'error'
	isThirdwebReady: false,
	isFirebaseReady: false,
	error: null,
};

export const appSlice = createSlice({
	name: 'app',
	initialState,
	reducers: {
		setThirdwebReady: state => {
			state.isThirdwebReady = true;
			if (state.isFirebaseReady) {
				state.status = 'ready';
			}
		},
		setFirebaseReady: state => {
			state.isFirebaseReady = true;
			if (state.isThirdwebReady) {
				state.status = 'ready';
			}
		},
		setAppError: (state, action) => {
			state.status = 'error';
			state.error = action.payload;
		},
	},
});

export const { setThirdwebReady, setFirebaseReady, setAppError } = appSlice.actions;

export default appSlice.reducer;
