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

const { graphRequestMock, store } = vi.hoisted(() => ({
	graphRequestMock: vi.fn(),
	store: {
		conversations: new Map<string, { id: string; encryptedData: string }>(),
		messageCache: new Map<string, { encryptedData: string }>(),
		userMetadata: new Map<string, { encryptedData: string }>(),
		conversationBulkPuts: [] as Array<Array<{ id: string }>>,
		metadataPuts: 0,
	},
}));

vi.mock('@sentry/react', () => ({ addBreadcrumb: vi.fn(), captureMessage: vi.fn() }));

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
				bulkPut: async (rows: Array<{ ownerAddress: string; id: string; encryptedData: string }>) => {
					store.conversationBulkPuts.push(rows);
					rows.forEach(row => store.conversations.set(key([row.ownerAddress, row.id]), row));
				},
			},
			messageCache: {
				get: async (parts: unknown) => store.messageCache.get(key(parts)),
				put: async (row: { ownerAddress: string; conversationId: string; encryptedData: string }) => {
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

function conversation(
	id: string,
	lastAt: number,
	lists: Partial<Pick<FakeConversation, 'messages' | 'promptRequests'>> = {},
): FakeConversation {
	return {
		id,
		conversationCID: CONV_CID,
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

async function sync() {
	const { default: syncWithRemote } = await import('./syncService');
	return syncWithRemote(sessionKey, OWNER);
}

describe('syncWithRemote — a full sync reads every page', () => {
	beforeEach(async () => {
		vi.resetModules();
		graphRequestMock.mockReset();
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
				const encrypted = await encryptData(sessionKey, payloads.get(url.slice(GATEWAY.length)) ?? {});
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
		const graph = useGraph([conversation('c1', T0 + 1200, { messages: messagesOf('c1', 1, 1200) })]);

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
		const graph = useGraph([
			conversation('c1', T0 + 1200, { promptRequests: await promptRequestsOf(1200) }),
		]);

		await sync();

		const ids = (await storedMessages('c1')).map(m => m.id);
		// One stored prompt per request, under its prompt id 1..1200.
		expect(new Set(ids).size).toBe(1200);
		// As for messages: 1000 nested (1200..201), then 201..1 in one short follow-up page.
		expect(graph.requests).toEqual(['GetUserUpdates', 'GetConversationPromptRequests']);
	});

	it('marks nothing synced and leaves the cursor alone when page 2 fails', async () => {
		const graph = createFakeGraph(
			Array.from({ length: 150 }, (_, i) => conversation(`c${i}`, T0 + i, { messages: messagesOf(`c${i}`, i + 1, i + 1) })),
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
		const counts = await Promise.all(['c1', 'c2', 'c3'].map(async id => (await storedMessages(id)).length));
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
});
