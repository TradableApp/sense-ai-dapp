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

import GraphFetchFailed from '@/lib/graph/GraphFetchFailed';
import { reportGraphFetchFailed, reportGraphTimeAhead } from '@/lib/graph/graphSyncReport';
import { cursorFrom, isAheadOfClock, usableCursor } from '@/lib/graph/syncCursor';
import fetchAllUserUpdates, { type GraphRequest } from '@/lib/graph/userUpdates';
import createLimiter from '@/lib/limitConcurrency';

import { decryptData, encryptData } from './crypto';
import db from './db';
import mergeMessages from './mergeMessages';
import { writeMessageCache } from './messageCacheStore';
import { fetchPayload, type PayloadFetchDeps, type PayloadStorageConfig } from './payloadStorage';
import { withCheckedAnswerAttempt } from './reasoningAttempts';
import { mergeSearchIndexDeltas } from './searchService';
import {
	conversationFileFits,
	messageFileFits,
	metadataFields,
	metadataFileFits,
	reportStoredFileMismatch,
	searchDeltaFits,
	type StoredFileKind,
} from './storedFileSlot';
import type { Message } from './types';

// The Graph endpoint is configured via environment variables for flexibility between environments.
const THE_GRAPH_API_URL = import.meta.env.VITE_THE_GRAPH_API_URL;
const graphQLClient = new GraphQLClient(THE_GRAPH_API_URL);
const requestGraph: GraphRequest = (document, variables) =>
	graphQLClient.request(document, variables);

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

/**
 * How many payloads one sync pass fetches and decrypts at once. A first sync of a large wallet
 * has a payload per message (and per search delta) of every conversation: started all at once,
 * that is thousands of requests, which a gateway answers with 429 (each counted unavailable,
 * so the cursor is held and the same burst comes back next pass) and which hold every body in
 * memory together. Browsers open about 6 connections per host over HTTP/1.1, so 8 keeps every
 * connection busy, with a couple queued, while one slow fetch (or one waiting out its retry
 * backoff, which keeps its slot) does not stall the rest.
 */
export const PAYLOAD_FETCH_CONCURRENCY = 8;

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

/** Result of a sync pass; the UI turns it into the history banner's two notices. */
export interface SyncResult {
	/**
	 * Payloads no storage source could serve this pass (transient — retried next pass).
	 * Undefined when the pass failed before its payloads were read (at The Graph, for one): it
	 * says nothing about storage, so a storage notice stays as it is.
	 */
	readonly unavailablePayloads: number | undefined;
	/**
	 * The Graph could not be read this pass (see GraphFetchFailed): nothing was stored and the
	 * cursor was held, so what is shown is what was saved before. Retried next pass. Undefined
	 * when the pass failed before The Graph had answered: it says nothing either way.
	 */
	readonly graphUnavailable: boolean | undefined;
}

// Returned by reference from several early exits, so it must be immune to mutation.
const NOTHING_UNAVAILABLE: SyncResult = Object.freeze({
	unavailablePayloads: 0,
	graphUnavailable: false,
});

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
 * A hydrated file kept only if it belongs to the slot it was fetched for (see
 * storedFileSlot.ts). One that does not is counted like a payload no source could serve, so the
 * cursor is held and the slot is asked for again next pass, and is reported once per page load
 * by its kind.
 */
