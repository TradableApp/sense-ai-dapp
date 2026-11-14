import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptData, deriveKeyFromEntropy, encryptData } from './crypto';
import { writeMessageCache } from './messageCacheStore';
import type { Message, MessageRecord } from './types';

/**
 * An in-memory stand-in for the messageCache table. `transaction` runs its body in one go, as
 * IndexedDB does: nothing else can write between a read and a put made inside it.
 */
const rows = vi.hoisted(() => new Map<string, unknown>());

vi.mock('@/lib/db', () => {
	const key = (owner: string, id: string) => `${owner}|${id}`;
	const messageCache = {
		get: vi.fn(async ([owner, id]: [string, string]) => rows.get(key(owner, id))),
		put: vi.fn(async (row: { ownerAddress: string; conversationId: string }) => {
			rows.set(key(row.ownerAddress, row.conversationId), row);
		}),
	};
	return {
		default: {
			messageCache,
			transaction: vi.fn(async (_mode: string, _table: unknown, body: () => Promise<unknown>) =>
				body(),
			),
		},
	};
});

const OWNER = '0xabc123def456abc123def456abc123def456abc1';
const CONVERSATION = '7';

const message = (id: string): Message =>
	({
		id,
		conversationId: CONVERSATION,
		role: 'user',
		content: `message ${id}`,
		createdAt: Number(id),
	} as Message);

describe('writeMessageCache — one writer for a conversation’s stored messages', () => {
	let sessionKey: CryptoKey;

	const stored = async (): Promise<Message[] | null> => {
		const row = rows.get(`${OWNER}|${CONVERSATION}`) as MessageRecord | undefined;
		return row ? ((await decryptData(sessionKey, row.encryptedData)) as Message[]) : null;
	};
	/** Another writer storing `messages`, as a sync or a prompt being sent would. */
	const writeElsewhere = async (messages: Message[]) => {
		rows.set(`${OWNER}|${CONVERSATION}`, {
			ownerAddress: OWNER,
			conversationId: CONVERSATION,
			encryptedData: await encryptData(sessionKey, messages),
			lastAccessedAt: 1,
		});
	};

	beforeEach(async () => {
		rows.clear();
		sessionKey = await deriveKeyFromEntropy('test-sig-0xdeadbeef', OWNER);
	});

	it('gives the merge nothing when no messages are stored, and stores what it returns', async () => {
		const merge = vi.fn(async (current: Message[] | null) => [...(current ?? []), message('1')]);

		const result = await writeMessageCache(sessionKey, OWNER, CONVERSATION, merge);

		expect(merge).toHaveBeenCalledWith(null);
		expect(result).toEqual([message('1')]);
		expect(await stored()).toEqual([message('1')]);
	});

	it('gives the merge the stored messages', async () => {
		await writeElsewhere([message('1')]);

		await writeMessageCache(sessionKey, OWNER, CONVERSATION, current => [
			...(current ?? []),
			message('2'),
		]);

		expect(await stored()).toEqual([message('1'), message('2')]);
	});

	it('does not lose a message another writer stored while this one was merging', async () => {
		await writeElsewhere([message('1')]);
		let calls = 0;

		await writeMessageCache(sessionKey, OWNER, CONVERSATION, async current => {
			calls += 1;
			// The first time round, a sync stores message 2 after this writer has read.
			if (calls === 1) await writeElsewhere([message('1'), message('2')]);
			return [...(current ?? []), message('3')];
		});

		// Merged again from what is stored now: 1 and 2 from the other writer, then 3.
		expect(calls).toBe(2);
		expect(await stored()).toEqual([message('1'), message('2'), message('3')]);
	});

	it('does not lose a first write another writer made while this one was merging', async () => {
		let calls = 0;

		await writeMessageCache(sessionKey, OWNER, CONVERSATION, async current => {
			calls += 1;
			if (calls === 1) await writeElsewhere([message('1')]);
			return [...(current ?? []), message('2')];
		});

		expect(await stored()).toEqual([message('1'), message('2')]);
	});

	it('writes nothing when the merge returns null, and returns what is stored', async () => {
		await writeElsewhere([message('1')]);
		const before = rows.get(`${OWNER}|${CONVERSATION}`);

		const result = await writeMessageCache(sessionKey, OWNER, CONVERSATION, () => null);

		expect(result).toEqual([message('1')]);
		expect(rows.get(`${OWNER}|${CONVERSATION}`)).toBe(before);
	});

	it('treats stored data that is not a list of messages as no messages', async () => {
		rows.set(`${OWNER}|${CONVERSATION}`, {
			ownerAddress: OWNER,
			conversationId: CONVERSATION,
			encryptedData: await encryptData(sessionKey, { not: 'a list' }),
			lastAccessedAt: 1,
		});

		await writeMessageCache(sessionKey, OWNER, CONVERSATION, current => [
			...(current ?? []),
			message('1'),
		]);

		expect(await stored()).toEqual([message('1')]);
	});

	it('treats stored data it cannot decrypt as no messages, so the write repairs it', async () => {
		rows.set(`${OWNER}|${CONVERSATION}`, {
			ownerAddress: OWNER,
			conversationId: CONVERSATION,
			encryptedData: 'not.ciphertext',
			lastAccessedAt: 1,
		});

		await writeMessageCache(sessionKey, OWNER, CONVERSATION, current => [
			...(current ?? []),
			message('1'),
		]);

		expect(await stored()).toEqual([message('1')]);
	});

	it('gives up with an error when the stored messages keep changing under it', async () => {
		let version = 0;

		await expect(
			writeMessageCache(sessionKey, OWNER, CONVERSATION, async current => {
				version += 1;
				await writeElsewhere([message(String(100 + version))]);
				return [...(current ?? []), message('1')];
			}),
		).rejects.toThrow(/kept changing/);
		// Five attempts, no more.
		expect(version).toBe(5);
	});
});
