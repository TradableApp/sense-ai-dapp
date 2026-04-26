import { configureStore } from '@reduxjs/toolkit';

import appReducer from './appSlice';
import asyncReducer from './asyncSlice';
import chatReducer from './chatSlice';
import deviceReducer from './deviceSlice';
import uiReducer from './uiSlice';

const store = configureStore({
	reducer: {
		app: appReducer,
		async: asyncReducer,
		chat: chatReducer,
		device: deviceReducer,
		ui: uiReducer,
	},
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
