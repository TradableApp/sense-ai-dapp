import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deriveKeyFromEntropy, encryptData } from './crypto';

vi.mock('@/lib/db', () => {
	const conversations = {
		where: vi.fn(),
	};
	const messageCache = {
		get: vi.fn(),
		put: vi.fn(),
	};
	return {
		default: { conversations, messageCache },
	};
});

vi.mock('@/lib/searchService', () => ({
	indexConversations: vi.fn(),
	search: vi.fn(),
}));

import db from '@/lib/db';
import { fetchAndCacheConversations } from './dataService';

const ENTROPY = 'test-sig-0xdeadbeef';
const OWNER = '0xabc123def456abc123def456abc123def456abc1';

describe('fetchAndCacheConversations', () => {
	let sessionKey;

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

		db.conversations.where.mockReturnValue({ toArray: vi.fn().mockResolvedValue(encrypted) });

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

		db.conversations.where.mockReturnValue({ toArray: vi.fn().mockResolvedValue(encrypted) });

		const result = await fetchAndCacheConversations(sessionKey, OWNER);

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('c1');
	});

	it('returns empty array when no conversations exist', async () => {
		db.conversations.where.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

		const result = await fetchAndCacheConversations(sessionKey, OWNER);

		expect(result).toEqual([]);
	});
});
