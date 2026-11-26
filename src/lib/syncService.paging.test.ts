import { stringToHex } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composerStateFor } from '@/features/chat/promptParent';
import { decryptData, deriveKeyFromEntropy, encryptData } from '@/lib/crypto';
import {
	createFakeGraph,
	fakeCid,
	type FakeConversation,
	type FakeMessage,
	type FakePromptRequest,
} from '@/test/fakeGraph';

// A full sync against a wallet with more history than one request returns. The Graph is the
// fake in src/test/fakeGraph.ts; the local store is an in-memory copy of the three tables the
// sync and the message reader use, so what was stored can be read back.

const { graphRequestMock, captureExceptionMock, store } = vi.hoisted(() => ({
	graphRequestMock: vi.fn(),
	captureExceptionMock: vi.fn(),
	store: {
		conversations: new Map<string, { id: string; encryptedData: string }>(),
		messageCache: new Map<string, { encryptedData: string }>(),
		userMetadata: new Map<string, { encryptedData: string }>(),
		conversationBulkPuts: [] as Array<Array<{ id: string }>>,
		metadataPuts: 0,
	},
}));

vi.mock('@sentry/react', () => ({
	addBreadcrumb: vi.fn(),
	captureMessage: vi.fn(),
	captureException: captureExceptionMock,
}));

vi.mock('graphql-request', () => ({
	GraphQLClient: class {
		request = graphRequestMock;
	},
	gql: (strings: TemplateStringsArray, ...exprs: unknown[]) =>
		strings.reduce((acc, s, i) => acc + s + (i < exprs.length ? String(exprs[i]) : ''), ''),
}));

vi.mock('@/lib/searchService', () => ({
	mergeSearchIndexDeltas: vi.fn(),
	addDeltaToLiveIndex: vi.fn(),
	removeConversationFromLiveIndex: vi.fn(),
	updateTitleInLiveIndex: vi.fn(),
}));

// The resolver's retry backoff is real time; these tests only care about the outcome.
vi.mock('@/lib/payloadStorage', async importOriginal => {
	const actual = await importOriginal<typeof import('@/lib/payloadStorage')>();
	return {
		...actual,
		fetchPayload: (
			cid: string,
			config: Parameters<typeof actual.fetchPayload>[1],
			deps: Parameters<typeof actual.fetchPayload>[2],
		) => actual.fetchPayload(cid, config, { ...deps, wait: async () => {} }),
	};
});

vi.mock('@/lib/db', () => {
	const key = (parts: unknown) => JSON.stringify(parts);
	return {
		default: {
			conversations: {
				get: async (parts: unknown) => store.conversations.get(key(parts)),
				bulkPut: async (
					rows: Array<{ ownerAddress: string; id: string; encryptedData: string }>,
				) => {
					store.conversationBulkPuts.push(rows);
					rows.forEach(row => store.conversations.set(key([row.ownerAddress, row.id]), row));
				},
			},
			messageCache: {
				get: async (parts: unknown) => store.messageCache.get(key(parts)),
				put: async (row: {
					ownerAddress: string;
					conversationId: string;
					encryptedData: string;
				}) => {
					store.messageCache.set(key([row.ownerAddress, row.conversationId]), row);
				},
			},
			userMetadata: {
				get: async (owner: string) => store.userMetadata.get(owner),
				put: async (row: { ownerAddress: string; encryptedData: string }) => {
					store.metadataPuts += 1;
					store.userMetadata.set(row.ownerAddress, row);
				},
			},
			// A transaction runs its body in one go, as IndexedDB does.
			transaction: async (_mode: string, _table: unknown, body: () => Promise<unknown>) => body(),
		},
	};
});

const OWNER = '0xabc123def456abc123def456abc123def456abc1';
const GATEWAY = 'http://localhost:8080/ipfs/';
const GRAPH_URL = 'http://localhost:8000/subgraphs/name/senseai';
/** A block timestamp in seconds, as The Graph serves it. */
const T0 = 1_700_000_000;
const CONV_CID = fakeCid('conv', 0);
const META_CID = fakeCid('meta', 0);

let sessionKey: CryptoKey;
/** What the storage gateway serves, by CID, before encryption. */
let payloads: Map<string, Record<string, unknown>>;

