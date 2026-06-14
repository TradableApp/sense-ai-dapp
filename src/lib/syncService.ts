/**
 * @file syncService.js
 * @notice This service is the bridge between the decentralized backend (The Graph, Arweave/Autonomys)
 *         and the client-side IndexedDB cache. It is designed to be the primary mechanism
 *         for keeping the user's local data consistent with on-chain and decentralized storage state.
 * @dev The core workflow is to periodically fetch a list of updated entities from The Graph,
 *      "hydrate" this list by fetching the actual content from decentralized storage (Arweave or Autonomys),
 *      decrypting it, and then performing a bulk update to the local IndexedDB. This provides a fast, offline-first experience.
 */

import { GraphQLClient } from 'graphql-request';
import { hexToBytes } from 'viem';

import { decryptData, encryptData } from './crypto';
import db from './db';
import { GET_USER_UPDATES_QUERY } from './graph/queries';
import type { GetUserUpdatesQuery, GetUserUpdatesQueryVariables } from './graph/query-types';
import mergeMessages from './mergeMessages';
import { mergeSearchIndexDeltas } from './searchService';
import type { Message } from './types';

// The Graph endpoint is configured via environment variables for flexibility between environments.
const THE_GRAPH_API_URL = import.meta.env.VITE_THE_GRAPH_API_URL;
const graphQLClient = new GraphQLClient(THE_GRAPH_API_URL);

// Localnet only: when set, answer content lives in the local IPFS node (the e2e
// stack's Kubo) and is fetched by CID from this gateway base, instead of the
// public Autonomys/Irys gateways. Unset on testnet/mainnet — those paths are
// unchanged. See sense-ai-e2e/scripts/sync-config.sh. Normalised to a trailing
// slash so `${base}${cid}` is well-formed even if configured without one.
const RAW_STORAGE_GATEWAY_URL = import.meta.env.VITE_STORAGE_GATEWAY_URL;
const STORAGE_GATEWAY_URL =
	RAW_STORAGE_GATEWAY_URL && !RAW_STORAGE_GATEWAY_URL.endsWith('/')
		? `${RAW_STORAGE_GATEWAY_URL}/`
		: RAW_STORAGE_GATEWAY_URL;

// --- Internal Helper Functions ---

/**
 * Determines the storage provider based on the CID format.
 * This acts as a router to support multiple storage backends.
 * @param {string} cid The Content ID.
 * @returns {object} The appropriate storage utility module.
 */
