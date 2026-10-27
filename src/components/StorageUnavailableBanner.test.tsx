import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it } from 'vitest';

import StorageUnavailableBanner from '@/components/StorageUnavailableBanner';
import uiReducer, { setStorageDegraded } from '@/store/uiSlice';

function renderBanner(store = configureStore({ reducer: { ui: uiReducer } })) {
	const view = render(
		<Provider store={store}>
			<StorageUnavailableBanner />
		</Provider>,
	);
	return Object.assign(store, { unmount: view.unmount });
}

const banner = () => screen.queryByRole('alert');

describe('StorageUnavailableBanner', () => {
	afterEach(cleanup);

	it('renders nothing while payload storage is healthy', () => {
		renderBanner();
		expect(banner()).toBeNull();
	});

	it('tells the user history is temporarily unavailable while a sync left payloads unfetched', () => {
		const store = renderBanner();
		act(() => {
			store.dispatch(setStorageDegraded(true));
		});
		expect(banner()?.textContent).toMatch(/history temporarily unavailable/i);
		expect(banner()?.textContent).toMatch(/retrying/i);
	});

	it('can be dismissed, and stays dismissed for the current outage', () => {
		const store = renderBanner();
		act(() => {
			store.dispatch(setStorageDegraded(true));
		});
		fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
		expect(banner()).toBeNull();
		act(() => {
			store.dispatch(setStorageDegraded(true));
		});
		expect(banner()).toBeNull();
	});

	it('keeps a dismissal across a remount — Chat and History share one outage', () => {
		// The banner is rendered independently in Chat and History; navigating between them
		// unmounts one instance and mounts another, and the dismissal must survive that.
		const store = renderBanner();
		act(() => {
			store.dispatch(setStorageDegraded(true));
		});
		fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
		store.unmount();

		renderBanner(store);
		expect(banner()).toBeNull();
	});

	it('clears on recovery and shows again for a new outage, even after a dismissal', () => {
		const store = renderBanner();
		act(() => {
			store.dispatch(setStorageDegraded(true));
		});
		fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
		act(() => {
			store.dispatch(setStorageDegraded(false));
		});
		expect(banner()).toBeNull();
		act(() => {
			store.dispatch(setStorageDegraded(true));
		});
		expect(banner()?.textContent).toMatch(/history temporarily unavailable/i);
	});
});
