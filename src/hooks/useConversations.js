// src/hooks/useConversations.js
import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/features/auth/SessionProvider';
import { fetchAndCacheConversations } from '@/lib/dataService';
import syncWithRemote from '@/lib/syncService';

/**
 * A centralized hook to manage fetching, caching, and background polling
 * of the user's conversation list.
 *
 * This hook ensures that data fetching logic is not duplicated and that
 * background polling works consistently across desktop and mobile.
 *
 * It first triggers a sync with the remote data source (The Graph, Arweave)
 * and then reads the consolidated, up-to-date data from the local IndexedDB cache.
 *
 * @returns {object} The result object from React Query, containing `data`, `isLoading`, etc.
 */
export default function useConversations() {
	const { sessionKey, ownerAddress } = useSession();

	return useQuery({
		queryKey: ['conversations', sessionKey, ownerAddress],
		queryFn: async () => {
			// Step 1: Sync with remote sources (The Graph, Arweave).
			// This will fetch updates and store them in IndexedDB.
			await syncWithRemote(sessionKey, ownerAddress);

			// Step 2: Read the complete, up-to-date list from the local cache.
			// This function remains the source of truth for the UI.
			return fetchAndCacheConversations(sessionKey, ownerAddress);
		},
		enabled: !!sessionKey && !!ownerAddress,
		// Fetch every 5 minutes to catch updates from other devices.
		refetchInterval: 5 * 60 * 1000,
		// Keep data fresh for a longer period as it's the main cache.
		staleTime: 5 * 60 * 1000,
	});
}