/** Each conversation's own conversation file, naming it as the oracle's does. */
const conversationCids = new Map<string, string>();
function conversationCidFor(id: string): string {
	let cid = conversationCids.get(id);
	if (!cid) {
		cid = fakeCid('conv', conversationCids.size + 1);
		conversationCids.set(id, cid);
	}
	payloads.set(cid, { id, title: 'Conversation' });
	return cid;
}

function conversation(
	id: string,
	lastAt: number,
	lists: Partial<Pick<FakeConversation, 'messages' | 'promptRequests'>> = {},
): FakeConversation {
	return {
		id,
		conversationCID: conversationCidFor(id),
		conversationMetadataCID: META_CID,
		lastMessageCreatedAt: String(lastAt),
		messages: lists.messages ?? [],
		promptRequests: lists.promptRequests ?? [],
	};
}

/** Messages `from`..`to` of a conversation, each the reply to the one before it. */
function messagesOf(conversationId: string, from: number, to: number): FakeMessage[] {
	return Array.from({ length: to - from + 1 }, (_, i) => {
		const n = from + i;
		const messageCID = fakeCid('msg', n);
		payloads.set(messageCID, {
			id: String(n),
			conversationId,
			role: n % 2 === 1 ? 'user' : 'assistant',
			content: `message ${n}`,
			parentId: n === 1 ? null : String(n - 1),
			createdAt: (T0 + n) * 1000,
		});
		return { id: String(n), messageCID, createdAt: String(T0 + n), searchDelta: null };
	});
}

/** Unanswered prompts 1..count; each request's id is its answer's id. */
async function promptRequestsOf(count: number): Promise<FakePromptRequest[]> {
	return Promise.all(
		Array.from({ length: count }, async (_, i) => {
			const n = i + 1;
			const encrypted = await encryptData(sessionKey, {
				promptText: `prompt ${n}`,
				previousMessageId: n === 1 ? null : String(n - 1),
			});
			return {
				id: String(100_000 + n),
				promptMessageId: String(n),
				encryptedPayload: stringToHex(encrypted),
				isCancelled: false,
				isRefunded: false,
				createdAt: String(T0 + n),
			};
		}),
	);
}

function useGraph(conversations: FakeConversation[]) {
	const graph = createFakeGraph(conversations);
	graphRequestMock.mockImplementation(graph.request);
	return graph;
}

async function storedMessages(conversationId: string): Promise<Array<{ id: string }>> {
	const row = store.messageCache.get(JSON.stringify([OWNER, conversationId]));
	return row ? decryptData(sessionKey, row.encryptedData) : [];
}

const storedConversationIds = () => [...store.conversations.values()].map(row => row.id);

/** The stored sync cursor (milliseconds), or undefined when none was ever stored. */
async function storedCursor(): Promise<number | undefined> {
	const row = store.userMetadata.get(OWNER);
	if (!row) return undefined;
	const metadata = await decryptData(sessionKey, row.encryptedData);
	return metadata.conversationsLastSyncedAt;
}

/** Stores a cursor, as an earlier sync would have. */
async function storeCursor(ms: number) {
	const encryptedData = await encryptData(sessionKey, {
		searchLastSyncedAt: 0,
		conversationsLastSyncedAt: ms,
	});
	store.userMetadata.set(OWNER, { encryptedData });
}

async function sync() {
	const { default: syncWithRemote } = await import('./syncService');
	return syncWithRemote(sessionKey, OWNER);
}

