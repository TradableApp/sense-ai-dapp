import { configureStore } from '@reduxjs/toolkit';

import chatReducer from './chatSlice';
import uiReducer from './uiSlice';

const store = configureStore({
	reducer: {
		chat: chatReducer,
		ui: uiReducer,
	},
});

export default store;
