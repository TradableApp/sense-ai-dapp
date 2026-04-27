// src/lib/searchService.js
import Fuse from 'fuse.js';
import { eng, removeStopwords } from 'stopword';

import { decryptData, encryptData } from './crypto';
import db from './db';
import type { Conversation, Message } from './types';

const SEARCH_INDEX_KEY = 'main';
const POLLING_INTERVAL = 5 * 60 * 1000; // 5 minutes

let fuseInstance: InstanceType<
	typeof Fuse<{
		messageId: string;
		conversationId: string;
		contentKeywords: string;
		titleKeywords: string;
	}>
> | null = null;
let pollingIntervalId: ReturnType<typeof setInterval> | null = null;
let inMemoryRawIndex: {
	m: Record<string, { cid: string; c: string }>;
	c: Record<string, { t: string }>;
} = { m: {}, c: {} };
let isSyncing = false;

function generateKeywords(content: string = ''): string {
	if (!content) return '';
	const tokens = content
		.toLowerCase()
		.replace(/\n/g, ' ')
		.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.split(' ');
	// Trim the final result to remove leading/trailing spaces
	return removeStopwords(tokens, eng).join(' ').trim();
}

const getLastSyncedAt = async (sessionKey: CryptoKey, ownerAddress: string): Promise<number> => {
	const metadataRecord = await db.userMetadata.get(ownerAddress);
	if (!metadataRecord) return 0;
	try {
		const decrypted = await decryptData(sessionKey, metadataRecord.encryptedData);
		return ((decrypted as Record<string, unknown>).searchLastSyncedAt as number) || 0;
	} catch (error) {
		console.error('Could not decrypt user metadata, starting sync from scratch.', error);
		return 0;
	}
};

const setLastSyncedAt = async (
	sessionKey: CryptoKey,
	ownerAddress: string,
	timestamp: number,
): Promise<void> => {
	let metadata: Record<string, unknown> = { searchLastSyncedAt: 0 };
	const existingRecord = await db.userMetadata.get(ownerAddress);
	if (existingRecord) {
		try {
			metadata = await decryptData(sessionKey, existingRecord.encryptedData);
		} catch (error) {
			console.error('Could not decrypt existing metadata to update it.', error);
		}
	}
	metadata.searchLastSyncedAt = timestamp;
	const encryptedMetadata = await encryptData(sessionKey, metadata);
	await db.userMetadata.put({ ownerAddress, encryptedData: encryptedMetadata });
};

const initializeFuse = (rawIndex: {
	m: Record<string, { cid: string; c: string }>;
	c: Record<string, { t: string }>;
}): void => {
	const searchableMessagesMap = rawIndex.m || {};
	const conversationTitlesMap = rawIndex.c || {};

	const fuseData = Object.entries(searchableMessagesMap).map(([msgId, messageData]) => {
		const convId = messageData.cid;
		const titleKeywords = conversationTitlesMap[convId]?.t || '';
		return {
			messageId: msgId,
			conversationId: convId,
			contentKeywords: messageData.c,
			titleKeywords,
		};
	});

	fuseInstance = new Fuse(fuseData, {
		keys: [
			{ name: 'titleKeywords', weight: 0.7 },
			{ name: 'contentKeywords', weight: 0.3 },
		],
		includeScore: true,
		threshold: 0.4,
		ignoreLocation: true,
	});
};

const syncSearchIndex = async (sessionKey: CryptoKey, ownerAddress: string): Promise<void> => {
	if (isSyncing) return;
	isSyncing = true;

	try {
		await getLastSyncedAt(sessionKey, ownerAddress);

		const allEncryptedConvos = await db.conversations.where({ ownerAddress }).toArray();
		const allEncryptedMessages = await db.messageCache.where({ ownerAddress }).toArray();

		const allConversations = await Promise.all(
			allEncryptedConvos.map(c => decryptData(sessionKey, c.encryptedData)),
		);
		const allMessagesNested = await Promise.all(
			allEncryptedMessages.map(m => decryptData(sessionKey, m.encryptedData)),
		);
		const allMessages = allMessagesNested.flat();

		const rawIndex: {
			m: Record<string, { cid: string; c: string }>;
			c: Record<string, { t: string }>;
		} = { m: {}, c: {} };

		allConversations.forEach((convo: Conversation) => {
			if (!convo.isDeleted) {
				rawIndex.c[convo.id] = { t: generateKeywords(convo.title) };
			}
		});

		allMessages.forEach((message: Message) => {
			if (message.role === 'user') {
				rawIndex.m[message.id] = {
					cid: message.conversationId,
					c: generateKeywords(message.content || ''),
				};
			}
		});

		const newEncryptedIndex = await encryptData(sessionKey, rawIndex);
		await db.searchIndex.put({
			ownerAddress,
			id: SEARCH_INDEX_KEY,
			encryptedData: newEncryptedIndex,
		});

		await setLastSyncedAt(sessionKey, ownerAddress, Date.now());

		inMemoryRawIndex = rawIndex;
		initializeFuse(inMemoryRawIndex);
	} catch (error) {
		console.error('Failed to sync search index:', error);
	} finally {
		isSyncing = false;
	}
};

