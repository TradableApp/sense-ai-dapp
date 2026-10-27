/**
 * @file syncService.js
 * @notice This service is the bridge between the decentralized backend (The Graph, Arweave/Autonomys)
 *         and the client-side IndexedDB cache. It is designed to be the primary mechanism
 *         for keeping the user's local data consistent with on-chain and decentralized storage state.
 * @dev The core workflow is to periodically fetch a list of updated entities from The Graph,
 *      "hydrate" this list by fetching the actual content by CID (our GCS mirror first, then the
 *      Autonomys/Irys gateway — see payloadStorage.ts), decrypting it, and then performing a bulk
 *      update to the local IndexedDB. This provides a fast, offline-first experience.
 */

import * as Sentry from '@sentry/react';
import { GraphQLClient } from 'graphql-request';
import { hexToBytes } from 'viem';

import { decryptData, encryptData } from './crypto';
import db from './db';
import { GET_USER_UPDATES_QUERY } from './graph/queries';
import type { GetUserUpdatesQuery, GetUserUpdatesQueryVariables } from './graph/query-types';
import mergeMessages from './mergeMessages';
import { fetchPayload, type PayloadFetchDeps, type PayloadStorageConfig } from './payloadStorage';
import { mergeSearchIndexDeltas } from './searchService';
import type { Message } from './types';

// The Graph endpoint is configured via environment variables for flexibility between environments.
const THE_GRAPH_API_URL = import.meta.env.VITE_THE_GRAPH_API_URL;
const graphQLClient = new GraphQLClient(THE_GRAPH_API_URL);

// Where payload bytes come from — see payloadStorage.ts for the source order and
// retry policy. VITE_PAYLOAD_MIRROR_URL is the public GCS mirror the oracle writes
// every Autonomys CID through to (unset on localnet). VITE_STORAGE_GATEWAY_URL is
// localnet only: the e2e stack's Kubo gateway (see sense-ai-e2e/scripts/sync-config.sh).
// Read per call rather than at module load: Vite inlines these at build time so there is
// no runtime cost, and tests that stub the env see the change without reloading the module.
const getPayloadStorageConfig = (): PayloadStorageConfig => ({
	mirrorUrl: import.meta.env.VITE_PAYLOAD_MIRROR_URL,
	storageGatewayUrl: import.meta.env.VITE_STORAGE_GATEWAY_URL,
});

/**
 * Per-attempt ceiling on a payload fetch. Without it a connection that opens but stalls
 * holds a hydration promise for the OS TCP timeout, times every retry; with it a stall
 * is just another retriable network failure.
 */
const PAYLOAD_FETCH_TIMEOUT_MS = 10_000;

const payloadFetchDeps: PayloadFetchDeps = {
	// Late-bound so the active global fetch is used, not the one at module load.
	// `AbortSignal.timeout()` only arrived in Safari 17.4, so the timeout is an
	// AbortController whose timer covers headers AND body and is released in a `finally`.
	// The body is read eagerly: payloads are small ciphertext strings, and reading them here
	// means no timer can outlive the request whatever a caller does with the result.
	fetch: async url => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), PAYLOAD_FETCH_TIMEOUT_MS);
		try {
			const response = await fetch(url, { signal: controller.signal });
			// Always drain the body, also on errors: an unread stream pins the connection
			// until GC, and error bodies from GCS and the gateway are tiny.
			const text = await response.text();
			const body = response.ok ? text : '';
			return { ok: response.ok, status: response.status, text: async () => body };
		} finally {
			clearTimeout(timer);
		}
	},
	report: (message, data) =>
		Sentry.addBreadcrumb({ category: 'storage.fetch', level: 'warning', message, data }),
	wait: ms =>
		new Promise(resolve => {
			setTimeout(resolve, ms);
		}),
	random: Math.random,
};

/** Result of a sync pass; the UI uses the count to show the "history unavailable" state. */
export interface SyncResult {
	/** Payloads no storage source could serve this pass (transient — retried next pass). */
	readonly unavailablePayloads: number;
}

// Returned by reference from several early exits, so it must be immune to mutation.
const NOTHING_UNAVAILABLE: SyncResult = Object.freeze({ unavailablePayloads: 0 });

/** A decrypted storage file: an object of unknown shape, as stored by the oracle. */
type StoredRecord = Record<string, unknown>;

interface HydratedPayload {
	value: unknown | null;
	/** True only for a transient storage failure, never for a missing or undecryptable payload. */
	unavailable: boolean;
}

// Returned by reference from two early exits, so frozen like NOTHING_UNAVAILABLE.
const EMPTY_PAYLOAD: HydratedPayload = Object.freeze({ value: null, unavailable: false });

// --- Internal Helper Functions ---

/**
 * @notice Fetches and decrypts a single encrypted payload from storage.
 * @dev Never throws: a payload that cannot be fetched or decrypted resolves to a null
 *      value so one failure cannot take the whole sync down. The `unavailable` flag is
 *      what distinguishes "the storage providers are down" (surfaced to the user and
 *      retried next pass) from "this CID has nothing for us" (dropped quietly).
 */