function inSlot(
	payload: HydratedPayload,
	fits: (_value: unknown) => boolean,
	kind: StoredFileKind,
): HydratedPayload {
	if (payload.value === null || fits(payload.value)) return payload;
	reportStoredFileMismatch(kind);
	return { value: null, unavailable: true };
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
		const stored = Number(decrypted.conversationsLastSyncedAt) || 0;
		// A cursor ahead of the clock would ask only for times nothing has reached yet.
		const usable = usableCursor(stored, Date.now());
		if (usable !== stored) reportGraphTimeAhead('stored-cursor-ahead');
		return usable;
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
 * The user message for a prompt known from the subgraph's prompt requests: one sent from
 * another device, or one that was cancelled or refunded. It carries its answer id (the request's
 * id) so a pending prompt's answer can be followed live on this device before it is stored.
 */
export function messageFromPromptRequest(
	req: Pick<
		ConversationUpdate['promptRequests'][number],
		'id' | 'promptMessageId' | 'createdAt' | 'isCancelled' | 'isRefunded'
	>,
	payload: { promptText?: string; previousMessageId?: string | null },
	conversationId: string,
) {
	let status = 'pending';
	if (req.isCancelled) status = 'cancelled';
	if (req.isRefunded) status = 'refunded';
	return {
		id: req.promptMessageId.toString(), // The prompt's id, not the answer's
		conversationId,
		parentId: payload.previousMessageId || null,
		role: 'user',
		content: payload.promptText,
		createdAt: req.createdAt,
		status, // Lets the UI style it differently
		answerMessageId: String(req.id),
	};
}

/**
 * @notice Fetches every conversation updated since the last sync from The Graph, with all of
 *         its messages and unanswered prompt requests, however many pages that takes.
 * @dev Throws `GraphFetchFailed` when any request fails (see graph/userUpdates.ts), and when
 *      no endpoint is configured. It never returns an empty list for a failure: the caller
 *      reads an empty list as "nothing new" and moves the cursor up to the present.
 * @param {string} ownerAddress The user's wallet address.
 * @param {number} lastSync The timestamp of the last successful sync (Milliseconds).
 * @returns {Promise<Array>} The updated conversations, timestamps converted to milliseconds.
 */
async function fetchUpdatesFromTheGraph(
	ownerAddress: string,
	lastSync: number,
): Promise<ConversationUpdate[]> {
	if (!THE_GRAPH_API_URL) throw new GraphFetchFailed('conversations', 'not-configured');
	// The Graph stores block timestamps in Seconds. We must convert our local MS timestamp.
	const lastSyncSeconds = Math.floor(lastSync / 1000);
	const conversations = await fetchAllUserUpdates(
		requestGraph,
		ownerAddress.toLowerCase(),
		lastSyncSeconds,
	);

	// Convert BigInt strings from The Graph response into Numbers (MS) for frontend consistency.
	return conversations.map(conv => ({
		...conv,
		lastMessageCreatedAt: Number(conv.lastMessageCreatedAt) * 1000,
		messages: conv.messages.map(msg => ({
			...msg,
			searchDelta: msg.searchDelta ?? undefined,
			createdAt: Number(msg.createdAt) * 1000,
		})),
		promptRequests: conv.promptRequests.map(req => ({
			...req,
			createdAt: Number(req.createdAt) * 1000,
		})),
	}));
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
	// One pool per pass: every payload fetch of the pass waits for a slot (see the constant).
	const limit = createLimiter(PAYLOAD_FETCH_CONCURRENCY);
	const hydrate = (cid: string | undefined) => limit(() => hydratePayload(cid, sessionKey));
	// Until The Graph has answered, a failure here says nothing about it (see SyncResult).
	let graphRead = false;
	// Likewise, until the payloads have been read a failure says nothing about storage.
	let storageRead = false;

	try {
		// 1. Get the last known sync timestamp from our local state (Milliseconds).
		const lastSync = await getLastSyncedAt(sessionKey, ownerAddress);

		// 2. Fetch all entity updates from The Graph since that timestamp, every page of them.
		// (fetchUpdatesFromTheGraph handles the MS -> S -> MS conversions.) A failed request
		// throws to the catch below, so the cursor is not moved and nothing is stored.
		const graphUpdates = await fetchUpdatesFromTheGraph(ownerAddress, lastSync);
		graphRead = true;

		// 3. A pass that read no conversation leaves the cursor where it was. Moving it to the
		// device's clock would hide a first conversation whose block time is earlier than that
		// clock (a device running ahead, or indexing running late), and costs nothing to skip:
		// asking again from the same cursor returns nothing until something new is indexed.
		if (graphUpdates.length === 0) return NOTHING_UNAVAILABLE;

		// The new cursor is the newest conversation read (graphUpdates is normalized to MS) whose
		// time is not ahead of this device's clock (see syncCursor.ts). A conversation served
		// with a time past that is stored all the same: what it holds is decrypted with this
		// wallet's key and checked against what was asked for, and the time only orders the
		// history. It is served again on every pass until the clock reaches it, and its matching
		// CIDs make that repeat free. Undefined when every conversation read is ahead: the cursor
		// then stays where it was.
		const passStartedAt = Date.now();
		const lastMessageTimes = graphUpdates.map(c => c.lastMessageCreatedAt);
		const newLastSync = cursorFrom(lastMessageTimes, passStartedAt);
		if (lastMessageTimes.some(time => isAheadOfClock(time, passStartedAt))) {
			reportGraphTimeAhead('time-ahead');
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
						// A record stored while one of its files had not arrived is never skipped:
						// the conversation is asked for again on every pass until they all have.
						localConv.hydrationIncomplete !== true &&
						// …and only honour the skip once the local message cache has actually
						// caught up. A follow-up answer can still be a content-less placeholder
						// even when the conv-level CIDs match (see conversationHasPendingMessage),
						// in which case we must re-hydrate rather than strand it on "Thinking…".
						!(await conversationHasPendingMessage(sessionKey, ownerAddress, conv.id))
					) {
						// Data is identical and fully hydrated. Skip to save bandwidth and processing.
						return {
							conversationId: conv.id,
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
			// The metadata file carries no identifier, so it is held to its kind and its three fields.
			const [convPayload, metadataPayload] = await Promise.all([
				hydrate(conv.conversationCID).then(payload =>
					inSlot(payload, file => conversationFileFits(file, conv.id), 'conversation'),
				),
				hydrate(conv.conversationMetadataCID).then(payload =>
					inSlot(payload, metadataFileFits, 'metadata'),
				),
			]);
			const convData = convPayload.value as StoredRecord | null;
			const metadataData = metadataFields(metadataPayload.value);

			const messageHydrationPromises = (conv.messages || []).map(
				async (msg: ConversationUpdate['messages'][number]) => {
					const [messagePayload, searchDeltaPayload] = await Promise.all([
						hydrate(msg.messageCID).then(payload =>
							inSlot(payload, file => messageFileFits(file, msg.id, conv.id), 'message'),
						),
						hydrate(msg.searchDelta?.searchDeltaCID).then(payload =>
							inSlot(payload, delta => searchDeltaFits(delta, msg.id, conv.id), 'search-delta'),
						),
					]);
					const messageData = messagePayload.value as StoredRecord | null;
					// Return a structured object for clarity, associating the message with its search delta.
					return {
						message: messageData
							? {
									// The answer attempt is kept only as a positive safe integer.
									...withCheckedAnswerAttempt(messageData),
									id: msg.id,
									conversationId: conv.id,
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
						return messageFromPromptRequest(req, payload, conv.id);
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
						// Set, and so read by the skip above, only while a file of this
						// conversation was withheld or refused on this pass.
						...(convUnavailablePayloads > 0 ? { hydrationIncomplete: true } : {}),
				  }
				: null;

			// If we have a local record with a NEWER timestamp (Optimistic Update),
			// DO NOT return the remote conversation. Keep the local one to prevent UI jitter/reversion.
			if (remoteConversation && localConv) {
				if (localConv.lastUpdatedAt > Number(remoteConversation.lastUpdatedAt)) {
					// Returning null conversation prevents the overwrite in the next step
					return {
						conversationId: conv.id,
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
				conversationId: conv.id,
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
		storageRead = true;
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

		// Each conversation's messages are merged into what is stored at the moment of writing, so
		// a prompt sent while this sync was fetching is not replaced by the older list it read.
		const messageWrites = hydratedData
			.filter(item => item.messages.length > 0)
			.map(item => {
				// The cache key is the conversation the files were asked for, never one read from
				// a decrypted file, also when the conversation record is not written this pass.
				const { conversationId } = item;

				const mergeHydrated = (current: Message[] | null): Message[] => {
					// Merge by id, keyed so The Graph is authority for status/metadata, but an
					// un-hydrated (content-less) incoming message must NOT clobber content we
					// already delivered. See mergeMessages. This also preserves history when The
					// Graph only returns the newest messages (e.g. after branching).
					//
					// item.messages is the post-hydration `allMessages` (decrypted MessageFiles +
					// prompt requests): both carry id/content/createdAt, so the Message shape
					// holds at runtime; the cast only bridges its loose `unknown[]` upstream typing.
					const merged = mergeMessages(current ?? [], item.messages as unknown as Message[]);

					// Drop the orphaned content-less answer placeholders of cancelled/refunded
					// prompts so the chat doesn't stay stuck "Thinking…" after a cancel.
					return dropCancelledAnswerPlaceholders(
						merged as unknown as Array<{
							id?: string | number;
							role?: string;
							content?: unknown;
						}>,
						item.cancelledAnswerIds,
					) as unknown as Message[];
				};

				// The hydrated messages are the stored copy, so they replace data that cannot be read.
				return writeMessageCache(sessionKey, ownerAddress, conversationId, mergeHydrated, {
					replaceUnreadable: true,
				}).then(
					() => null,
					(error: unknown) => {
						console.error(
							`[syncService] The messages of conversation "${conversationId}" could not be stored:`,
							error,
						);
						return conversationId;
					},
				);
			});

		const [allConversationsToCache, messageWriteResults] = await Promise.all([
			Promise.all(conversationCachePromises),
			Promise.all(messageWrites),
		]);

		// A conversation whose messages could not be stored is not recorded either: its record
		// is what lets the next sync skip it, and it would then never get its messages. The
		// others are recorded as usual, so one bad write does not hold every conversation back.
		const notStored = new Set(messageWriteResults.filter(id => id !== null));
		const conversationsToCache = allConversationsToCache.filter(c => !notStored.has(c.id));

		// 5. Store the conversation records in one bulk operation.
		if (conversationsToCache.length > 0) {
			await db.conversations.bulkPut(conversationsToCache);
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
		//
		// The same goes for a conversation whose messages could not be stored on this device.
		if (unavailablePayloads === 0 && notStored.size === 0 && newLastSync !== undefined) {
			await setLastSyncedAt(sessionKey, ownerAddress, newLastSync);
		}
		return { unavailablePayloads, graphUnavailable: false };
	} catch (error) {
		// We do not update the timestamp on failure, ensuring the process will be retried.
		if (error instanceof GraphFetchFailed) {
			// Its message names the list and the reason only; see GraphFetchFailed. The user is
			// told through the result, and Sentry once per page load per list and reason.
			console.error(`[syncService] ${error.name}: ${error.message} The sync cursor is held.`);
			reportGraphFetchFailed(error);
			return {
				unavailablePayloads: storageRead ? unavailablePayloads : undefined,
				graphUnavailable: true,
			};
		}
		console.error('[syncService] A critical error occurred during the sync process:', error);
		return {
			unavailablePayloads: storageRead ? unavailablePayloads : undefined,
			graphUnavailable: graphRead ? false : undefined,
		};
	}
}
