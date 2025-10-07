import { configureStore } from '@reduxjs/toolkit';

import appReducer from './appSlice';
import chatReducer from './chatSlice';
import deviceReducer from './deviceSlice';
import uiReducer from './uiSlice';

const store = configureStore({
	reducer: {
		app: appReducer,
		chat: chatReducer,
		device: deviceReducer,
		ui: uiReducer,
	},
});

export default store;