describe('syncWithRemote — a full sync reads every page', () => {
	beforeEach(async () => {
		vi.resetModules();
		graphRequestMock.mockReset();
		captureExceptionMock.mockReset();
		vi.stubEnv('VITE_THE_GRAPH_API_URL', GRAPH_URL);
		vi.stubEnv('VITE_STORAGE_GATEWAY_URL', GATEWAY);
		store.conversations.clear();
		store.messageCache.clear();
		store.userMetadata.clear();
		store.conversationBulkPuts.length = 0;
		store.metadataPuts = 0;

		sessionKey = await deriveKeyFromEntropy('test-sig-0xpaging', OWNER);
		payloads = new Map([
			[CONV_CID, { title: 'Conversation' }],
			[META_CID, { metadata: true }],
		]);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				const encrypted = await encryptData(
					sessionKey,
					payloads.get(url.slice(GATEWAY.length)) ?? {},
				);
				return { ok: true, status: 200, text: async () => encrypted };
			}),
		);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('stores every conversation from three pages of 100, 100 and 51', async () => {
		const graph = useGraph(Array.from({ length: 251 }, (_, i) => conversation(`c${i}`, T0 + i)));

		await sync();

		// 251 = 100 + 100 + 51.
		expect(new Set(storedConversationIds()).size).toBe(251);
		// Two full pages, then a short one that ends the paging.
		expect(graph.requests).toEqual(['GetUserUpdates', 'GetUserUpdates', 'GetUserUpdates']);
		expect(store.metadataPuts).toBe(1);
	});

	it('asks again for the messages of a conversation that returned 1000, and stores all 1,200', async () => {
		const graph = useGraph([
			conversation('c1', T0 + 1200, { messages: messagesOf('c1', 1, 1200) }),
		]);

		await sync();

		const ids = (await storedMessages('c1')).map(m => m.id);
		// Messages 1..1200, each once.
		expect(new Set(ids).size).toBe(1200);
		expect(ids).toHaveLength(1200);
		// The nested list holds the newest 1000 (1200..201). The next page, created at or before
		// message 201, returns 201..1: 201 rows, one already seen, short of 1000, so it ends.
		expect(graph.requests).toEqual(['GetUserUpdates', 'GetConversationMessages']);
	});

	it('asks again for the prompt requests of a conversation that returned 1000, and stores all 1,200', async () => {
		const unanswered = await promptRequestsOf(1200);
		// An answered request, older than all of them: it is already among the messages, and the
		// follow-up page must not bring it back as a prompt.
		const answered = {
			...unanswered[0],
			id: '900000',
			promptMessageId: '9000',
			isAnswered: true,
			createdAt: String(T0),
		};
		const graph = useGraph([
			conversation('c1', T0 + 1200, { promptRequests: [...unanswered, answered] }),
		]);

		await sync();

		const ids = (await storedMessages('c1')).map(m => m.id);
		// One stored prompt per unanswered request, under its prompt id 1..1200.
		expect(new Set(ids).size).toBe(1200);
		expect(ids).not.toContain('9000');
		// As for messages: 1000 nested (1200..201), then 201..1 in one short follow-up page.
		expect(graph.requests).toEqual(['GetUserUpdates', 'GetConversationPromptRequests']);
	});

	it('marks nothing synced and leaves the cursor alone when page 2 fails', async () => {
		const graph = createFakeGraph(
			Array.from({ length: 150 }, (_, i) =>
				conversation(`c${i}`, T0 + i, { messages: messagesOf(`c${i}`, i + 1, i + 1) }),
			),
		);
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		graphRequestMock
			.mockImplementationOnce(graph.request)
			.mockRejectedValueOnce(
				new Error(`request to ${GRAPH_URL} failed for owner ${OWNER}: 502 Bad Gateway`),
			);

		await sync();

		expect(graphRequestMock).toHaveBeenCalledTimes(2);
		expect(store.conversationBulkPuts).toHaveLength(0);
		expect(store.messageCache.size).toBe(0);
		expect(store.metadataPuts).toBe(0);
		// What is logged names the failure, never the endpoint or the wallet.
		const logged = JSON.stringify(errors.mock.calls.map(call => call.map(String)));
		expect(logged).not.toContain('localhost');
		expect(logged).not.toContain(OWNER);
	});

	it('leaves the cursor where it was when the first request fails', async () => {
		const before = await encryptData(sessionKey, {
			searchLastSyncedAt: 0,
			conversationsLastSyncedAt: 5_000,
		});
		store.userMetadata.set(OWNER, { encryptedData: before });
		vi.spyOn(console, 'error').mockImplementation(() => {});
		graphRequestMock.mockRejectedValue(new Error('Failed to fetch'));

		await sync();

		expect(store.metadataPuts).toBe(0);
		expect(store.userMetadata.get(OWNER)?.encryptedData).toBe(before);
	});

	it('leaves the cursor where it was after a pass that reads no conversation', async () => {
		await storeCursor(5_000);
		const before = store.userMetadata.get(OWNER)?.encryptedData;
		useGraph([]);

		await sync();

		expect(store.metadataPuts).toBe(0);
		expect(store.userMetadata.get(OWNER)?.encryptedData).toBe(before);
	});

	it("reads a new wallet's first conversation even when the device clock runs ahead", async () => {
		// The device is an hour ahead of the chain; the wallet has no conversation yet.
		vi.spyOn(Date, 'now').mockReturnValue((T0 + 3_600) * 1000);
		useGraph([]);
		await sync();
		// Its first conversation lands at chain time, well before the device's clock.
		useGraph([conversation('c1', T0 + 10)]);

		await sync();

		expect(storedConversationIds()).toEqual(['c1']);
		expect(await storedCursor()).toBe((T0 + 10) * 1000);
	});

	it('stores nothing, holds the cursor and reports once when the pages never end', async () => {
		await storeCursor(5_000);
		const before = store.userMetadata.get(OWNER)?.encryptedData;
		vi.spyOn(console, 'error').mockImplementation(() => {});
		// A broken endpoint: every page is full and holds one conversation not read before.
		let next = 0;
		graphRequestMock.mockImplementation(async () => {
			next += 1;
			// Gives in after a while, so a missing cap fails the test rather than never ending.
			if (next > 5_000) return { conversations: [] };
			return {
				conversations: [
					conversation(`new-${next}`, T0),
					...Array.from({ length: 99 }, (_, i) => conversation(`repeat-${i}`, T0)),
				],
			};
		});

		const result = await sync();

		expect(result.graphUnavailable).toBe(true);
		expect(store.conversationBulkPuts).toHaveLength(0);
		expect(store.metadataPuts).toBe(0);
		expect(store.userMetadata.get(OWNER)?.encryptedData).toBe(before);
		expect(captureExceptionMock).toHaveBeenCalledTimes(1);
		expect(captureExceptionMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({
				tags: expect.objectContaining({ list: 'conversations', reason: 'too-many-pages' }),
			}),
		);
	});

	it('makes exactly one request for a wallet under both limits', async () => {
		const prompts = await promptRequestsOf(2);
		const graph = useGraph(
			['c1', 'c2', 'c3'].map((id, i) =>
				conversation(id, T0 + 100 * (i + 1), {
					messages: messagesOf(id, 10 * i + 3, 10 * i + 7),
					promptRequests: prompts,
				}),
			),
		);

		await sync();

		expect(graph.requests).toEqual(['GetUserUpdates']);
		expect(new Set(storedConversationIds())).toEqual(new Set(['c1', 'c2', 'c3']));
		// Each conversation: 5 messages (ids 3..7, 13..17, 23..27) and 2 prompts (ids 1, 2).
		const counts = await Promise.all(
			['c1', 'c2', 'c3'].map(async id => (await storedMessages(id)).length),
		);
		expect(counts).toEqual([7, 7, 7]);
	});

	it('ends, and loses nothing, when every row of a page has one timestamp', async () => {
		const graph = useGraph(Array.from({ length: 251 }, (_, i) => conversation(`c${i}`, T0)));

		await sync();

		expect(new Set(storedConversationIds()).size).toBe(251);
		// Each record written once: 251 rows in all.
		expect(store.conversationBulkPuts.flat()).toHaveLength(251);
		// Page 1: 100 rows, all at T0. Page 2: at or before T0, after the 100 already read.
		// Page 3: after 200, returns 51, short of 100, so it ends.
		expect(graph.requests).toHaveLength(3);
	});

	it('drops the rows it has already read when a timestamp runs across a page edge', async () => {
		// 80 newest at their own times, then 50 sharing one time (rows 81..130, across the edge
		// after row 100), then 30 older.
		const newest = Array.from({ length: 80 }, (_, i) => conversation(`n${i}`, T0 + 1000 - i));
		const tied = Array.from({ length: 50 }, (_, i) => conversation(`t${i}`, T0 + 500));
		const oldest = Array.from({ length: 30 }, (_, i) => conversation(`o${i}`, T0 + 100 - i));
		const graph = useGraph([...newest, ...tied, ...oldest]);

		await sync();

		// 160 = 80 + 50 + 30, each written once.
		expect(new Set(storedConversationIds()).size).toBe(160);
		expect(store.conversationBulkPuts.flat()).toHaveLength(160);
		// Page 1 ends inside the tie; page 2 (at or before that time) returns its 50 and the
		// 30 older, 80 rows, short of 100, so it ends. 20 of them were on page 1.
		expect(graph.requests).toHaveLength(2);
	});

	it('stops, and marks nothing synced, when The Graph returns the same full page again', async () => {
		const sameHundred = Array.from({ length: 100 }, (_, i) => conversation(`c${i}`, T0 + i));
		const graph = createFakeGraph(sameHundred);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		// A Graph that ignores the page bounds: every request gets page 1.
		graphRequestMock.mockImplementation((document: string, variables: Record<string, unknown>) =>
			graph.request(document, { ...variables, where: {}, skip: 0, first: 100 }),
		);

		await sync();

		// Page 1, then the same 100 rows with nothing new: the sync stops there.
		expect(graphRequestMock).toHaveBeenCalledTimes(2);
		expect(store.conversationBulkPuts).toHaveLength(0);
		expect(store.metadataPuts).toBe(0);
	});

	it('lets a branch from message 150 of a 1,200-message conversation send after one sync', async () => {
		const branchCID = fakeCid('branch', 0);
		payloads.set(branchCID, {
			id: 'b',
			title: 'Branch',
			branchedFromConversationId: 'p',
			branchedAtMessageId: '150',
		});
		useGraph([
			conversation('p', T0 + 1200, { messages: messagesOf('p', 1, 1200) }),
			{ ...conversation('b', T0 + 2000), conversationCID: branchCID },
		]);

		await sync();
		const { getMessagesForConversation } = await import('@/lib/dataService');
		const shown = await getMessagesForConversation(sessionKey, OWNER, 'b');

		// Message 150 is not in the nested 1000 (1200..201); it arrives on the follow-up page.
		// The branch's history is messages 1..150.
		expect(shown).toHaveLength(150);
		const state = composerStateFor({
			activeConversationId: 'b',
			conversation: { branchedFromConversationId: 'p' },
			isConversationSettled: true,
			messagesShown: shown,
			areMessagesSettled: true,
		});
		expect(state).toMatchObject({ kind: 'ready', parentId: 150 });
	});

	// The follow-up messages query pages inside one second by `skip`: a conversation with more
	// than a page of messages in one second must still come back whole.
	it('stores all 2,500 messages of a conversation when they share one second', async () => {
		const messages = messagesOf('c1', 1, 2500).map(m => ({ ...m, createdAt: String(T0 + 5) }));
		useGraph([conversation('c1', T0 + 5, { messages })]);

		await sync();

		const ids = (await storedMessages('c1')).map(m => m.id);
		expect(new Set(ids).size).toBe(2500);
		expect(ids).toHaveLength(2500);
	});

	it('serves another wallet nothing', async () => {
		useGraph([
			{ ...conversation('mine', T0 + 2), owner: OWNER.toLowerCase() },
			{ ...conversation('theirs', T0 + 3), owner: '0x0000000000000000000000000000000000000001' },
		]);

		await sync();

		expect(storedConversationIds()).toEqual(['mine']);
	});
});

