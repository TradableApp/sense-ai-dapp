import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptData, deriveKeyFromEntropy, encryptData } from '@/lib/crypto';
import { mergeSearchIndexDeltas } from '@/lib/searchService';
import {
	createFakeGraph,
	fakeCid,
	type FakeConversation,
	type FakeMessage,
} from '@/test/fakeGraph';

// A file served for one slot (a conversation, a message, a message's search delta) must name
// that slot: the indexer chooses which file each slot points at, and the storage hosts serve
// the bytes, so neither is taken at its word. The Graph is the fake in src/test/fakeGraph.ts;
// the local store is an in-memory copy of the tables the sync writes, so what was stored can be
// read back.

const { graphRequestMock, captureExceptionMock, captureMessageMock, store } = vi.hoisted(() => ({
	graphRequestMock: vi.fn(),
	captureExceptionMock: vi.fn(),
	captureMessageMock: vi.fn(),
	store: {
		conversations: new Map<string, { id: string; encryptedData: string }>(),
		messageCache: new Map<string, { encryptedData: string }>(),
		userMetadata: new Map<string, { encryptedData: string }>(),
	},
}));

vi.mock('@sentry/react', () => ({
	addBreadcrumb: vi.fn(),
	captureMessage: captureMessageMock,
	captureException: captureExceptionMock,
}));

vi.mock('graphql-request', () => ({
	GraphQLClient: class {
		request = graphRequestMock;
	},
	gql: (strings: TemplateStringsArray, ...exprs: unknown[]) =>
		strings.reduce((acc, s, i) => acc + s + (i < exprs.length ? String(exprs[i]) : ''), ''),
}));

vi.mock('@/lib/searchService', () => ({ mergeSearchIndexDeltas: vi.fn() }));

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
					store.userMetadata.set(row.ownerAddress, row);
				},
			},
			transaction: async (_mode: string, _table: unknown, body: () => Promise<unknown>) => body(),
		},
	};
});

const OWNER = '0xabc123def456abc123def456abc123def456abc1';
const GATEWAY = 'http://localhost:8080/ipfs/';
const T0 = 1_700_000_000;
const CONV = 'c1';
const CONV_CID = fakeCid('conv', 1);
const META_CID = fakeCid('meta', 1);
const MSG_CID = fakeCid('msg', 1);
const DELTA_CID = fakeCid('delta', 1);

let sessionKey: CryptoKey;
/** What the storage gateway serves, by CID, before encryption. */
let payloads: Map<string, unknown>;
/** The files every storage source answers 503 for. */
const down = new Set<string>();

/** The files the oracle writes for conversation c1 and its message 1, as it writes them. */
function honestFiles(): Map<string, unknown> {
	return new Map<string, unknown>([
		[CONV_CID, { id: CONV, ownerAddress: OWNER, createdAt: T0 * 1000 }],
		[META_CID, { title: 'Conversation', isDeleted: false, lastUpdatedAt: T0 * 1000 }],
		[
			MSG_CID,
			{
				id: '1',
				conversationId: CONV,
				parentId: null,
				parentCID: null,
				createdAt: T0 * 1000,
				role: 'user',
				content: 'message 1',
			},
		],
		[DELTA_CID, { 1: { cid: CONV, c: 'message' } }],
	]);
}

function serveConversation(): void {
	const message = {
		id: '1',
		messageCID: MSG_CID,
		createdAt: String(T0),
		searchDelta: { searchDeltaCID: DELTA_CID },
	} as unknown as FakeMessage;
	const conversation: FakeConversation = {
		id: CONV,
		conversationCID: CONV_CID,
		conversationMetadataCID: META_CID,
		lastMessageCreatedAt: String(T0),
		messages: [message],
		promptRequests: [],
	};
	graphRequestMock.mockImplementation(createFakeGraph([conversation]).request);
}

async function storedMessages(conversationId: string): Promise<Array<Record<string, unknown>>> {
	const row = store.messageCache.get(JSON.stringify([OWNER, conversationId]));
	return row ? decryptData(sessionKey, row.encryptedData) : [];
}

async function storedCursor(): Promise<number | undefined> {
	const row = store.userMetadata.get(OWNER);
	if (!row) return undefined;
	return (await decryptData(sessionKey, row.encryptedData)).conversationsLastSyncedAt;
}

