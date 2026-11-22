// src/hooks/useConversations.ts
import { useEffect } from 'react';

import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/features/auth/SessionProvider';
import { fetchAndCacheConversations } from '@/lib/dataService';
import syncWithRemote from '@/lib/syncService';
import { useAppDispatch } from '@/store/hooks';
import { setGraphUnavailable, setStorageDegraded } from '@/store/uiSlice';

/**
 * A centralized hook to manage fetching, caching, and background polling
 * of the user's conversation list.
 *
 * This hook ensures that data fetching logic is not duplicated and that
 * background polling works consistently across desktop and mobile.
 *
 * It first triggers a sync with the remote data source (The Graph, payload storage)
 * and then reads the consolidated, up-to-date data from the local IndexedDB cache.
 *
 * The sync's `unavailablePayloads` count and `graphUnavailable` flag travel with the query
 * data and are turned into the `storageDegraded` and `graphUnavailable` UI flags in an effect — never inside `queryFn`, which TanStack
 * Query runs for background refetches outside React's render cycle. Callers still receive
 * `data` as the conversation list.
 *
 * @returns {object} The result object from React Query, containing `data`, `isLoading`, etc.
 */
export default function useConversations() {
	const { sessionKey, ownerAddress } = useSession();
	const dispatch = useAppDispatch();

	const query = useQuery({
		queryKey: ['conversations', sessionKey, ownerAddress],
		queryFn: async () => {
			// Step 1: Sync with remote sources (The Graph, payload storage).
			// This will fetch updates and store them in IndexedDB.
			if (!sessionKey) throw new Error('Session key is required');
			if (!ownerAddress) throw new Error('Owner address is required');

			const { unavailablePayloads, graphUnavailable } = await syncWithRemote(
				sessionKey,
				ownerAddress,
			);

			// Step 2: Read the complete, up-to-date list from the local cache.
			// This function remains the source of truth for the UI.
			const conversations = await fetchAndCacheConversations(sessionKey, ownerAddress);
			return { conversations, unavailablePayloads, graphUnavailable };
		},
		enabled: !!sessionKey && !!ownerAddress,
		// Fetch every 5 minutes to catch updates from other devices.
		refetchInterval: 5 * 60 * 1000,
		// Keep data fresh for a longer period as it's the main cache.
		staleTime: 5 * 60 * 1000,
	});

	const unavailablePayloads = query.data?.unavailablePayloads;
	useEffect(() => {
		// Drives the "history temporarily unavailable, retrying" banner; a clean pass clears
		// it. The refetch interval above is the retry.
		if (unavailablePayloads !== undefined) dispatch(setStorageDegraded(unavailablePayloads > 0));
	}, [unavailablePayloads, dispatch]);

	const graphUnavailable = query.data?.graphUnavailable;
	useEffect(() => {
		// Drives the "history could not be refreshed" notice; a pass that read The Graph clears it.
		if (graphUnavailable !== undefined) dispatch(setGraphUnavailable(graphUnavailable));
	}, [graphUnavailable, dispatch]);

	return { ...query, data: query.data?.conversations };
}
