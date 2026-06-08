/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

export interface DeviceScreen {
	orientation: string | null;
	width: number | null;
	height: number | null;
	touch: boolean;
}

export interface DeviceState {
	pwa: boolean;
	screen: DeviceScreen;
	client: Record<string, unknown>;
	os: Record<string, unknown>;
	device: Record<string, unknown>;
	bot: Record<string, unknown> | null;
	online: boolean;
	latestIP: string;
	fingerprint: Record<string, unknown>;
}

// Annotated so the screen/bot fields are nullable rather than inferred as `null`
// literals (which would make the state type reject real string/number values).
const initialState: DeviceState = {
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
