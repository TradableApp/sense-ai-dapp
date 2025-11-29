/**
 * @file syncService.js
 * @notice This service is the bridge between the decentralized backend (The Graph, Arweave)
 *         and the client-side IndexedDB cache. It is designed to be the primary mechanism
 *         for keeping the user's local data consistent with on-chain and decentralized storage state.
 * @dev The core workflow is to periodically fetch a list of updated entities from The Graph,
 *      "hydrate" this list by fetching the actual content from Arweave, decrypting it, and then
 *      performing a bulk update to the local IndexedDB. This provides a fast, offline-first experience.
 */

import { GraphQLClient } from 'graphql-request';

import { decryptData, encryptData } from './crypto';
import db from './db';
import { GET_USER_UPDATES_QUERY } from './graph/queries';
import { mergeSearchIndexDeltas } from './searchService';

// The Graph endpoint is configured via environment variables for flexibility between environments.
const THE_GRAPH_API_URL = import.meta.env.VITE_THE_GRAPH_API_URL;
const graphQLClient = new GraphQLClient(THE_GRAPH_API_URL);

// --- Internal Helper Functions ---

/**
 * @notice Retrieves the last successful sync timestamp from the user's encrypted metadata.
 * @dev This is critical for ensuring we only fetch new data, preventing redundant processing.
 *      If metadata can't be decrypted, it defaults to 0 to trigger a full re-sync.
 * @param {CryptoKey} sessionKey The user's session key for decryption.
 * @param {string} ownerAddress The user's wallet address, used as the key for the metadata record.
 * @returns {Promise<number>} The Unix timestamp (milliseconds) of the last sync, or 0 if none.
 */
async function getLastSyncedAt(sessionKey, ownerAddress) {
	if (!sessionKey || !ownerAddress) return 0;
	const metadataRecord = await db.userMetadata.get(ownerAddress);
	if (!metadataRecord) return 0;
	try {
		const decrypted = await decryptData(sessionKey, metadataRecord.encryptedData);
		return decrypted.conversationsLastSyncedAt || 0;
	} catch (error) {
		console.error('[syncService] Could not decrypt user metadata, syncing from scratch.', error);
		return 0;
	}
}

/**
 * @notice Updates the last successful sync timestamp in the user's encrypted metadata.
 * @dev This is called at the very end of a successful sync operation to "commit" the progress.
 * @param {CryptoKey} sessionKey The user's session key for encryption.
 * @param {string} ownerAddress The user's wallet address.
 * @param {number} timestamp The new Unix timestamp to set as the last sync time.
 */
async function setLastSyncedAt(sessionKey, ownerAddress, timestamp) {
	if (!sessionKey || !ownerAddress) return;
	let metadata = { searchLastSyncedAt: 0, conversationsLastSyncedAt: 0 };
	const existingRecord = await db.userMetadata.get(ownerAddress);
	if (existingRecord) {
		try {
			metadata = await decryptData(sessionKey, existingRecord.encryptedData);
		} catch (error) {
			console.error('[syncService] Could not decrypt existing metadata to update it.', error);
		}
	}
	metadata.conversationsLastSyncedAt = timestamp;
	const encryptedMetadata = await encryptData(sessionKey, metadata);
	await db.userMetadata.put({ ownerAddress, encryptedData: encryptedMetadata });
}

/**
 * @notice Fetches a list of updated conversation entities from The Graph's API.
 * @dev This is the entry point for the sync process. It queries for all conversations
 *      owned by the user that have been updated since the last sync.
 * @param {string} ownerAddress The user's wallet address.
 * @param {number} lastSync The timestamp of the last successful sync (Milliseconds).
 * @returns {Promise<Array>} A promise that resolves to a list of conversation entities from The Graph.
 */
