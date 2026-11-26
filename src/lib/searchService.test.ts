import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveKeyFromEntropy, encryptData } from '@/lib/crypto';
import db from '@/lib/db';
import {
	initializeSearch,
	mergeSearchIndexDeltas,
	search,
	teardownSearch,
} from '@/lib/searchService';

vi.mock('@/lib/db', () => ({
	default: {
		conversations: { where: vi.fn() },
		messageCache: { where: vi.fn() },
		searchIndex: { get: vi.fn(), put: vi.fn() },
		userMetadata: { get: vi.fn(), put: vi.fn() },
	},
}));

const mockDb = db as any;
const OWNER = '0xabc123def456abc123def456abc123def456abc1';

// Rows written under another session key (an earlier signed message, for one) cannot be
// read with this one. Search is built from what can be read, and the rest is left out.
describe('search over rows stored under another key', () => {
	let sessionKey: CryptoKey;
	let otherKey: CryptoKey;

	beforeEach(async () => {
		vi.clearAllMocks();
		sessionKey = await deriveKeyFromEntropy('this-signature', OWNER);
		otherKey = await deriveKeyFromEntropy('another-signature', OWNER);
		mockDb.userMetadata.get.mockResolvedValue(undefined);
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		teardownSearch();
		vi.restoreAllMocks();
	});

	it('indexes the conversations that can be read', async () => {
		mockDb.conversations.where.mockReturnValue({
			toArray: vi
				.fn()
				.mockResolvedValue([
					{ encryptedData: await encryptData(sessionKey, { id: 'c1', title: 'Bitcoin outlook' }) },
					{ encryptedData: await encryptData(otherKey, { id: 'old', title: 'Bitcoin history' }) },
				]),
		});
		mockDb.messageCache.where.mockReturnValue({
			toArray: vi.fn().mockResolvedValue([
				{
					encryptedData: await encryptData(sessionKey, [
						{ id: 'm1', conversationId: 'c1', role: 'user', content: 'bitcoin price' },
					]),
				},
				{
					encryptedData: await encryptData(otherKey, [
						{ id: 'm0', conversationId: 'old', role: 'user', content: 'bitcoin price' },
					]),
				},
			]),
		});

		await initializeSearch(sessionKey, OWNER);

		expect(search('bitcoin')).toEqual(['c1']);
		expect(mockDb.searchIndex.put).toHaveBeenCalledTimes(1);
	});

	it('starts the index again from the new entries when the stored one cannot be read', async () => {
		mockDb.searchIndex.get.mockResolvedValue({
			encryptedData: await encryptData(otherKey, {
				m: { m0: { cid: 'old', c: 'ethereum' } },
				c: {},
			}),
		});

		await mergeSearchIndexDeltas(sessionKey, OWNER, [{ m9: { cid: 'c9', c: 'ethereum' } }]);

		expect(search('ethereum')).toEqual(['c9']);
		expect(mockDb.searchIndex.put).toHaveBeenCalledTimes(1);
	});

	// Anything but a failure to decrypt is a fault: the index is not rebuilt from part of the
	// rows, and the stored index is not replaced.
	it('does not rebuild the index when a row fails for another reason', async () => {
		mockDb.conversations.where.mockReturnValue({
			toArray: vi
				.fn()
				.mockResolvedValue([
					{ encryptedData: await encryptData(sessionKey, { id: 'c1', title: 'Bitcoin outlook' }) },
					{ encryptedData: 42 },
				]),
		});
		mockDb.messageCache.where.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

		await initializeSearch(sessionKey, OWNER);

		expect(mockDb.searchIndex.put).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalledWith(
			'Failed to sync search index:',
			expect.any(TypeError),
		);
	});

	it('does not replace the stored index when it fails for another reason', async () => {
		mockDb.searchIndex.get.mockResolvedValue({ encryptedData: 42 });

		await mergeSearchIndexDeltas(sessionKey, OWNER, [{ m9: { cid: 'c9', c: 'ethereum' } }]);

		expect(mockDb.searchIndex.put).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalledWith(
			'[searchService] Failed to merge search index deltas:',
			expect.any(TypeError),
		);
	});
});
