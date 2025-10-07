import { configureStore } from '@reduxjs/toolkit';

import appReducer from './appSlice';
import chatReducer from './chatSlice';
import uiReducer from './uiSlice';

const store = configureStore({
	reducer: {
		app: appReducer,
		chat: chatReducer,
		ui: uiReducer,
	},
});

export default store;