describe('syncWithRemote — the cursor', () => {
	beforeEach(async () => {
		vi.resetModules();
		graphRequestMock.mockReset();
		captureExceptionMock.mockReset();
		vi.stubEnv('VITE_THE_GRAPH_API_URL', GRAPH_URL);
		vi.stubEnv('VITE_STORAGE_GATEWAY_URL', GATEWAY);
		store.conversations.clear();
		store.messageCache.clear();
		store.userMetadata.clear();
		store.conversationBulkPuts.length = 0;
		store.metadataPuts = 0;
		sessionKey = await deriveKeyFromEntropy('test-sig-0xpaging', OWNER);
		payloads = new Map([
			[CONV_CID, { title: 'Conversation' }],
			[META_CID, { metadata: true }],
		]);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				const encrypted = await encryptData(
					sessionKey,
					payloads.get(url.slice(GATEWAY.length)) ?? {},
				);
				return { ok: true, status: 200, text: async () => encrypted };
			}),
		);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	// The newest row read, not the time the pass ended: a conversation updated while the pages
	// were read is above that row, and the next pass reads it from there.
	it('is set to the newest conversation read, in milliseconds, after a paged sync', async () => {
		useGraph(Array.from({ length: 251 }, (_, i) => conversation(`c${i}`, T0 + i)));

		await sync();

		expect(await storedCursor()).toBe((T0 + 250) * 1000);
	});

	// The cursor's own second is read again: another conversation can share it, and the
	// Graph's bound is inclusive. The cursor here is mid-second, so the seconds asked for must be
	// rounded down, not up.
	it('reads again a conversation updated in the cursor second', async () => {
		await storeCursor(T0 * 1000 + 500);
		useGraph([conversation('same-second', T0), conversation('older', T0 - 1)]);

		await sync();

		expect(storedConversationIds()).toEqual(['same-second']);
		expect(await storedCursor()).toBe(T0 * 1000);
	});
});

