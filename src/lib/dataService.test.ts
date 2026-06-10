import { beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/db';

import { deriveKeyFromEntropy, encryptData } from './crypto';
import {
	deleteConversation,
	deleteMessageFromConversation,
	fetchAndCacheConversations,
	getConversation,
	getMessagesForConversation,
	renameConversation,
} from './dataService';

const mockDb = db as any;

vi.mock('@/lib/db', () => {
	const conversations = {
		where: vi.fn(),
		get: vi.fn(),
		put: vi.fn(),
	};
	const messageCache = {
		get: vi.fn(),
		put: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		where: vi.fn(),
	};
	return {
		default: { conversations, messageCache },
	};
});

vi.mock('@/lib/searchService', () => ({
	indexConversations: vi.fn(),
	addDeltaToLiveIndex: vi.fn(),
	removeConversationFromLiveIndex: vi.fn(),
	updateTitleInLiveIndex: vi.fn(),
	search: vi.fn(),
}));

const ENTROPY = 'test-sig-0xdeadbeef';
const OWNER = '0xabc123def456abc123def456abc123def456abc1';

describe('fetchAndCacheConversations', () => {
	let sessionKey: CryptoKey;

	beforeEach(async () => {
		sessionKey = await deriveKeyFromEntropy(ENTROPY, OWNER);
		vi.clearAllMocks();
	});

	it('decrypts conversations and returns them sorted by lastMessageCreatedAt', async () => {
		const conversations = [
			{ id: 'c1', ownerAddress: OWNER, isDeleted: false, lastMessageCreatedAt: 1000 },
			{ id: 'c2', ownerAddress: OWNER, isDeleted: false, lastMessageCreatedAt: 2000 },
		];

		const encrypted = await Promise.all(
			conversations.map(async c => ({
				id: c.id,
				ownerAddress: c.ownerAddress,
				encryptedData: await encryptData(sessionKey, c),
			})),
		);

		mockDb.conversations.where.mockReturnValue({ toArray: vi.fn().mockResolvedValue(encrypted) });

		const result = await fetchAndCacheConversations(sessionKey, OWNER);

		expect(result).toHaveLength(2);
		expect(result[0].id).toBe('c2');
		expect(result[1].id).toBe('c1');
	});

	it('filters out soft-deleted conversations', async () => {
		const conversations = [
			{ id: 'c1', ownerAddress: OWNER, isDeleted: false, lastMessageCreatedAt: 1000 },
			{ id: 'c2', ownerAddress: OWNER, isDeleted: true, lastMessageCreatedAt: 2000 },
		];

		const encrypted = await Promise.all(
			conversations.map(async c => ({
				id: c.id,
				ownerAddress: c.ownerAddress,
				encryptedData: await encryptData(sessionKey, c),
			})),
		);

		mockDb.conversations.where.mockReturnValue({ toArray: vi.fn().mockResolvedValue(encrypted) });

		const result = await fetchAndCacheConversations(sessionKey, OWNER);

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('c1');
	});

	it('returns empty array when no conversations exist', async () => {
		mockDb.conversations.where.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

		const result = await fetchAndCacheConversations(sessionKey, OWNER);

		expect(result).toEqual([]);
	});

	it('returns empty array when sessionKey is null', async () => {
		const result = await fetchAndCacheConversations(null as any, OWNER);
		expect(result).toEqual([]);
	});

	it('returns empty array when ownerAddress is empty', async () => {
		const result = await fetchAndCacheConversations(sessionKey, '');
		expect(result).toEqual([]);
	});
});

describe('getMessagesForConversation', () => {
	let sessionKey: CryptoKey;

	beforeEach(async () => {
		sessionKey = await deriveKeyFromEntropy(ENTROPY, OWNER);
		vi.clearAllMocks();
	});

	it('returns sorted messages from cache on cache hit', async () => {
		const messages = [
			{ id: 'm2', conversationId: 'c1', role: 'assistant', content: 'hi', createdAt: 2000 },
			{ id: 'm1', conversationId: 'c1', role: 'user', content: 'hello', createdAt: 1000 },
		];

		const encrypted = await encryptData(sessionKey, messages);
		mockDb.messageCache.get.mockResolvedValue({
			ownerAddress: OWNER,
			conversationId: 'c1',
			encryptedData: encrypted,
		});
		mockDb.messageCache.update.mockResolvedValue(undefined);

		const result = await getMessagesForConversation(sessionKey, OWNER, 'c1');

		expect(result).toHaveLength(2);
		expect(result[0].createdAt).toBe(1000);
		expect(result[1].createdAt).toBe(2000);
	});

	it('collapses duplicate ids, keeping the content-bearing version', async () => {
		// Repro for the stuck-"Thinking…" bug (CU-86d39wcfn): the cache can hold two
		// entries with the same id — a content-less placeholder and the hydrated answer.
		// Without dedup, the content-less one can render last and leave isAiThinking stuck.
		// getMessagesForConversation must collapse them to the richest-content version.
		const messages = [
			{ id: 'm1', conversationId: 'c1', role: 'user', content: 'hello', createdAt: 1000 },
			{ id: 'm2', conversationId: 'c1', role: 'assistant', content: 'the answer', createdAt: 2000 },
			{ id: 'm2', conversationId: 'c1', role: 'assistant', content: '', createdAt: 2000 },
		];

		const encrypted = await encryptData(sessionKey, messages);
		mockDb.messageCache.get.mockResolvedValue({
			ownerAddress: OWNER,
			conversationId: 'c1',
			encryptedData: encrypted,
		});
		mockDb.messageCache.update.mockResolvedValue(undefined);

		const result = await getMessagesForConversation(sessionKey, OWNER, 'c1');

		expect(result).toHaveLength(2);
		const assistant = result.find(m => m.id === 'm2');
		expect(assistant?.content).toBe('the answer');
	});

	it('collapses duplicate ids regardless of order — placeholder appended first', async () => {
		// The actual production order: the optimistic content-less placeholder is written
		// first, then the hydrated answer arrives later. Locks in that ordering too.
		const messages = [
			{ id: 'm2', conversationId: 'c1', role: 'assistant', content: '', createdAt: 2000 },
			{ id: 'm2', conversationId: 'c1', role: 'assistant', content: 'the answer', createdAt: 2000 },
			{ id: 'm1', conversationId: 'c1', role: 'user', content: 'hello', createdAt: 1000 },
		];

		const encrypted = await encryptData(sessionKey, messages);
		mockDb.messageCache.get.mockResolvedValue({
			ownerAddress: OWNER,
			conversationId: 'c1',
			encryptedData: encrypted,
		});
		mockDb.messageCache.update.mockResolvedValue(undefined);

		const result = await getMessagesForConversation(sessionKey, OWNER, 'c1');

		expect(result).toHaveLength(2);
		expect(result.find(m => m.id === 'm2')?.content).toBe('the answer');
		// Cache-heal fired (a duplicate was collapsed): the deduped blob was written back.
		expect(mockDb.messageCache.update).toHaveBeenCalledWith(
			[OWNER, 'c1'],
			expect.objectContaining({ encryptedData: expect.any(String) }),
		);
	});

	it('returns empty array on cache miss', async () => {
		mockDb.messageCache.get.mockResolvedValue(null);

		const result = await getMessagesForConversation(sessionKey, OWNER, 'c1');

		expect(result).toEqual([]);
	});

	it('returns empty array when sessionKey is null', async () => {
		const result = await getMessagesForConversation(null as any, OWNER, 'c1');
		expect(result).toEqual([]);
	});

	it('returns empty array when conversationId is empty', async () => {
		const result = await getMessagesForConversation(sessionKey, OWNER, '');
		expect(result).toEqual([]);
	});
});

describe('getConversation', () => {
	let sessionKey: CryptoKey;

	beforeEach(async () => {
		sessionKey = await deriveKeyFromEntropy(ENTROPY, OWNER);
		vi.clearAllMocks();
	});

	it('returns decrypted conversation when found', async () => {
		const conv = { id: 'c1', ownerAddress: OWNER, title: 'Test', isDeleted: false };
		const encrypted = await encryptData(sessionKey, conv);
		mockDb.conversations.get.mockResolvedValue({
			ownerAddress: OWNER,
			id: 'c1',
			encryptedData: encrypted,
		});

		const result = await getConversation(sessionKey, OWNER, 'c1');

		expect(result).toEqual(conv);
	});

	it('returns null when conversation not found', async () => {
		mockDb.conversations.get.mockResolvedValue(null);

		const result = await getConversation(sessionKey, OWNER, 'nonexistent');

		expect(result).toBeNull();
	});

	it('returns null when sessionKey is null', async () => {
		const result = await getConversation(null as any, OWNER, 'c1');
		expect(result).toBeNull();
	});

	it('returns null when conversationId is empty', async () => {
		const result = await getConversation(sessionKey, OWNER, '');
		expect(result).toBeNull();
	});
});

describe('renameConversation', () => {
	let sessionKey: CryptoKey;
	const mockQueryClient = { invalidateQueries: vi.fn() } as any;

	beforeEach(async () => {
		sessionKey = await deriveKeyFromEntropy(ENTROPY, OWNER);
		vi.clearAllMocks();
	});

	it('renames conversation and returns updated record', async () => {
		const conv = { id: 'c1', ownerAddress: OWNER, title: 'Old Title', lastUpdatedAt: 1000 };
		const encrypted = await encryptData(sessionKey, conv);
		mockDb.conversations.get.mockResolvedValue({
			ownerAddress: OWNER,
			id: 'c1',
			encryptedData: encrypted,
		});
		mockDb.conversations.put.mockResolvedValue(undefined);

		const result = await renameConversation(
			sessionKey,
			OWNER,
			{ id: 'c1', newTitle: 'New Title' },
			mockQueryClient,
		);

		expect(result.title).toBe('New Title');
		expect(result.lastUpdatedAt).toBeGreaterThan(1000);
		expect(mockDb.conversations.put).toHaveBeenCalledOnce();
		expect(mockQueryClient.invalidateQueries).toHaveBeenCalledOnce();
	});

	it('throws when conversation not found', async () => {
		mockDb.conversations.get.mockResolvedValue(null);

		await expect(
			renameConversation(sessionKey, OWNER, { id: 'missing', newTitle: 'X' }, mockQueryClient),
		).rejects.toThrow('Conversation with ID "missing" not found.');
	});
});

describe('deleteConversation', () => {
	let sessionKey: CryptoKey;
	const mockQueryClient = { invalidateQueries: vi.fn() } as any;

	beforeEach(async () => {
		sessionKey = await deriveKeyFromEntropy(ENTROPY, OWNER);
		vi.clearAllMocks();
	});

	it('soft-deletes conversation and clears message cache', async () => {
		const conv = { id: 'c1', ownerAddress: OWNER, title: 'Chat', isDeleted: false };
		const encrypted = await encryptData(sessionKey, conv);
		mockDb.conversations.get.mockResolvedValue({
			ownerAddress: OWNER,
			id: 'c1',
			encryptedData: encrypted,
		});
		mockDb.conversations.put.mockResolvedValue(undefined);
		mockDb.messageCache.delete.mockResolvedValue(undefined);

		const result = await deleteConversation(sessionKey, OWNER, 'c1', mockQueryClient);

		expect(result).toBe('c1');
		expect(mockDb.conversations.put).toHaveBeenCalledOnce();
		expect(mockDb.messageCache.delete).toHaveBeenCalledWith([OWNER, 'c1']);
		expect(mockQueryClient.invalidateQueries).toHaveBeenCalledOnce();
	});

	it('throws when conversation not found', async () => {
		mockDb.conversations.get.mockResolvedValue(null);

		await expect(deleteConversation(sessionKey, OWNER, 'missing', mockQueryClient)).rejects.toThrow(
			'Conversation with ID "missing" not found.',
		);
	});
});

describe('deleteMessageFromConversation', () => {
	let sessionKey: CryptoKey;
	const mockQueryClient = { invalidateQueries: vi.fn() } as any;

	beforeEach(async () => {
		sessionKey = await deriveKeyFromEntropy(ENTROPY, OWNER);
		vi.clearAllMocks();
	});

	it('removes a specific message and re-encrypts cache', async () => {
		const messages = [
			{ id: 'm1', conversationId: 'c1', role: 'user', content: 'hello', createdAt: 1000 },
			{ id: 'm2', conversationId: 'c1', role: 'assistant', content: null, createdAt: 2000 },
		];
		const encrypted = await encryptData(sessionKey, messages);
		mockDb.messageCache.get.mockResolvedValue({
			ownerAddress: OWNER,
			conversationId: 'c1',
			encryptedData: encrypted,
		});
		mockDb.messageCache.put.mockResolvedValue(undefined);

		// Mock for updateAndEncryptConversation
		const conv = { id: 'c1', ownerAddress: OWNER, title: 'Chat', lastMessagePreview: 'hello' };
		const encConv = await encryptData(sessionKey, conv);
		mockDb.conversations.get.mockResolvedValue({
			ownerAddress: OWNER,
			id: 'c1',
			encryptedData: encConv,
		});
		mockDb.conversations.put.mockResolvedValue(undefined);

		await deleteMessageFromConversation(sessionKey, OWNER, 'c1', 'm2', mockQueryClient);

		expect(mockDb.messageCache.put).toHaveBeenCalledOnce();
		expect(mockQueryClient.invalidateQueries).toHaveBeenCalled();
	});

	it('is a no-op when message cache is empty', async () => {
		mockDb.messageCache.get.mockResolvedValue(null);

		await deleteMessageFromConversation(sessionKey, OWNER, 'c1', 'm1', mockQueryClient);

		expect(mockDb.messageCache.put).not.toHaveBeenCalled();
	});
});