async function fetchUpdatesFromTheGraph(ownerAddress, lastSync) {
	if (!THE_GRAPH_API_URL) {
		console.warn('[syncService] VITE_THE_GRAPH_API_URL is not set. Skipping remote sync.');
		return [];
	}
	try {
		// The Graph stores block timestamps in Seconds. We must convert our local MS timestamp.
		const lastSyncSeconds = Math.floor(lastSync / 1000);

		// The query variables are passed to the GraphQL client.
		const variables = {
			owner: ownerAddress.toLowerCase(),
			lastSync: lastSyncSeconds.toString(), // Send SECONDS
			limit: 250,
			offset: 0,
		};

		const data = await graphQLClient.request(GET_USER_UPDATES_QUERY, variables);

		// Convert BigInt strings from The Graph response into Numbers (MS) for frontend consistency.
		const conversations = (data.conversations || []).map(conv => ({
			...conv,
			lastMessageCreatedAt: Number(conv.lastMessageCreatedAt) * 1000,
			messages: conv.messages.map(msg => ({
				...msg,
				createdAt: Number(msg.createdAt) * 1000,
			})),
		}));

		return conversations;
	} catch (error) {
		console.error('[syncService] Failed to fetch updates from The Graph:', error);
		return []; // Return an empty array to allow the app to continue functioning.
	}
}

/**
 * @notice Fetches a single encrypted payload from an Arweave/Irys gateway.
 * @param {string} cid The Content ID (Arweave transaction ID) of the file.
 * @returns {Promise<string|null>} A promise resolving to the encrypted data as a string, or null on failure.
 */
async function fetchFromArweave(cid) {
	if (!cid) return null;
	try {
		const response = await fetch(`https://gateway.irys.xyz/${cid}`);
		if (!response.ok) {
			throw new Error(`Gateway returned status ${response.status} for CID ${cid}`);
		}
		return response.text();
	} catch (error) {
		console.error(`[syncService] Failed to fetch CID ${cid} from Arweave:`, error);
		return null; // Return null to prevent a single failed fetch from crashing the entire sync.
	}
}

/**
 * @notice Orchestrates the entire synchronization process from end to end.
 * @dev This is the main exported function. It chains together all helper functions
 *      to provide a complete, resilient sync operation.
 * @param {CryptoKey} sessionKey The user's session key.
 * @param {string} ownerAddress The user's wallet address.
 */
