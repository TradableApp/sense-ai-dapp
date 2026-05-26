import { describe, expect, it } from 'vitest';

import deviceReducer, {
	setDeviceInfo,
	setDeviceScreen,
	setLatestIP,
	setOnline,
	setPwa,
} from './deviceSlice';

const initialState = {
	pwa: false,
	screen: { orientation: null, width: null, height: null, touch: false },
	client: {},
	os: {},
	device: {},
	bot: null,
	online: true,
	latestIP: '',
	fingerprint: {},
};

describe('deviceSlice', () => {
	it('has correct initial state', () => {
		const state = deviceReducer(undefined, { type: '@@INIT' });
		expect(state).toEqual(initialState);
	});

	describe('setDeviceInfo', () => {
		it('sets client, os, device, bot, and fingerprint', () => {
			const payload = {
				client: { name: 'Chrome', version: '120' },
				os: { name: 'macOS', version: '14' },
				device: { type: 'desktop' },
				bot: null,
				fingerprint: { hash: 'abc123' },
			};
			const state = deviceReducer(initialState, setDeviceInfo(payload));
			expect(state.client).toEqual(payload.client);
			expect(state.os).toEqual(payload.os);
			expect(state.device).toEqual(payload.device);
			expect(state.bot).toBeNull();
			expect(state.fingerprint).toEqual(payload.fingerprint);
		});

		it('defaults to empty objects for missing fields', () => {
			const state = deviceReducer(initialState, setDeviceInfo({}));
			expect(state.client).toEqual({});
			expect(state.os).toEqual({});
			expect(state.device).toEqual({});
			expect(state.bot).toBeNull();
			expect(state.fingerprint).toEqual({});
		});
	});

	describe('setDeviceScreen', () => {
		it('merges screen properties', () => {
			const state = deviceReducer(initialState, setDeviceScreen({ width: 1920, height: 1080 }));
			expect(state.screen.width).toBe(1920);
			expect(state.screen.height).toBe(1080);
			expect(state.screen.touch).toBe(false);
		});

		it('preserves existing screen properties when partially updating', () => {
			const withScreen = {
				...initialState,
				screen: { orientation: 'landscape', width: 1024, height: 768, touch: true },
			};
			const state = deviceReducer(withScreen, setDeviceScreen({ width: 1440 }));
			expect(state.screen.width).toBe(1440);
			expect(state.screen.touch).toBe(true);
			expect(state.screen.orientation).toBe('landscape');
		});
	});

	describe('setOnline', () => {
		it('sets online to false', () => {
			const state = deviceReducer(initialState, setOnline(false));
			expect(state.online).toBe(false);
		});

		it('sets online to true', () => {
			const offline = { ...initialState, online: false };
			const state = deviceReducer(offline, setOnline(true));
			expect(state.online).toBe(true);
		});
	});

	describe('setLatestIP', () => {
		it('sets the IP address', () => {
			const state = deviceReducer(initialState, setLatestIP('192.168.1.1'));
			expect(state.latestIP).toBe('192.168.1.1');
		});
	});

	describe('setPwa', () => {
		it('sets PWA mode to true', () => {
			const state = deviceReducer(initialState, setPwa(true));
			expect(state.pwa).toBe(true);
		});

		it('sets PWA mode to false', () => {
			const pwaState = { ...initialState, pwa: true };
			const state = deviceReducer(pwaState, setPwa(false));
			expect(state.pwa).toBe(false);
		});
	});
});