/**
 * Merges new search index deltas from a sync operation into the main search index.
 * @param {CryptoKey} sessionKey The user's session key.
 * @param {string} ownerAddress The user's wallet address.
 * @param {Array<object>} deltas An array of decrypted SearchIndexDeltaFile objects.
 */
export const mergeSearchIndexDeltas = async (
	sessionKey: CryptoKey,
	ownerAddress: string,
	deltas: unknown[],
): Promise<void> => {
	if (!deltas || deltas.length === 0) {
		return;
	}

	try {
		// 1. Get the current consolidated search index
		const existingIndexRecord = await db.searchIndex.get([ownerAddress, SEARCH_INDEX_KEY]);
		let rawIndex = { m: {}, c: {} };

		if (existingIndexRecord) {
			rawIndex = await decryptData(sessionKey, existingIndexRecord.encryptedData);
		}

		// 2. Merge new deltas into the raw index
		deltas.forEach(delta => {
			if (delta) {
				// A SearchIndexDeltaFile is an object with one or more { messageKey: keywords } pairs
				Object.assign(rawIndex.m, delta);
			}
		});

		// 3. Encrypt and save the updated index
		const newEncryptedIndex = await encryptData(sessionKey, rawIndex);
		await db.searchIndex.put({
			ownerAddress,
			id: SEARCH_INDEX_KEY,
			encryptedData: newEncryptedIndex,
		});

		// 4. Update the in-memory instance for immediate use
		inMemoryRawIndex = rawIndex;
		initializeFuse(inMemoryRawIndex);
	} catch (error) {
		console.error('[searchService] Failed to merge search index deltas:', error);
	}
};

export const initializeSearch = async (
	sessionKey: CryptoKey,
	ownerAddress: string,
): Promise<void> => {
	if (!sessionKey || !ownerAddress) return;
	if (pollingIntervalId) clearInterval(pollingIntervalId);

	await syncSearchIndex(sessionKey, ownerAddress);
	pollingIntervalId = setInterval(
		() => syncSearchIndex(sessionKey, ownerAddress),
		POLLING_INTERVAL,
	);
};

export const search = (query: string): string[] => {
	if (!fuseInstance || !query) return [];
	// This ensures we are comparing keywords against keywords for accurate results.
	const keywordQuery = generateKeywords(query);
	const results = fuseInstance.search(keywordQuery);
	const conversationIds = results.map(result => result.item.conversationId as string);
	return [...new Set(conversationIds)] as string[];
};

export const teardownSearch = (): void => {
	if (pollingIntervalId) clearInterval(pollingIntervalId);
	pollingIntervalId = null;
	fuseInstance = null;
	inMemoryRawIndex = { m: {}, c: {} };
};

export const addDeltaToLiveIndex = (userMessage: Message, conversation: Conversation): void => {
	if (isSyncing) return;
	const keywords = generateKeywords(userMessage.content || '');
	inMemoryRawIndex.m[userMessage.id] = { cid: conversation.id, c: keywords };
	inMemoryRawIndex.c[conversation.id] = { t: generateKeywords(conversation.title) };
	initializeFuse(inMemoryRawIndex);
};

export const updateTitleInLiveIndex = (conversation: Conversation): void => {
	if (isSyncing) return;
	inMemoryRawIndex.c[conversation.id] = { t: generateKeywords(conversation.title) };
	initializeFuse(inMemoryRawIndex);
};

export const removeConversationFromLiveIndex = (conversationId: string): void => {
	if (isSyncing) return;
	delete inMemoryRawIndex.c[conversationId];
	const newMessageIndex = Object.entries(inMemoryRawIndex.m).filter(
		([, msgData]) => msgData.cid !== conversationId,
	);
	inMemoryRawIndex.m = Object.fromEntries(newMessageIndex);
	initializeFuse(inMemoryRawIndex);
};
