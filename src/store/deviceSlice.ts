/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
	pwa: false,
	screen: {
		orientation: null,
		width: null,
		height: null,
		touch: false,
	},
	client: {},
	os: {},
	device: {},
	bot: null,
	online: true,
	latestIP: '',
	fingerprint: {},
	// Properties from main project not needed in this dApp yet,
	// but can be added here if required later:
	// hideNavBar: false,
	// navHeight: null,
	// suspectedBot: false,
};

export const deviceSlice = createSlice({
	name: 'device',
	initialState,
	reducers: {
		setDeviceInfo: (state, action) => {
			const { client, os, device, bot, fingerprint } = action.payload;
			state.client = client || {};
			state.os = os || {};
			state.device = device || {};
			state.bot = bot || null;
			state.fingerprint = fingerprint || {};
		},
		setDeviceScreen: (state, action) => {
			state.screen = { ...state.screen, ...action.payload };
		},
		setOnline: (state, action) => {
			state.online = action.payload;
		},
		setLatestIP: (state, action) => {
			state.latestIP = action.payload;
		},
		setPwa: (state, action) => {
			state.pwa = action.payload;
		},
	},
});

export const { setDeviceInfo, setDeviceScreen, setOnline, setLatestIP, setPwa } =
	deviceSlice.actions;

export default deviceSlice.reducer;