async function storedConversation(id: string): Promise<Record<string, unknown> | undefined> {
	const row = store.conversations.get(JSON.stringify([OWNER, id]));
	return row ? decryptData(sessionKey, row.encryptedData) : undefined;
}

const storedConversationIds = () => [...store.conversations.values()].map(row => row.id);

async function sync() {
	const { default: syncWithRemote } = await import('./syncService');
	return syncWithRemote(sessionKey, OWNER);
}

/** The kinds reported as a file that does not name its slot. */
const reportedMismatches = () =>
	captureExceptionMock.mock.calls
		.map(([, context]) => (context as { tags?: Record<string, string> })?.tags ?? {})
		.filter(tags => tags.check === 'stored-file')
		.map(tags => tags.mismatch);

beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.stubEnv('VITE_THE_GRAPH_API_URL', 'http://localhost:8000/subgraphs/name/senseai');
	vi.stubEnv('VITE_STORAGE_GATEWAY_URL', GATEWAY);
	store.conversations.clear();
	store.messageCache.clear();
	store.userMetadata.clear();
	sessionKey = await deriveKeyFromEntropy('test-sig-0xslots', OWNER);
	payloads = honestFiles();
	down.clear();
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (down.has(url.slice(GATEWAY.length))) {
				return { ok: false, status: 503, text: async () => '' };
			}
			const payload = payloads.get(url.slice(GATEWAY.length));
			if (payload === undefined) return { ok: false, status: 404, text: async () => '' };
			const encrypted = await encryptData(sessionKey, payload);
			return { ok: true, status: 200, text: async () => encrypted };
		}),
	);
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	serveConversation();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('files that name the slot they were fetched for', () => {
	it('are stored, and the cursor moves', async () => {
		const result = await sync();

		expect(result.unavailablePayloads).toBe(0);
		expect(storedConversationIds()).toEqual([CONV]);
		expect((await storedMessages(CONV)).map(m => m.content)).toEqual(['message 1']);
		expect(mergeSearchIndexDeltas).toHaveBeenCalledWith(sessionKey, OWNER, [
			{ 1: { cid: CONV, c: 'message' } },
		]);
		expect(await storedCursor()).toBe(T0 * 1000);
		expect(reportedMismatches()).toEqual([]);
	});
});

describe('a message file that names another slot', () => {
	it.each([
		['another message', { id: '2' }],
		['another conversation', { conversationId: 'c9' }],
		['no message', { id: undefined }],
		['no conversation', { conversationId: undefined }],
	])('naming %s is not stored, and the cursor is held', async (_name, change) => {
		payloads.set(MSG_CID, { ...(honestFiles().get(MSG_CID) as object), ...change });

		const result = await sync();

		expect(result.unavailablePayloads).toBe(1);
		expect(await storedMessages(CONV)).toEqual([]);
		expect(await storedCursor()).toBeUndefined();
		expect(reportedMismatches()).toEqual(['message']);
	});

	// The cache key is the conversation the file was asked for, never the one it names: also
	// when the conversation record is not written this pass (a newer one is stored here).
	it('is never stored under the conversation it names', async () => {
		payloads.set(MSG_CID, { ...(honestFiles().get(MSG_CID) as object), conversationId: 'c9' });
		const newerHere = { id: CONV, conversationCID: 'older', lastUpdatedAt: T0 * 1000 + 1 };
		store.conversations.set(JSON.stringify([OWNER, CONV]), {
			id: CONV,
			encryptedData: await encryptData(sessionKey, newerHere),
		});

		await sync();

		expect(store.messageCache.has(JSON.stringify([OWNER, 'c9']))).toBe(false);
	});
});

describe('a conversation file that names another conversation', () => {
	it.each([
		['another conversation', { id: 'c9' }],
		['no conversation', { id: undefined }],
	])('naming %s is not stored, and the cursor is held', async (_name, change) => {
		payloads.set(CONV_CID, { ...(honestFiles().get(CONV_CID) as object), ...change });

		const result = await sync();

		expect(result.unavailablePayloads).toBe(1);
		expect(storedConversationIds()).toEqual([]);
		expect(await storedCursor()).toBeUndefined();
		expect(reportedMismatches()).toEqual(['conversation']);
	});
});

