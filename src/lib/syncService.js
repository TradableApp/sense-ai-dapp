/**
 * @file syncService.js
 * @notice This service is the bridge between the decentralized backend (The Graph, Arweave/Autonomys)
 *         and the client-side IndexedDB cache. It is designed to be the primary mechanism
 *         for keeping the user's local data consistent with on-chain and decentralized storage state.
 * @dev The core workflow is to periodically fetch a list of updated entities from The Graph,
 *      "hydrate" this list by fetching the actual content from decentralized storage (Arweave or Autonomys),
 *      decrypting it, and then performing a bulk update to the local IndexedDB. This provides a fast, offline-first experience.
 */

import { ethers } from 'ethers';
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
 * Determines the storage provider based on the CID format.
 * This acts as a router to support multiple storage backends.
 * @param {string} cid The Content ID.
 * @returns {object} The appropriate storage utility module.
 */
function getStorageProvider(cid) {
	// Autonomys Auto Drive CID validation
	// Format: CIDv1 with base32 encoding
	// Starts with 'bafkr6i' (base32 prefix + CIDv1 identifier)
	// Uses base32 character set: a-z, 2-7
	if (cid && /^bafkr6i[a-z2-7]{52}$/.test(cid)) {
		return 'autonomys';
	}

	// Heuristic for Arweave/Irys: Base64URL (check second - less specific)
	// Standard Arweave is 43 chars, but Irys can sometimes return 44 chars.
	// We check for a valid range and character set.
	if (cid && cid.length >= 43 && cid.length <= 44 && /^[a-zA-Z0-9_-]+$/.test(cid)) {
		return 'arweave';
	}

	throw new Error(`Unsupported CID format: ${cid}`);
}

/**
 * @notice Fetches a single encrypted payload from decentralized storage (Autonomys or Arweave).
 * @param {string} cid The Content ID of the file.
 * @returns {Promise<string|null>} A promise resolving to the encrypted data as a string, or null on failure.
 */
