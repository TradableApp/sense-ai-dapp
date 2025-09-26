// src/lib/syncService.js
/* eslint-disable no-unused-vars */
import { decryptData, encryptData } from './crypto';
import db from './db';
import { mergeSearchIndexDeltas } from './searchService';

/**
 * Retrieves the last sync timestamp for conversations from user metadata.
 * @param {CryptoKey} sessionKey The user's session key for decryption.
 * @param {string} ownerAddress The user's wallet address.
 * @returns {Promise<number>} The Unix timestamp of the last sync, or 0 if none.
 */
const getLastSyncedAt = async (sessionKey, ownerAddress) => {
	if (!sessionKey || !ownerAddress) return 0;
	const metadataRecord = await db.userMetadata.get(ownerAddress);
	if (!metadataRecord) return 0;
	try {
		const decrypted = await decryptData(sessionKey, metadataRecord.encryptedData);
		return decrypted.conversationsLastSyncedAt || 0;
	} catch (error) {
		console.error('[syncService] Could not decrypt metadata, syncing from scratch.', error);
		return 0;
	}
};

/**
 * Updates the last sync timestamp for conversations in user metadata.
 * @param {CryptoKey} sessionKey The user's session key for encryption.
 * @param {string} ownerAddress The user's wallet address.
 * @param {number} timestamp The new Unix timestamp for the last sync.
 */
const setLastSyncedAt = async (sessionKey, ownerAddress, timestamp) => {
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
};

/**
 * STUB: Fetches conversation updates from The Graph.
 * In the future, this will be a real GraphQL query.
 * @param {string} ownerAddress The user's wallet address.
 * @param {number} lastSync The timestamp of the last successful sync.
 * @returns {Promise<Array>} A promise that resolves to a list of conversation entities.
 */
const fetchUpdatesFromTheGraph = async (ownerAddress, lastSync) => {
	console.log(
		`[syncService] STUB: Fetching updates from The Graph for ${ownerAddress} since ${new Date(
			lastSync,
		).toISOString()}`,
	);
	// In the future, you would use a GraphQL client here with the GET_USER_UPDATES_QUERY.
	// For now, we return an empty array to simulate no new updates.
	return Promise.resolve([]);
};

/**
 * STUB: Fetches a single encrypted payload from an Arweave gateway.
 * @param {string} cid The Content ID of the file on Arweave.
 * @returns {Promise<string|null>} A promise resolving to the encrypted data string or null.
 */
const fetchFromArweave = async cid => {
	console.log(`[syncService] STUB: Fetching CID ${cid} from Arweave.`);
	// This would be a real fetch call, e.g., `fetch(\`https://arweave.net/${cid}\`)`.
	// For now, we return a promise that resolves to null.
	return Promise.resolve(null);
};

/**
 * Orchestrates the entire synchronization process.
 * Fetches updates from The Graph, hydrates CIDs from Arweave, decrypts,
 * and caches the data into IndexedDB.
 * @param {CryptoKey} sessionKey The user's session key.
 * @param {string} ownerAddress The user's wallet address.
 */
const syncWithRemote = async (sessionKey, ownerAddress) => {
	if (!sessionKey || !ownerAddress) return;
	console.log('[syncService] Starting remote sync process...');
	const syncStartTime = Date.now();
	const lastSync = await getLastSyncedAt(sessionKey, ownerAddress);

	try {
		// 1. Fetch metadata updates from The Graph
		const graphUpdates = await fetchUpdatesFromTheGraph(ownerAddress, lastSync);

		if (graphUpdates.length === 0) {
			console.log('[syncService] No new updates found from The Graph.');
			// Still update the timestamp to prevent constant re-polling on an idle account.
			await setLastSyncedAt(sessionKey, ownerAddress, syncStartTime);
			return;
		}

		// 2. Hydrate data by fetching CIDs from Arweave in parallel
		const hydrationPromises = graphUpdates.map(async conv => {
			const [convData, metadataData] = await Promise.all([
				fetchFromArweave(conv.conversationCID)
					.then(data => data && decryptData(sessionKey, data))
					.catch(() => null),
				fetchFromArweave(conv.conversationMetadataCID)
					.then(data => data && decryptData(sessionKey, data))
					.catch(() => null),
			]);

			const messageHydrationPromises = conv.messages.map(async msg => {
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

				return {
					message: messageData ? { ...messageData, id: msg.id } : null,
					searchDelta: searchDeltaData,
				};
			});

			const messageResults = await Promise.all(messageHydrationPromises);

			return {
				conversation: convData ? { ...convData, ...metadataData, id: conv.id } : null,
				messages: messageResults.map(r => r.message).filter(Boolean),
				searchDeltas: messageResults.map(r => r.searchDelta).filter(Boolean),
			};
		});

		const hydratedData = (await Promise.all(hydrationPromises)).filter(item => item.conversation);

		// 3. Prepare data for bulk insertion into IndexedDB using parallel encryption
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

		// 4. Execute bulk database operations
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

		// 6. If successful, update the last synced timestamp
		await setLastSyncedAt(sessionKey, ownerAddress, syncStartTime);
		console.log('[syncService] Remote sync process completed successfully.');
	} catch (error) {
		console.error('[syncService] Failed to sync with remote sources:', error);
	}
};

export default syncWithRemote;