describe('syncWithRemote — a time ahead of this device', () => {
	const YEAR_S = 365 * 24 * 60 * 60;
	const nowSeconds = () => Math.floor(Date.now() / 1000);

	beforeEach(async () => {
		vi.resetModules();
		graphRequestMock.mockReset();
		captureExceptionMock.mockReset();
		vi.stubEnv('VITE_THE_GRAPH_API_URL', GRAPH_URL);
		vi.stubEnv('VITE_STORAGE_GATEWAY_URL', GATEWAY);
		store.conversations.clear();
		store.messageCache.clear();
		store.userMetadata.clear();
		store.conversationBulkPuts.length = 0;
		store.metadataPuts = 0;
		sessionKey = await deriveKeyFromEntropy('test-sig-0xpaging', OWNER);
		payloads = new Map([
			[CONV_CID, { title: 'Conversation' }],
			[META_CID, { metadata: true }],
		]);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				const encrypted = await encryptData(
					sessionKey,
					payloads.get(url.slice(GATEWAY.length)) ?? {},
				);
				return { ok: true, status: 200, text: async () => encrypted };
			}),
		);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	// Held there, the cursor would ask only for what comes after that time, and everything
	// updated before it would never be read again.
	it('does not move the cursor to a time far ahead of the clock', async () => {
		useGraph([conversation('honest', T0), conversation('far-row', nowSeconds() + YEAR_S)]);

		await sync();

		expect(await storedCursor()).toBe(T0 * 1000);
	});

	// The time is the indexer's; what the conversation holds was decrypted with this wallet's
	// key, so it is kept.
	it('still stores the conversation served with that time', async () => {
		useGraph([conversation('honest', T0), conversation('far-row', nowSeconds() + YEAR_S)]);

		await sync();

		expect(storedConversationIds().sort()).toEqual(['far-row', 'honest']);
	});

	// Block time can run a little ahead of a device's clock: that is not refused.
	it('takes a time a little ahead of the clock, inside the allowance', async () => {
		const slightlyAhead = nowSeconds() + 60;
		useGraph([conversation('honest', T0), conversation('block-ahead', slightlyAhead)]);

		await sync();

		expect(await storedCursor()).toBe(slightlyAhead * 1000);
	});

	// A clamp to the clock would put the cursor at a time no conversation was served with, and
	// a conversation indexed later with an earlier block time would never be read.
	it('leaves the cursor where it was when every conversation read is far ahead', async () => {
		await storeCursor(T0 * 1000);
		useGraph([conversation('far-row', nowSeconds() + YEAR_S)]);

		await sync();

		expect(await storedCursor()).toBe(T0 * 1000);
	});

	it('is reported once per page load, by kind only', async () => {
		const ahead = nowSeconds() + YEAR_S;
		useGraph([conversation('honest', T0), conversation('far-row', ahead)]);

		await sync();
		await sync();

		expect(captureExceptionMock).toHaveBeenCalledTimes(1);
		const [, context] = captureExceptionMock.mock.calls[0];
		expect(context).toEqual(
			expect.objectContaining({
				tags: expect.objectContaining({ check: 'graph-sync', reason: 'time-ahead' }),
			}),
		);
		const sent = JSON.stringify(captureExceptionMock.mock.calls[0]);
		expect(sent).not.toContain(String(ahead));
		expect(sent).not.toContain('far-row');
	});

	// A device whose cursor was moved there before this check reads its history again.
	it('reads from the start when the stored cursor is far ahead of the clock', async () => {
		await storeCursor((nowSeconds() + YEAR_S) * 1000);
		useGraph([conversation('honest', T0)]);

		await sync();

		expect(storedConversationIds()).toEqual(['honest']);
		expect(await storedCursor()).toBe(T0 * 1000);
	});
});