export default async function syncWithRemote(sessionKey, ownerAddress) {
	// Guard against running without a valid session.
	if (!sessionKey || !ownerAddress) return;

	console.log('[syncService] Starting remote sync process...');

	try {
		// 1. Get the last known sync timestamp from our local state (Milliseconds).
		const lastSync = await getLastSyncedAt(sessionKey, ownerAddress);

		// 2. Fetch all entity updates from The Graph since that timestamp.
		// (fetchUpdatesFromTheGraph handles the MS -> S -> MS conversions)
		const graphUpdates = await fetchUpdatesFromTheGraph(ownerAddress, lastSync);

		// 3. Determine the new timestamp cursor.
		let newLastSync = lastSync;
		if (graphUpdates.length > 0) {
			// If we got updates, the new cursor is the timestamp of the newest item we received.
			// Since graphUpdates is normalized to MS, this works directly.
			newLastSync = Math.max(...graphUpdates.map(c => c.lastMessageCreatedAt));
		} else {
			// If no updates, we can safely advance the cursor towards the present time,
			// leaving a buffer for indexing delays.
			const syncTime = Date.now();
			const buffer = 60 * 1000; // 1 minute buffer

			if (syncTime - buffer > lastSync) {
				newLastSync = syncTime - buffer;
			}
		}

		// If there are no updates, we're done. Update the timestamp to prevent constant polling on an idle account.
		if (graphUpdates.length === 0) {
			console.log('[syncService] No new updates found from The Graph.');
			await setLastSyncedAt(sessionKey, ownerAddress, newLastSync);
			return;
		}
		console.log(
			`[syncService] Found ${graphUpdates.length} updated conversation(s) from The Graph.`,
		);

		// 3. "Hydrate" the Graph data by fetching and decrypting all associated CIDs from Arweave in parallel.
		const hydrationPromises = graphUpdates.map(async conv => {
			// For each conversation, fetch its core data, metadata, and all its messages in parallel.
			const [convData, metadataData] = await Promise.all([
				fetchFromArweave(conv.conversationCID)
					.then(data => data && decryptData(sessionKey, data))
					.catch(() => null),
				fetchFromArweave(conv.conversationMetadataCID)
					.then(data => data && decryptData(sessionKey, data))
					.catch(() => null),
			]);

			const messageHydrationPromises = (conv.messages || []).map(async msg => {
				const [messageData, searchDeltaData] = await Promise.all([
					fetchFromArweave(msg.messageCID)
						.then(data => data && decryptData(sessionKey, data))
						.catch(() => null),
					msg.searchDelta
						? fetchFromArweave(msg.searchDelta.searchDeltaCID)
								.then(data => data && decryptData(sessionKey, data))
								.catch(() => null)
						: Promise.resolve(null),
				]);
				// Return a structured object for clarity, associating the message with its search delta.
				return {
					message: messageData ? { ...messageData, id: msg.id } : null,
					searchDelta: searchDeltaData,
				};
			});

			const messageResults = await Promise.all(messageHydrationPromises);

			// Return a single, fully hydrated object for the conversation.
			return {
				conversation: convData
					? {
							...convData,
							...metadataData,
							id: conv.id,
							// Inject the timestamp from The Graph (converted to MS) because
							// the Arweave metadata file usually lacks this sortable field.
							lastMessageCreatedAt: conv.lastMessageCreatedAt,
					  }
					: null,
				messages: messageResults.map(r => r.message).filter(Boolean),
				searchDeltas: messageResults.map(r => r.searchDelta).filter(Boolean),
			};
		});

		const hydratedData = (await Promise.all(hydrationPromises)).filter(item => item.conversation);

		// 4. Prepare all fetched data for bulk insertion into IndexedDB.
		const allSearchDeltas = hydratedData.flatMap(item => item.searchDeltas);

		const conversationCachePromises = hydratedData.map(async item => {
			const encryptedConv = await encryptData(sessionKey, item.conversation);
			return { ownerAddress, id: item.conversation.id, encryptedData: encryptedConv };
		});

		const messageCachePromises = hydratedData
			.filter(item => item.messages.length > 0)
			.map(async item => {
				const encryptedMessages = await encryptData(sessionKey, item.messages);
				return {
					ownerAddress,
					conversationId: item.conversation.id,
					encryptedData: encryptedMessages,
					lastAccessedAt: Date.now(),
				};
			});

		const [conversationsToCache, messagesToCache] = await Promise.all([
			Promise.all(conversationCachePromises),
			Promise.all(messageCachePromises),
		]);

		// 5. Execute all database operations. These are highly optimized bulk operations.
		if (conversationsToCache.length > 0) {
			await db.conversations.bulkPut(conversationsToCache);
			console.log(`[syncService] Cached ${conversationsToCache.length} conversations.`);
		}
		if (messagesToCache.length > 0) {
			await db.messageCache.bulkPut(messagesToCache);
			console.log(`[syncService] Cached messages for ${messagesToCache.length} conversations.`);
		}

		// 5. Merge search index deltas
		if (allSearchDeltas.length > 0) {
			await mergeSearchIndexDeltas(sessionKey, ownerAddress, allSearchDeltas);
		}

		// 6. Only update the 'last synced' timestamp after all operations succeed.
		// If any step above fails, this line won't be reached, and the next sync will re-process the failed items.
		await setLastSyncedAt(sessionKey, ownerAddress, newLastSync);
		console.log('[syncService] Remote sync process completed successfully.');
	} catch (error) {
		console.error('[syncService] A critical error occurred during the sync process:', error);
		// We do not update the timestamp on failure, ensuring the process will be retried.
	}
}
