import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/db';

import { deriveKeyFromEntropy, encryptData } from './crypto';
import { dropCancelledAnswerPlaceholders } from './syncService';

// graphql-request: capture a hoisted request mock so each test controls the
// conversation updates returned by The Graph.
const { graphRequestMock } = vi.hoisted(() => ({ graphRequestMock: vi.fn() }));

vi.mock('graphql-request', () => ({
	GraphQLClient: class {
		request = graphRequestMock;
	},
	gql: (strings: TemplateStringsArray, ...exprs: unknown[]) =>
		strings.reduce((acc, s, i) => acc + s + (i < exprs.length ? String(exprs[i]) : ''), ''),
}));

vi.mock('@/lib/searchService', () => ({ mergeSearchIndexDeltas: vi.fn() }));

vi.mock('@/lib/db', () => {
	const conversations = { get: vi.fn(), bulkPut: vi.fn() };
	const messageCache = { get: vi.fn(), bulkPut: vi.fn() };
	const userMetadata = { get: vi.fn(), put: vi.fn() };
	return { default: { conversations, messageCache, userMetadata } };
});

const mockDb = db as unknown as {
	conversations: { get: ReturnType<typeof vi.fn>; bulkPut: ReturnType<typeof vi.fn> };
	messageCache: { get: ReturnType<typeof vi.fn>; bulkPut: ReturnType<typeof vi.fn> };
	userMetadata: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
};

const ENTROPY = 'test-sig-0xsync';
const OWNER = '0xabc123def456abc123def456abc123def456abc1';
const CONV_ID = 'c1';

// IPFS-style CIDs (base32, baf[ky]…) so getStorageProvider routes them to the
// stubbed localnet gateway instead of throwing "Unsupported CID format".
const CID_CONV = `bafyconv${'a'.repeat(24)}`;
const CID_META = `bafymeta${'a'.repeat(24)}`;
const CID_MSG = `bafymsga${'a'.repeat(24)}`;

/** The Graph conversation update whose conv-level CIDs/timestamp match the local record. */
function graphConversationUpdate() {
	return {
		conversations: [
			{
				id: CONV_ID,
				conversationCID: CID_CONV,
				conversationMetadataCID: CID_META,
				// The Graph returns SECONDS; fetchUpdatesFromTheGraph multiplies by 1000.
				lastMessageCreatedAt: '1700',
				messages: [{ id: 'm-answer', messageCID: CID_MSG, createdAt: '1700' }],
				promptRequests: [],
			},
		],
	};
}

async function importSync() {
	const mod = await import('./syncService');
	return mod.default;
}