async function fetchFromStorage(cid) {
	if (!cid) return null;

	const provider = getStorageProvider(cid);

	let url;
	if (provider === 'autonomys') {
		// Use the Autonomys Astral Gateway (or standard IPFS gateway if bridged)
		// const envNetwork = import.meta.env.VITE_AUTONOMYS_NETWORK || 'testnet';

		// For now just using mainnet
		// const subDomain = 'mainnet';
		// const subDomain = envNetwork === 'mainnet' ? envNetwork : 'taurus';

		url = `https://gateway.autonomys.xyz/file/${cid}`;
	} else {
		url = `https://gateway.irys.xyz/${cid}`;
	}
	console.log('provider', provider, 'url', url);

	try {
		console.log(`[syncService] Fetching from ${provider}: ${cid}`);

		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`Storage gateway returned status ${response.status} for CID ${cid}`);
		}
		return response.text();
	} catch (error) {
		console.error(`[syncService] Failed to fetch CID ${cid} from ${provider}:`, error);
		return null; // Return null to prevent a single failed fetch from crashing the entire sync.
	}
}

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
		console.log('[syncService] Raw Graph Data:', data.conversations);

		// Convert BigInt strings from The Graph response into Numbers (MS) for frontend consistency.
		const conversations = (data.conversations || []).map(conv => ({
			...conv,
			lastMessageCreatedAt: Number(conv.lastMessageCreatedAt) * 1000,
			messages: conv.messages.map(msg => ({
				...msg,
				createdAt: Number(msg.createdAt) * 1000,
			})),
			promptRequests: conv.promptRequests.map(req => ({
				...req,
				createdAt: Number(req.createdAt) * 1000,
			})),
		}));

		return conversations;
	} catch (error) {
		console.error('[syncService] Failed to fetch updates from The Graph:', error);
		return []; // Return an empty array to allow the app to continue functioning.
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
			`[syncService] Found ${graphUpdates.length} potentially updated conversation(s) from The Graph.`,
		);

		// 3. "Hydrate" the Graph data by fetching and decrypting all associated CIDs from Arweave in parallel.
		const hydrationPromises = graphUpdates.map(async conv => {
			// Before downloading from Arweave, check if we already have these specific CIDs stored locally.
			const localRecord = await db.conversations.get([ownerAddress, conv.id]);

			let localConv = null;
			if (localRecord) {
				try {
					localConv = await decryptData(sessionKey, localRecord.encryptedData);
					if (
						localConv.conversationCID === conv.conversationCID &&
						localConv.conversationMetadataCID === conv.conversationMetadataCID &&
						// We also check timestamps to ensure we don't skip if the message list changed
						localConv.lastMessageCreatedAt === conv.lastMessageCreatedAt
					) {
						// Data is identical. Skip hydration to save bandwidth and processing.
						return { conversation: null, messages: [], searchDeltas: [] };
					}
				} catch (e) {
					// Decryption failed, proceed with fresh hydration
				}
			}

			// For each conversation, fetch its core data, metadata, and all its messages in parallel.
			const [convData, metadataData] = await Promise.all([
				fetchFromStorage(conv.conversationCID)
					.then(data => data && decryptData(sessionKey, data))
					.catch(() => null),
				fetchFromStorage(conv.conversationMetadataCID)
					.then(data => data && decryptData(sessionKey, data))
					.catch(() => null),
			]);

			const messageHydrationPromises = (conv.messages || []).map(async msg => {
				const [messageData, searchDeltaData] = await Promise.all([
					fetchFromStorage(msg.messageCID)
						.then(data => data && decryptData(sessionKey, data))
						.catch(() => null),
					msg.searchDelta
						? fetchFromStorage(msg.searchDelta.searchDeltaCID)
								.then(data => data && decryptData(sessionKey, data))
								.catch(() => null)
						: Promise.resolve(null),
				]);
				// Return a structured object for clarity, associating the message with its search delta.
				return {
					message: messageData
						? {
								...messageData,
								id: msg.id,
								messageCID: msg.messageCID,
						  }
						: null,
					searchDelta: searchDeltaData,
				};
			});

			const messageResults = await Promise.all(messageHydrationPromises);

			// --- Process Cancelled/Refunded/Pending Prompt Requests ---
			// These don't have storage CIDs, so we decrypt the on-chain payload directly.
			const promptRequestPromises = (conv.promptRequests || []).map(async req => {
				try {
					// Convert Hex (0x...) to UTF-8 String to recover "iv.encryptedData" format
					const encryptedString = ethers.toUtf8String(req.encryptedPayload);
					const payload = await decryptData(sessionKey, encryptedString);

					// payload is { promptText: "...", ... }
					let status = 'pending';
					if (req.isCancelled) status = 'cancelled';
					if (req.isRefunded) status = 'refunded';

					return {
						id: req.promptMessageId.toString(), // Use the prompt ID, not answer ID
						conversationId: conv.id,
						parentId: payload.previousMessageId || null,
						role: 'user',
						content: payload.promptText,
						createdAt: req.createdAt,
						status, // This flag allows the UI to style them differently
					};
				} catch (err) {
					console.warn(
						`[syncService] Failed to decrypt prompt request ${req.promptMessageId}:`,
						err,
					);
					return null;
				}
			});

			const requestResults = await Promise.all(promptRequestPromises);
			const validRequests = requestResults.filter(Boolean);
			const validMessages = messageResults.map(r => r.message).filter(Boolean);

			// Merge normal messages with recovered prompt requests
			const allMessages = [...validMessages, ...validRequests];

			// Construct the Remote Conversation Object
			const remoteConversation = convData
				? {
						...convData,
						...metadataData,
						id: conv.id,
						// Inject the timestamp from The Graph (converted to MS) because
						// the Arweave metadata file usually lacks this sortable field.
						lastMessageCreatedAt: conv.lastMessageCreatedAt,
						// Important: Store the CIDs in the encrypted payload so the optimization check works next time
						conversationCID: conv.conversationCID,
						conversationMetadataCID: conv.conversationMetadataCID,
				  }
				: null;

			// If we have a local record with a NEWER timestamp (Optimistic Update),
			// DO NOT return the remote conversation. Keep the local one to prevent UI jitter/reversion.
			if (remoteConversation && localConv) {
				if (localConv.lastUpdatedAt > remoteConversation.lastUpdatedAt) {
					console.log(
						`[syncService] Preserving local optimistic update for conv ${conv.id}. Local: ${localConv.lastUpdatedAt} > Remote: ${remoteConversation.lastUpdatedAt}`,
					);
					// Returning null conversation prevents the overwrite in the next step
					return { conversation: null, messages: allMessages, searchDeltas: [] };
				}
			}

			// Return a single, fully hydrated object for the conversation.
			return {
				conversation: remoteConversation,
				messages: allMessages,
				searchDeltas: messageResults.map(r => r.searchDelta).filter(Boolean),
			};
		});

		const hydratedData = await Promise.all(hydrationPromises);

		// 4. Prepare all fetched data for bulk insertion into IndexedDB.
		const allSearchDeltas = hydratedData.flatMap(item => item.searchDeltas);

		const conversationCachePromises = hydratedData
			.filter(item => item.conversation) // Only cache if we got a valid (non-skipped) conversation
			.map(async item => {
				const encryptedConv = await encryptData(sessionKey, item.conversation);
				return { ownerAddress, id: item.conversation.id, encryptedData: encryptedConv };
			});

		const messageCachePromises = hydratedData
			.filter(item => item.messages.length > 0)
			.map(async item => {
				// We need to ensure we have a valid conversationId for the cache key.
				// If the metadata update was skipped, we grab the ID from the first message.
				const conversationId = item.conversation
					? item.conversation.id
					: item.messages[0].conversationId;

				// Instead of overwriting, we fetch existing messages and merge them.
				// This preserves history when The Graph only returns the newest messages (e.g. after branching).
				let finalMessages = item.messages;

				try {
					const existingRecord = await db.messageCache.get([ownerAddress, conversationId]);

					if (existingRecord) {
						const existingMessages = await decryptData(sessionKey, existingRecord.encryptedData);

						// Create a Map by ID to deduplicate
						const msgMap = new Map();

						// 1. Add existing messages
						if (Array.isArray(existingMessages)) {
							existingMessages.forEach(m => msgMap.set(m.id, m));
						}

						// 2. Add/Overwrite with new messages from Graph
						// We use the new messages as authority for the same IDs (updates status, content etc)
						item.messages.forEach(m => msgMap.set(m.id, m));

						// 3. Convert back to array and sort by creation time
						finalMessages = Array.from(msgMap.values()).sort((a, b) => a.createdAt - b.createdAt);
					}
				} catch (err) {
					console.warn(
						`[syncService] Error merging messages for conv ${conversationId}, overwriting cache:`,
						err,
					);
				}

				const encryptedMessages = await encryptData(sessionKey, finalMessages);

				return {
					ownerAddress,
					conversationId,
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