describe('syncWithRemote — an answer it cannot use, or no answer', () => {
	beforeEach(async () => {
		vi.resetModules();
		graphRequestMock.mockReset();
		captureExceptionMock.mockReset();
		vi.stubEnv('VITE_THE_GRAPH_API_URL', GRAPH_URL);
		vi.stubEnv('VITE_STORAGE_GATEWAY_URL', GATEWAY);
		store.conversations.clear();
		store.messageCache.clear();
		store.userMetadata.clear();
		store.conversationBulkPuts.length = 0;
		store.metadataPuts = 0;
		sessionKey = await deriveKeyFromEntropy('test-sig-0xpaging', OWNER);
		payloads = new Map([
			[CONV_CID, { title: 'Conversation' }],
			[META_CID, { metadata: true }],
		]);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				const encrypted = await encryptData(
					sessionKey,
					payloads.get(url.slice(GATEWAY.length)) ?? {},
				);
				return { ok: true, status: 200, text: async () => encrypted };
			}),
		);
		await storeCursor(5_000);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	const expectNothingStoredAndCursorHeld = async () => {
		expect(store.conversationBulkPuts).toHaveLength(0);
		expect(store.messageCache.size).toBe(0);
		expect(store.metadataPuts).toBe(0);
		expect(await storedCursor()).toBe(5_000);
	};

	// Read as an empty list, a missing list would move the cursor up to the present and skip
	// everything not yet read.
	it.each([
		['no conversations list at all', {}],
		['a null conversations list', { conversations: null }],
	])('stores nothing and holds the cursor for %s', async (_label, answer) => {
		graphRequestMock.mockResolvedValue(answer);

		const result = await sync();

		await expectNothingStoredAndCursorHeld();
		expect(result).toMatchObject({ graphUnavailable: true });
	});

	it.each([
		['messages', { promptRequests: [] }],
		['prompt requests', { messages: [] }],
	])(
		'stores nothing and holds the cursor when a conversation comes without its %s',
		async (_label, lists) => {
			const { messages: _m, promptRequests: _p, ...bare } = conversation('c1', T0 + 1);
			graphRequestMock.mockResolvedValue({ conversations: [{ ...bare, ...lists }] });

			const result = await sync();

			await expectNothingStoredAndCursorHeld();
			expect(result).toMatchObject({ graphUnavailable: true });
		},
	);

	// A build with no Graph endpoint can never read the history: that is a failure to tell, and
	// the cursor must not move, or a later build that has one would skip what came before.
	it('holds the cursor and says so when no Graph endpoint is configured', async () => {
		vi.stubEnv('VITE_THE_GRAPH_API_URL', '');

		const result = await sync();

		expect(graphRequestMock).not.toHaveBeenCalled();
		await expectNothingStoredAndCursorHeld();
		expect(result).toMatchObject({ graphUnavailable: true });
	});

	it('says the Graph could not be read when a request fails, and that it could after a clean pass', async () => {
		graphRequestMock.mockRejectedValueOnce(new Error('Failed to fetch'));
		expect(await sync()).toMatchObject({ graphUnavailable: true });

		useGraph([conversation('c1', T0 + 1)]);
		expect(await sync()).toMatchObject({ graphUnavailable: false });
	});

	// A pass that fails on this device before The Graph is asked knows nothing about The Graph:
	// saying it was read would take the notice down (and re-arm it) with nothing refreshed.
	it('says nothing about The Graph when the pass fails before asking it', async () => {
		graphRequestMock.mockRejectedValueOnce(new Error('Failed to fetch'));
		expect(await sync()).toMatchObject({ graphUnavailable: true });

		vi.spyOn(store.userMetadata, 'get').mockImplementationOnce(() => {
			throw new Error('The database connection is closing.');
		});
		graphRequestMock.mockClear();
		const result = await sync();

		expect(graphRequestMock).not.toHaveBeenCalled();
		expect(result.graphUnavailable).toBeUndefined();
		expect(result).toHaveProperty('unavailablePayloads', undefined);
	});

	// A pass that stops at The Graph reads no payload, so it says nothing about storage: a count
	// of 0 would take a storage notice the user dismissed down and bring it back next pass.
	it('says nothing about storage when the pass stops at The Graph', async () => {
		graphRequestMock.mockRejectedValueOnce(new Error('Failed to fetch'));

		const result = await sync();

		expect(result.graphUnavailable).toBe(true);
		expect(result).toHaveProperty('unavailablePayloads', undefined);
	});

	it('reports a failed read to Sentry once per page load per list and reason, by name only', async () => {
		graphRequestMock.mockRejectedValue(
			new TypeError(`request to ${GRAPH_URL} failed for owner ${OWNER}`),
		);
		const { default: syncWithRemote } = await import('./syncService');

		await syncWithRemote(sessionKey, OWNER);
		await syncWithRemote(sessionKey, OWNER);

		expect(captureExceptionMock).toHaveBeenCalledTimes(1);
		const [error, context] = captureExceptionMock.mock.calls[0];
		expect(context).toEqual(
			expect.objectContaining({
				tags: expect.objectContaining({
					check: 'graph-sync',
					list: 'conversations',
					reason: 'request',
				}),
				extra: { errorName: 'TypeError' },
			}),
		);
		const sent = JSON.stringify([String(error), (error as Error).stack ?? '', context]);
		expect(sent).not.toContain('localhost');
		expect(sent).not.toContain(OWNER);

		// Another reason is a new report.
		graphRequestMock.mockResolvedValue({});
		await syncWithRemote(sessionKey, OWNER);
		expect(captureExceptionMock).toHaveBeenCalledTimes(2);
		expect(captureExceptionMock.mock.calls[1][1]).toEqual(
			expect.objectContaining({
				tags: expect.objectContaining({ list: 'conversations', reason: 'malformed' }),
			}),
		);
	});
});