describe('syncWithRemote — message-aware hydration skip', () => {
	let sessionKey: CryptoKey;

	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		// syncService reads these at module-load, so stub before the dynamic import.
		vi.stubEnv('VITE_THE_GRAPH_API_URL', 'http://localhost:8000/subgraphs/name/senseai');
		vi.stubEnv('VITE_STORAGE_GATEWAY_URL', 'http://localhost:8080/ipfs/');

		sessionKey = await deriveKeyFromEntropy(ENTROPY, OWNER);

		graphRequestMock.mockResolvedValue(graphConversationUpdate());
		mockDb.userMetadata.get.mockResolvedValue(undefined);
		mockDb.userMetadata.put.mockResolvedValue(undefined);
		mockDb.conversations.bulkPut.mockResolvedValue(undefined);
		mockDb.messageCache.bulkPut.mockResolvedValue(undefined);

		// Local conversation record whose CIDs + lastMessageCreatedAt MATCH the graph
		// update — i.e. the conversation-level optimization considers it up to date.
		const localConv = {
			id: CONV_ID,
			conversationCID: CID_CONV,
			conversationMetadataCID: CID_META,
			lastMessageCreatedAt: 1_700_000,
			lastUpdatedAt: 1,
		};
		mockDb.conversations.get.mockResolvedValue({
			ownerAddress: OWNER,
			id: CONV_ID,
			encryptedData: await encryptData(sessionKey, localConv),
		});

		// Storage gateway returns encrypted payloads keyed by which CID is requested.
		const fetchMock = vi.fn(async (url: string) => {
			let payload: Record<string, unknown> = {};
			if (url.includes('conv')) payload = { title: 'Conversation' };
			else if (url.includes('meta')) payload = { metadata: true };
			else if (url.includes('msga'))
				payload = { role: 'assistant', content: 'The hydrated answer', createdAt: 1_700_000 };
			const encrypted = await encryptData(sessionKey, payload);
			return { ok: true, text: async () => encrypted } as unknown as Response;
		});
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	/** Seed the local message cache for CONV_ID with the given messages. */
	async function seedMessageCache(messages: Array<Record<string, unknown>>) {
		mockDb.messageCache.get.mockResolvedValue({
			ownerAddress: OWNER,
			conversationId: CONV_ID,
			encryptedData: await encryptData(sessionKey, messages),
		});
	}

	it('re-hydrates when the cache still holds a content-less pending answer', async () => {
		// The local cache has a follow-up assistant placeholder that never received
		// its content — even though the conversation-level CIDs already match.
		await seedMessageCache([
			{ id: 'm-prompt', role: 'user', content: 'follow-up question', createdAt: 1 },
			{ id: 'm-answer', role: 'assistant', content: null, createdAt: 2 },
		]);

		const syncWithRemote = await importSync();
		await syncWithRemote(sessionKey, OWNER);

		// It must NOT take the conversation-level skip: the message content is fetched
		// and the hydrated answer is written back to the cache.
		expect(
			(globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) =>
				String(u).includes('msga'),
			),
		).toBe(true);
		expect(mockDb.messageCache.bulkPut).toHaveBeenCalled();
	});

	it('still skips hydration when the cache is already fully resolved', async () => {
		// Every assistant message already has content → the optimization should hold.
		await seedMessageCache([
			{ id: 'm-prompt', role: 'user', content: 'earlier question', createdAt: 1 },
			{ id: 'm-answer', role: 'assistant', content: 'already delivered', createdAt: 2 },
		]);

		const syncWithRemote = await importSync();
		await syncWithRemote(sessionKey, OWNER);

		expect(
			(globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) =>
				String(u).includes('msga'),
			),
		).toBe(false);
		expect(mockDb.messageCache.bulkPut).not.toHaveBeenCalled();
	});

	it('treats a content-less but cancelled answer as resolved (still skips)', async () => {
		// A cancelled/refunded prompt leaves a null-content assistant bubble that will
		// never receive content — it must NOT count as pending, or the skip would be
		// defeated forever. Mirrors the status exclusion in hasPendingAnswer.
		await seedMessageCache([
			{ id: 'm-prompt', role: 'user', content: 'cancelled question', createdAt: 1 },
			{ id: 'm-answer', role: 'assistant', content: null, status: 'cancelled', createdAt: 2 },
		]);

		const syncWithRemote = await importSync();
		await syncWithRemote(sessionKey, OWNER);

		expect(
			(globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) =>
				String(u).includes('msga'),
			),
		).toBe(false);
		expect(mockDb.messageCache.bulkPut).not.toHaveBeenCalled();
	});
});

describe('dropCancelledAnswerPlaceholders', () => {
	// When a prompt is cancelled/refunded the answer is never delivered, but the
	// optimistic answer placeholder (keyed by answerMessageId) lingers content-less
	// and keeps the chat stuck "Thinking…". Drop exactly those.
	it('drops a content-less assistant placeholder whose id is cancelled', () => {
		const messages = [
			{ id: 'p1', role: 'user', content: 'prompt', status: 'cancelled' },
			{ id: 'a1', role: 'assistant', content: null },
		];
		const result = dropCancelledAnswerPlaceholders(messages, new Set(['a1']));
		expect(result).toEqual([{ id: 'p1', role: 'user', content: 'prompt', status: 'cancelled' }]);
	});

	it('keeps a delivered (content-ful) answer even if its id is in the set', () => {
		const messages = [{ id: 'a1', role: 'assistant', content: 'the answer' }];
		expect(dropCancelledAnswerPlaceholders(messages, new Set(['a1']))).toEqual(messages);
	});

	it('keeps the cancelled user prompt and unrelated messages', () => {
		const messages = [
			{ id: 'p1', role: 'user', content: 'prompt', status: 'cancelled' },
			{ id: 'a2', role: 'assistant', content: null },
		];
		// a2 is not in the cancelled set → keep it (a different pending answer).
		expect(dropCancelledAnswerPlaceholders(messages, new Set(['a1']))).toEqual(messages);
	});

	it('returns the list unchanged for an empty set', () => {
		const messages = [{ id: 'a1', role: 'assistant', content: null }];
		expect(dropCancelledAnswerPlaceholders(messages, new Set())).toBe(messages);
	});
});