describe('a search delta that names another slot', () => {
	it.each([
		['another message', { 2: { cid: CONV, c: 'message' } }],
		['another conversation', { 1: { cid: 'c9', c: 'message' } }],
		[
			'a second message beside its own',
			{ 1: { cid: CONV, c: 'message' }, 2: { cid: CONV, c: 'other' } },
		],
	])('naming %s is not merged, and the cursor is held', async (_name, delta) => {
		payloads.set(DELTA_CID, delta);

		const result = await sync();

		expect(result.unavailablePayloads).toBe(1);
		expect(mergeSearchIndexDeltas).not.toHaveBeenCalled();
		expect(await storedCursor()).toBeUndefined();
		expect(reportedMismatches()).toEqual(['search-delta']);
	});
});

describe('a file that does not name its slot, served on every pass', () => {
	it('is reported once per page load per kind, with the kind only', async () => {
		payloads.set(MSG_CID, { ...(honestFiles().get(MSG_CID) as object), id: '2' });

		await sync();
		await sync();

		expect(reportedMismatches()).toEqual(['message']);
		const sent = JSON.stringify(captureExceptionMock.mock.calls);
		expect(sent).not.toContain(MSG_CID);
		expect(sent).not.toContain(OWNER);
		expect(sent).not.toContain('message 1');
	});
});

// A conversation's record is what lets a later pass skip it. One whose files did not all
// arrive must be asked for again on every pass until they do, not only on the next one.
describe('a conversation whose files did not all arrive', () => {
	it('is asked for again on every pass while a file does not name its slot', async () => {
		payloads.set(MSG_CID, { ...(honestFiles().get(MSG_CID) as object), id: '2' });

		await sync();
		const second = await sync();
		const third = await sync();

		expect(second.unavailablePayloads).toBe(1);
		expect(third.unavailablePayloads).toBe(1);
		expect(await storedCursor()).toBeUndefined();
	});

	it('gets the file once it is served, and only then does the cursor move', async () => {
		down.add(MSG_CID);
		const first = await sync();
		expect(first.unavailablePayloads).toBe(1);
		// Listed meanwhile, so the conversation is not missing from the history.
		expect(storedConversationIds()).toEqual([CONV]);

		down.clear();
		const second = await sync();

		expect(second.unavailablePayloads).toBe(0);
		expect((await storedMessages(CONV)).map(m => m.content)).toEqual(['message 1']);
		expect(await storedCursor()).toBe(T0 * 1000);
	});

	it('is skipped again once every file has arrived', async () => {
		down.add(MSG_CID);
		await sync();
		down.clear();
		await sync();
		vi.mocked(fetch).mockClear();

		await sync();

		expect(fetch).not.toHaveBeenCalled();
	});
});

// The metadata file holds a title, whether the conversation is deleted, and when that last
// changed. It carries no id, so only those three are taken from it, and a file of another
// kind served in its place is refused.
describe('a conversation metadata file', () => {
	it.each([
		['a conversation file', { id: 'c9', ownerAddress: OWNER, createdAt: 1 }],
		['a message file', { id: '7', conversationId: CONV, role: 'user', content: 'x' }],
		['a list', ['title']],
	])('that is %s is not stored, and the cursor is held', async (_name, file) => {
		payloads.set(META_CID, file);

		const result = await sync();

		expect(result.unavailablePayloads).toBe(1);
		expect(await storedCursor()).toBeUndefined();
		expect(reportedMismatches()).toEqual(['metadata']);
		expect((await storedConversation(CONV))?.title).toBeUndefined();
	});

	it('gives the record its three fields and nothing else', async () => {
		payloads.set(META_CID, {
			title: 'Renamed',
			isDeleted: true,
			lastUpdatedAt: T0 * 1000 + 5,
			createdAt: 1,
			branchedFromConversationId: 'c7',
			conversationCID: 'other',
		});

		await sync();

		const record = await storedConversation(CONV);
		expect(record).toMatchObject({
			id: CONV,
			title: 'Renamed',
			isDeleted: true,
			lastUpdatedAt: T0 * 1000 + 5,
			createdAt: T0 * 1000,
			conversationCID: CONV_CID,
		});
		expect(record).not.toHaveProperty('branchedFromConversationId');
	});

	it('leaves out a field of the wrong type', async () => {
		payloads.set(META_CID, { title: { a: 1 }, isDeleted: 'yes', lastUpdatedAt: T0 * 1000 });

		await sync();

		const record = await storedConversation(CONV);
		expect(record).not.toHaveProperty('title');
		expect(record).not.toHaveProperty('isDeleted');
		expect(record?.lastUpdatedAt).toBe(T0 * 1000);
	});
});