describe('syncWithRemote — fetching payloads', () => {
	beforeEach(async () => {
		vi.resetModules();
		graphRequestMock.mockReset();
		captureExceptionMock.mockReset();
		vi.stubEnv('VITE_THE_GRAPH_API_URL', GRAPH_URL);
		vi.stubEnv('VITE_STORAGE_GATEWAY_URL', GATEWAY);
		store.conversations.clear();
		store.messageCache.clear();
		store.userMetadata.clear();
		store.conversationBulkPuts.length = 0;
		store.metadataPuts = 0;
		sessionKey = await deriveKeyFromEntropy('test-sig-0xpaging', OWNER);
		payloads = new Map([
			[CONV_CID, { title: 'Conversation' }],
			[META_CID, { metadata: true }],
		]);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	// A first sync of a large wallet must not start every payload fetch at once: a gateway
	// answers a burst with 429, which holds the cursor, and the same burst comes back next pass.
	it('has no more than a few payload fetches out at once, and stores the same', async () => {
		let inFlight = 0;
		let mostAtOnce = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				inFlight += 1;
				mostAtOnce = Math.max(mostAtOnce, inFlight);
				const encrypted = await encryptData(
					sessionKey,
					payloads.get(url.slice(GATEWAY.length)) ?? {},
				);
				await new Promise(resolve => {
					setTimeout(resolve, 1);
				});
				inFlight -= 1;
				return { ok: true, status: 200, text: async () => encrypted };
			}),
		);
		useGraph(
			Array.from({ length: 5 }, (_, i) =>
				conversation(`c${i}`, T0 + 100 * (i + 1), {
					messages: messagesOf(`c${i}`, 50 * i + 1, 50 * i + 50),
				}),
			),
		);
		const { PAYLOAD_FETCH_CONCURRENCY, default: syncWithRemote } = await import('./syncService');

		await syncWithRemote(sessionKey, OWNER);

		expect(PAYLOAD_FETCH_CONCURRENCY).toBeGreaterThan(1);
		expect(mostAtOnce).toBeLessThanOrEqual(PAYLOAD_FETCH_CONCURRENCY);
		expect(mostAtOnce).toBeGreaterThan(1);
		const counts = await Promise.all(
			[0, 1, 2, 3, 4].map(async i => (await storedMessages(`c${i}`)).map(m => m.id)),
		);
		counts.forEach((ids, i) =>
			expect(ids).toEqual(Array.from({ length: 50 }, (_, j) => String(50 * i + j + 1))),
		);
	});
});