function getStorageProvider(cid: string): 'ipfs' | 'autonomys' | 'arweave' {
	// ORDERING CONTRACT: the specific Autonomys/Arweave checks MUST come before the
	// broad IPFS catch-all — its CIDs (`bafkr6i…`, all base32) are a subset of the
	// IPFS pattern, so checking IPFS first would shadow them (route to the localnet
	// gateway → 404). Any new CID scheme added here goes BEFORE the IPFS branch.
	// Mirrors the oracle's getProviderFromCID (tokenized-ai-agent storage.js).
	//
	// Autonomys Auto Drive CID validation — CIDv1 base32, 'bafkr6i' prefix, a-z2-7.
	if (cid && /^bafkr6i[a-z2-7]{52}$/.test(cid)) {
		return 'autonomys';
	}

	// Localnet only: a configured gateway means content lives in the local IPFS
	// node. Our localnet CIDs are IPFS CIDv1 (base32, `bafy…`/`bafk…`); route them
	// to the gateway. Gated on STORAGE_GATEWAY_URL so testnet/mainnet are untouched
	// (there this branch never runs and Autonomys/Arweave detection is unchanged).
	if (STORAGE_GATEWAY_URL && cid && /^baf[ky][a-z2-7]{20,}$/.test(cid)) {
		return 'ipfs';
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
async function fetchFromStorage(cid: string): Promise<string | null> {
	if (!cid) return null;

	const provider = getStorageProvider(cid);

	let url;
	if (provider === 'ipfs') {
		// STORAGE_GATEWAY_URL is the localnet gateway base (normalised to end in `/`).
		url = `${STORAGE_GATEWAY_URL}${cid}`;
	} else if (provider === 'autonomys') {
		// Use the Autonomys Astral Gateway (or standard IPFS gateway if bridged)
		// const envNetwork = import.meta.env.VITE_AUTONOMYS_NETWORK || 'testnet';

		// For now just using mainnet
		// const subDomain = 'mainnet';
		// const subDomain = envNetwork === 'mainnet' ? envNetwork : 'taurus';

		url = `https://gateway.autonomys.xyz/file/${cid}`;
	} else {
		url = `https://gateway.irys.xyz/${cid}`;
	}

	try {
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
 * @notice Removes orphaned, content-less assistant placeholders whose prompt was
 *         cancelled/refunded.
 * @dev When a prompt is cancelled the answer is never delivered, but the optimistic
 *      answer placeholder (keyed by answerMessageId) lingers content-less and would keep
 *      the chat stuck "Thinking…" (isAiThinking) after the cancelled prompt re-hydrates
 *      from sync. The placeholder's id equals the PromptRequest id (= answerMessageId),
 *      so we drop exactly those. Only content-less assistants are dropped — a delivered
 *      answer is never removed.
 * @returns {T[]} The messages with the cancelled placeholders removed.
 */
export function dropCancelledAnswerPlaceholders<
	T extends { id?: string | number; role?: string; content?: unknown },
>(messages: T[], cancelledAnswerIds: Set<string>): T[] {
	if (cancelledAnswerIds.size === 0) return messages;
	return messages.filter(
		m =>
			!(
				m.role === 'assistant' &&
				(m.content === null || m.content === undefined) &&
				cancelledAnswerIds.has(String(m.id))
			),
	);
}

/**
 * @notice Whether the locally-cached thread for a conversation still holds a content-less
 *         ("Thinking…") assistant message that isn't cancelled/refunded.
 * @dev Used to override the conversation-level hydration skip below. An earlier sync can
 *      commit a conversation record's new CIDs/lastMessageCreatedAt before a (follow-up)
 *      answer's content is retrievable from storage — leaving its message a permanent
 *      placeholder. The conv-level CID check alone would then match forever and never
 *      re-hydrate it. While such a placeholder exists locally we must keep hydrating.
 *      Mirrors `hasPendingAnswer` in useLiveResponse so both layers agree on "pending".
 * @returns {Promise<boolean>} True if a pending assistant placeholder is cached locally.
 */
async function conversationHasPendingMessage(
	sessionKey: CryptoKey,
	ownerAddress: string,
	conversationId: string,
): Promise<boolean> {
	try {
		const record = await db.messageCache.get([ownerAddress, conversationId]);
		if (!record) return false;
		const messages = await decryptData(sessionKey, record.encryptedData);
		if (!Array.isArray(messages)) return false;
		return (messages as Array<{ role?: string; content?: unknown; status?: string }>).some(
			m =>
				m.role === 'assistant' &&
				(m.content === null || m.content === undefined) &&
				m.status !== 'cancelled' &&
				m.status !== 'refunded',
		);
	} catch {
		// An unreadable cache must NOT take the conversation-level skip — that path
		// returns before the merge step, so a corrupt entry would be stranded forever.
		// Force re-hydration instead: the hydration path's own merge catch overwrites
		// the corrupt cache, so this self-heals after a single round rather than
		// perpetually re-fetching.
		return true;
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
async function getLastSyncedAt(sessionKey: CryptoKey, ownerAddress: string): Promise<number> {
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
async function setLastSyncedAt(
	sessionKey: CryptoKey,
	ownerAddress: string,
	timestamp: number,
): Promise<void> {
	if (!sessionKey || !ownerAddress) return;
	let metadata: Record<string, number> = { searchLastSyncedAt: 0, conversationsLastSyncedAt: 0 };
	const existingRecord = await db.userMetadata.get(ownerAddress);
	if (existingRecord) {
		try {
			const decrypted = await decryptData(sessionKey, existingRecord.encryptedData);
			if (typeof decrypted === 'object' && decrypted !== null) {
				metadata = decrypted as Record<string, number>;
			}
		} catch (error) {
			console.error('[syncService] Could not decrypt existing metadata to update it.', error);
		}
	}
	metadata.conversationsLastSyncedAt = timestamp;
	// encryptData JSON-stringifies internally — pass the object directly. Pre-
	// stringifying double-encodes it, so getLastSyncedAt() decrypts to a string,
	// reads `undefined`, and returns 0 → every sync becomes a full re-sync.
	const encryptedMetadata = await encryptData(sessionKey, metadata);
	await db.userMetadata.put({ ownerAddress, encryptedData: encryptedMetadata });
}

interface ConversationUpdate {
	id: string;
	conversationCID: string;
	conversationMetadataCID: string;
	lastMessageCreatedAt: number;
	messages: Array<{
		id: string;
		messageCID: string;
		createdAt: number;
		searchDelta?: { searchDeltaCID: string };
	}>;
	promptRequests: Array<{
		id: string; // = answerMessageId (matches the optimistic answer placeholder's id)
		promptMessageId: string;
		createdAt: number;
		isCancelled?: boolean;
		isRefunded?: boolean;
		encryptedPayload: string;
	}>;
}

/**
 * @notice Fetches a list of updated conversation entities from The Graph's API.
 * @dev This is the entry point for the sync process. It queries for all conversations
 *      owned by the user that have been updated since the last sync.
 * @param {string} ownerAddress The user's wallet address.
 * @param {number} lastSync The timestamp of the last successful sync (Milliseconds).
 * @returns {Promise<Array>} A promise that resolves to a list of conversation entities from The Graph.
 */
async function fetchUpdatesFromTheGraph(
	ownerAddress: string,
	lastSync: number,
): Promise<ConversationUpdate[]> {
	if (!THE_GRAPH_API_URL) {
		console.warn('[syncService] VITE_THE_GRAPH_API_URL is not set. Skipping remote sync.');
		return [];
	}
	try {
		// The Graph stores block timestamps in Seconds. We must convert our local MS timestamp.
		const lastSyncSeconds = Math.floor(lastSync / 1000);

		// The query variables are passed to the GraphQL client.
		const variables: GetUserUpdatesQueryVariables = {
			owner: ownerAddress.toLowerCase(),
			lastSync: lastSyncSeconds.toString(), // Send SECONDS
			limit: 250,
			offset: 0,
		};

		const data = await graphQLClient.request<GetUserUpdatesQuery>(
			GET_USER_UPDATES_QUERY,
			variables,
		);

		// Convert BigInt strings from The Graph response into Numbers (MS) for frontend consistency.
		const conversations = (data.conversations || []).map((conv: unknown) => {
			const convObj = conv as Record<string, unknown>;
			return {
				...(convObj as unknown as ConversationUpdate),
				lastMessageCreatedAt: Number(convObj.lastMessageCreatedAt as string | number) * 1000,
				messages: ((convObj.messages as Array<Record<string, unknown>>) || []).map(
					(msg: Record<string, unknown>) => ({
						...msg,
						createdAt: Number(msg.createdAt as string | number) * 1000,
					}),
				),
				promptRequests: ((convObj.promptRequests as Array<Record<string, unknown>>) || []).map(
					(req: Record<string, unknown>) => ({
						...req,
						createdAt: Number(req.createdAt as string | number) * 1000,
					}),
				),
			};
		}) as ConversationUpdate[];

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
export default async function syncWithRemote(
	sessionKey: CryptoKey,
	ownerAddress: string,
): Promise<void> {
	// Guard against running without a valid session.
	if (!sessionKey || !ownerAddress) return;

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
			await setLastSyncedAt(sessionKey, ownerAddress, newLastSync);
			return;
		}

		// 3. "Hydrate" the Graph data by fetching and decrypting all associated CIDs from Arweave in parallel.
		const hydrationPromises = graphUpdates.map(async (conv: ConversationUpdate) => {
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
						localConv.lastMessageCreatedAt === conv.lastMessageCreatedAt &&
						// …and only honour the skip once the local message cache has actually
						// caught up. A follow-up answer can still be a content-less placeholder
						// even when the conv-level CIDs match (see conversationHasPendingMessage),
						// in which case we must re-hydrate rather than strand it on "Thinking…".
						!(await conversationHasPendingMessage(sessionKey, ownerAddress, conv.id))
					) {
						// Data is identical and fully hydrated. Skip to save bandwidth and processing.
						return {
							conversation: null,
							messages: [],
							searchDeltas: [],
							cancelledAnswerIds: new Set<string>(),
						};
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

			const messageHydrationPromises = (conv.messages || []).map(
				async (msg: ConversationUpdate['messages'][number]) => {
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
				},
			);

			const messageResults = await Promise.all(messageHydrationPromises);

			// --- Process Cancelled/Refunded/Pending Prompt Requests ---
			// These don't have storage CIDs, so we decrypt the on-chain payload directly.
			const promptRequestPromises = (conv.promptRequests || []).map(
				async (req: ConversationUpdate['promptRequests'][number]) => {
					try {
						// Convert Hex (0x...) to UTF-8 String to recover "iv.encryptedData" format
						const encryptedString = new TextDecoder().decode(
							hexToBytes(req.encryptedPayload as `0x${string}`),
						);
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
				},
			);

			const requestResults = await Promise.all(promptRequestPromises);
			const validRequests = requestResults.filter(Boolean) as Record<string, unknown>[];
			const validMessages = messageResults
				.map((r: { message: unknown }) => r.message)
				.filter(Boolean) as unknown[];

			// Merge normal messages with recovered prompt requests
			const allMessages = [...validMessages, ...validRequests];

			// answerMessageIds of cancelled/refunded prompts: their optimistic answer
			// placeholder never receives content, so it must be dropped from the cache (see
			// dropCancelledAnswerPlaceholders) — otherwise the chat stays stuck "Thinking…".
			const cancelledAnswerIds = new Set(
				(conv.promptRequests || [])
					.filter(req => req.isCancelled || req.isRefunded)
					.map(req => req.id),
			);

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
					// Returning null conversation prevents the overwrite in the next step
					return {
						conversation: null,
						messages: allMessages,
						searchDeltas: [],
						cancelledAnswerIds,
					};
				}
			}

			// Return a single, fully hydrated object for the conversation.
			return {
				conversation: remoteConversation,
				messages: allMessages,
				cancelledAnswerIds,
				searchDeltas: messageResults
					.map((r: { searchDelta: unknown }) => r.searchDelta)
					.filter(Boolean) as unknown[],
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
					: ((item.messages[0] as Record<string, unknown>)?.conversationId as string) || '';

				// Instead of overwriting, we fetch existing messages and merge them.
				// This preserves history when The Graph only returns the newest messages (e.g. after branching).
				let finalMessages = item.messages;

				try {
					const existingRecord = await db.messageCache.get([ownerAddress, conversationId]);

					if (existingRecord) {
						const existingMessages = await decryptData(sessionKey, existingRecord.encryptedData);

						// Merge by id, keyed so The Graph is authority for status/metadata —
						// but an un-hydrated (content-less) incoming message must NOT clobber
						// content we already delivered. See mergeMessages. A corrupt cache that
						// decrypts to a non-array is treated as empty, so the result is still
						// sorted/deduped (previously the non-array path left messages unsorted).
						//
						// item.messages is the post-hydration `allMessages` (decrypted
						// MessageFiles + prompt requests) — both carry id/content/createdAt, so
						// the Message shape holds at runtime; the cast only bridges its loose
						// `unknown[]` upstream typing. mergeMessages keys content off `content`,
						// which is present on both.
						finalMessages = mergeMessages(
							Array.isArray(existingMessages) ? (existingMessages as Message[]) : [],
							item.messages as unknown as Message[],
						);
					}
				} catch (err) {
					console.warn(
						`[syncService] Error merging messages for conv ${conversationId}, overwriting cache:`,
						err,
					);
				}

				// Drop the orphaned content-less answer placeholders of cancelled/refunded
				// prompts so the chat doesn't stay stuck "Thinking…" after a cancel.
				finalMessages = dropCancelledAnswerPlaceholders(
					finalMessages as unknown as Array<{
						id?: string | number;
						role?: string;
						content?: unknown;
					}>,
					item.cancelledAnswerIds,
				) as typeof finalMessages;

				// encryptData JSON-stringifies internally, so pass the array directly —
				// pre-stringifying here double-encodes it, and getMessages() then decrypts
				// to a string and crashes on `.sort` (matches dataService's usage).
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
		}
		if (messagesToCache.length > 0) {
			await db.messageCache.bulkPut(messagesToCache);
		}

		// 5. Merge search index deltas
		if (allSearchDeltas.length > 0) {
			await mergeSearchIndexDeltas(sessionKey, ownerAddress, allSearchDeltas);
		}

		// 6. Only update the 'last synced' timestamp after all operations succeed.
		// If any step above fails, this line won't be reached, and the next sync will re-process the failed items.
		await setLastSyncedAt(sessionKey, ownerAddress, newLastSync);
	} catch (error) {
		console.error('[syncService] A critical error occurred during the sync process:', error);
		// We do not update the timestamp on failure, ensuring the process will be retried.
	}
}
