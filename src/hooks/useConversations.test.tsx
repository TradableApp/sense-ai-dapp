import type { ReactNode } from 'react';

import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import uiReducer from '@/store/uiSlice';

import useConversations from './useConversations';

const { syncMock, fetchConversationsMock } = vi.hoisted(() => ({
	syncMock: vi.fn(),
	fetchConversationsMock: vi.fn(),
}));

vi.mock('@/features/auth/SessionProvider', () => ({
	useSession: () => ({ sessionKey: {} as CryptoKey, ownerAddress: '0xowner' }),
}));
vi.mock('@/lib/syncService', () => ({ default: syncMock }));
vi.mock('@/lib/dataService', () => ({ fetchAndCacheConversations: fetchConversationsMock }));

const CONVERSATIONS = [{ id: 'c1', title: 'first' }];

function setup() {
	const store = configureStore({ reducer: { ui: uiReducer } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		</Provider>
	);
	const hook = renderHook(() => useConversations(), { wrapper });
	return { store, hook };
}

describe('useConversations', () => {
	beforeEach(() => {
		syncMock.mockReset();
		fetchConversationsMock.mockReset().mockResolvedValue(CONVERSATIONS);
	});
	afterEach(cleanup);

	it('exposes the conversation list as data, exactly as callers always received it', async () => {
		syncMock.mockResolvedValue({ unavailablePayloads: 0 });
		const { hook, store } = setup();

		await waitFor(() => expect(hook.result.current.data).toEqual(CONVERSATIONS));
		expect(store.getState().ui.storageDegraded).toBe(false);
	});

	it('flags storage as degraded from the sync result, outside queryFn', async () => {
		syncMock.mockResolvedValue({ unavailablePayloads: 2 });
		const { hook, store } = setup();

		await waitFor(() => expect(store.getState().ui.storageDegraded).toBe(true));
		expect(hook.result.current.data).toEqual(CONVERSATIONS);
	});

	it('clears the flag once a later pass fetched everything', async () => {
		syncMock.mockResolvedValueOnce({ unavailablePayloads: 1 });
		const { hook, store } = setup();
		await waitFor(() => expect(store.getState().ui.storageDegraded).toBe(true));

		syncMock.mockResolvedValueOnce({ unavailablePayloads: 0 });
		await hook.result.current.refetch();

		await waitFor(() => expect(store.getState().ui.storageDegraded).toBe(false));
	});
});