async function hydratePayload(
	cid: string | undefined,
	sessionKey: CryptoKey,
): Promise<HydratedPayload> {
	if (!cid) return EMPTY_PAYLOAD;

	const result = await fetchPayload(cid, getPayloadStorageConfig(), payloadFetchDeps);
	if (!result.ok) return { value: null, unavailable: result.reason === 'unavailable' };

	try {
		return { value: await decryptData(sessionKey, result.data), unavailable: false };
	} catch (error) {
		console.warn(`[syncService] Could not decrypt payload ${cid}; skipping it.`, error);
		return EMPTY_PAYLOAD;
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
): Promise<SyncResult> {
	// Guard against running without a valid session.
	if (!sessionKey || !ownerAddress) return NOTHING_UNAVAILABLE;

	// Declared outside the try so a failure after hydration (e.g. a bulkPut) still reports
	// what hydration found — returning 0 there would clear the "unavailable" banner while
	// storage is in fact down.
	let unavailablePayloads = 0;

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
			return NOTHING_UNAVAILABLE;
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
							unavailablePayloads: 0,
						};
					}
				} catch (e) {
					// Decryption failed, proceed with fresh hydration
				}
			}

			// For each conversation, fetch its core data, metadata, and all its messages in parallel.
			const [convPayload, metadataPayload] = await Promise.all([
				hydratePayload(conv.conversationCID, sessionKey),
				hydratePayload(conv.conversationMetadataCID, sessionKey),
			]);
			const convData = convPayload.value as StoredRecord | null;
			const metadataData = metadataPayload.value as StoredRecord | null;

			const messageHydrationPromises = (conv.messages || []).map(
				async (msg: ConversationUpdate['messages'][number]) => {
					const [messagePayload, searchDeltaPayload] = await Promise.all([
						hydratePayload(msg.messageCID, sessionKey),
						hydratePayload(msg.searchDelta?.searchDeltaCID, sessionKey),
					]);
					const messageData = messagePayload.value as StoredRecord | null;
					// Return a structured object for clarity, associating the message with its search delta.
					return {
						message: messageData
							? {
									...messageData,
									id: msg.id,
									messageCID: msg.messageCID,
							  }
							: null,
						searchDelta: searchDeltaPayload.value,
						unavailablePayloads:
							Number(messagePayload.unavailable) + Number(searchDeltaPayload.unavailable),
					};
				},
			);

			const messageResults = await Promise.all(messageHydrationPromises);

			const convUnavailablePayloads =
				Number(convPayload.unavailable) +
				Number(metadataPayload.unavailable) +
				messageResults.reduce((sum, r) => sum + r.unavailablePayloads, 0);

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
			const remoteConversation: (StoredRecord & { id: string }) | null = convData
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
				if (localConv.lastUpdatedAt > Number(remoteConversation.lastUpdatedAt)) {
					// Returning null conversation prevents the overwrite in the next step
					return {
						conversation: null,
						messages: allMessages,
						searchDeltas: [],
						cancelledAnswerIds,
						unavailablePayloads: convUnavailablePayloads,
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
				unavailablePayloads: convUnavailablePayloads,
			};
		});

		const hydratedData = await Promise.all(hydrationPromises);
		unavailablePayloads = hydratedData.reduce((sum, item) => sum + item.unavailablePayloads, 0);
		if (unavailablePayloads > 0) {
			// One line per pass, not one per CID: the per-attempt detail is in the Sentry
			// breadcrumbs that payloadStorage leaves.
			console.warn(
				`[syncService] ${unavailablePayloads} payload(s) unavailable from every storage source; will retry next sync.`,
			);
			// Breadcrumbs only surface attached to a later error; this makes the outage an
			// issue of its own that can alert. One fingerprint so every pass groups together.
			Sentry.captureMessage('payload storage degraded: sync cursor held', {
				level: 'warning',
				fingerprint: ['payload-storage-degraded'],
				extra: { unavailablePayloads },
			});
		}

		// 4. Prepare all fetched data for bulk insertion into IndexedDB.
		const allSearchDeltas = hydratedData.flatMap(item => item.searchDeltas);

		const conversationCachePromises = hydratedData
			// Only cache if we got a valid (non-skipped) conversation
			.flatMap(item => (item.conversation ? [item.conversation] : []))
			.map(async conversation => {
				const encryptedConv = await encryptData(sessionKey, conversation);
				return { ownerAddress, id: conversation.id, encryptedData: encryptedConv };
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

		// 6. Only advance the 'last synced' cursor when every payload was served. The Graph
		// only returns conversations newer than the cursor, so advancing past one whose
		// payloads a storage outage withheld would strand it until a full re-sync. Holding
		// the cursor costs one re-query per pass; the already-hydrated conversations take the
		// CID-match skip above.
		//
		// Deliberately no cap on how long the hold lasts. A cap would convert the one case it
		// targets (mirror persistently 5xx AND gateway 404 for the same CID) from a loud,
		// self-healing outage — banner shown, a Sentry breadcrumb every pass, fixed by
		// repairing the mirror or unsetting VITE_PAYLOAD_MIRROR_URL — into silent data loss
		// whenever that 404 was a fresh upload the gateway had not propagated yet.
		if (unavailablePayloads === 0) {
			await setLastSyncedAt(sessionKey, ownerAddress, newLastSync);
		}
		return { unavailablePayloads };
	} catch (error) {
		console.error('[syncService] A critical error occurred during the sync process:', error);
		// We do not update the timestamp on failure, ensuring the process will be retried.
		return { unavailablePayloads };
	}
}
