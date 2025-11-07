/* eslint-disable import/prefer-default-export */
import { decryptData, encryptData } from './crypto';
import db from './db';
import simulateOracleProcess from './mockApi';
import {
	addDeltaToLiveIndex,
	removeConversationFromLiveIndex,
	updateTitleInLiveIndex,
} from './searchService';

const MESSAGE_CACHE_LIMIT = 5;

const updateAndEncryptConversation = async (sessionKey, ownerAddress, conversationId, messages) => {
	const convRecord = await db.conversations.get([ownerAddress, conversationId]);
	if (!convRecord) return null;

	const decryptedConv = await decryptData(sessionKey, convRecord.encryptedData);
	const lastMessage = messages.sort((a, b) => b.createdAt - a.createdAt)[0];

	if (lastMessage) {
		decryptedConv.lastMessageCreatedAt = lastMessage.createdAt;
		const isAiThinking = lastMessage.role === 'assistant' && !lastMessage.content;
		if (isAiThinking) {
			const parentMessage = messages.find(m => m.id === lastMessage.parentId);
			decryptedConv.lastMessagePreview = parentMessage?.content || '';
		} else {
			decryptedConv.lastMessagePreview = lastMessage.content || '';
		}
	}

	const encryptedConv = await encryptData(sessionKey, decryptedConv);
	await db.conversations.put({ ownerAddress, id: conversationId, encryptedData: encryptedConv });
	console.log(
		`[dataService] Updated conversation metadata in IndexedDB for "${conversationId}". Preview: "${decryptedConv.lastMessagePreview.substring(
			0,
			30,
		)}..."`,
	);

	const lastUserMessage = messages
		.filter(m => m.role === 'user')
		.sort((a, b) => b.createdAt - a.createdAt)[0];
	if (lastUserMessage) {
		addDeltaToLiveIndex(lastUserMessage, decryptedConv);
	}

	return decryptedConv;
};

const maintainMessageCache = async ownerAddress => {
	const cacheCount = await db.messageCache.where({ ownerAddress }).count();
	if (cacheCount > MESSAGE_CACHE_LIMIT) {
		// --- FIX: Removed the incorrect .orderBy() call. ---
		// The compound index '[ownerAddress+lastAccessedAt]' in db.js ensures
		// that the results from .where({ ownerAddress }) are already sorted
		// by lastAccessedAt in ascending order.
		const keysToDelete = await db.messageCache
			.where({ ownerAddress })
			.limit(cacheCount - MESSAGE_CACHE_LIMIT)
			.keys();
		await db.messageCache.bulkDelete(keysToDelete);
		console.log(`[dataService] Evicted ${keysToDelete.length} items from message cache.`);
	}
};

export const fetchAndCacheConversations = async (sessionKey, ownerAddress) => {
	if (!sessionKey || !ownerAddress) return [];
	const finalRecords = await db.conversations.where({ ownerAddress }).toArray();
	const decrypted = await Promise.all(
		finalRecords.map(c => decryptData(sessionKey, c.encryptedData)),
	);
	return decrypted
		.filter(c => !c.isDeleted)
		.sort((a, b) => (b.lastMessageCreatedAt || 0) - (a.lastMessageCreatedAt || 0));
};

export const getMessagesForConversation = async (sessionKey, ownerAddress, conversationId) => {
	if (!sessionKey || !ownerAddress || !conversationId) return [];

	const cachedRecord = await db.messageCache.get([ownerAddress, conversationId]);

	if (cachedRecord) {
		console.log(
			`%c[dataService-LOG] Cache HIT for messages in conversation "${conversationId}".`,
			'color: green',
		);
		await db.messageCache.update([ownerAddress, conversationId], { lastAccessedAt: Date.now() });
		const decryptedData = await decryptData(sessionKey, cachedRecord.encryptedData);
		console.log(
			`%c[dataService-LOG] Returning ${decryptedData.length} decrypted messages from cache.`,
			'color: green',
			decryptedData,
		);
		return decryptedData;
	}

	console.log(
		`%c[dataService-LOG] Cache MISS for messages in conversation "${conversationId}". Returning empty array.`,
		'color: red',
	);
	return [];
};

const createMessageWorkflow = async (
	sessionKey,
	ownerAddress,
	conversationId,
	existingMessages,
	userMessage,
	aiMessage,
	queryForOracle,
	answerMessageId,
	onReasoningStep,
	onFinalAnswer,
	regenerationMode,
	queryClient,
) => {
	const newMessages = userMessage
		? [...existingMessages, userMessage, aiMessage]
		: [...existingMessages, aiMessage];

	const encryptedMessages = await encryptData(sessionKey, newMessages);
	await db.messageCache.put({
		ownerAddress,
		conversationId,
		encryptedData: encryptedMessages,
		lastAccessedAt: Date.now(),
	});

	await updateAndEncryptConversation(sessionKey, ownerAddress, conversationId, newMessages);
	await maintainMessageCache(ownerAddress);

	const onFinalAnswerForDb = async (finalMessageId, finalAnswer) => {
		onFinalAnswer(finalMessageId, finalAnswer);

		const currentMessages = await getMessagesForConversation(
			sessionKey,
			ownerAddress,
			conversationId,
		);

		const finalMessages = currentMessages.map(m => {
			if (m.id === aiMessage.id) {
				return { ...m, ...finalAnswer };
			}
			return m;
		});

		const finalEncrypted = await encryptData(sessionKey, finalMessages);
		await db.messageCache.put({
			ownerAddress,
			conversationId,
			encryptedData: finalEncrypted,
			lastAccessedAt: Date.now(),
		});

		await updateAndEncryptConversation(sessionKey, ownerAddress, conversationId, finalMessages);

		console.log(
			'%c[dataService] Final answer stored. Invalidating queries to refresh UI.',
			'color: green; font-weight: bold;',
		);
		queryClient.invalidateQueries({ queryKey: ['conversations', sessionKey, ownerAddress] });
		queryClient.invalidateQueries({
			queryKey: ['messages', conversationId, sessionKey, ownerAddress],
		});
	};

	simulateOracleProcess(
		queryForOracle,
		answerMessageId,
		onReasoningStep,
		onFinalAnswerForDb,
		regenerationMode,
	);
};

export const addMessageToConversation = async (
	sessionKey,
	ownerAddress,
	conversationId,
	parentId,
	messageContent,
	answerMessageId,
	onReasoningStep,
	onFinalAnswer,
	queryClient,
) => {
	const now = Date.now();
	const finalUserMessage = {
		id: `msg_${now}`,
		conversationId,
		parentId,
		role: 'user',
		content: messageContent,
		createdAt: now,
	};
	const finalAiMessage = {
		id: `msg_${now + 1}`,
		conversationId,
		parentId: finalUserMessage.id,
		role: 'assistant',
		content: null,
		createdAt: now + 1,
		reasoning: [],
	};

	const existingMessages = await getMessagesForConversation(
		sessionKey,
		ownerAddress,
		conversationId,
	);

	await createMessageWorkflow(
		sessionKey,
		ownerAddress,
		conversationId,
		existingMessages,
		finalUserMessage,
		finalAiMessage,
		messageContent,
		answerMessageId,
		onReasoningStep,
		onFinalAnswer,
		null,
		queryClient,
	);

	queryClient.invalidateQueries({
		queryKey: ['messages', conversationId, sessionKey, ownerAddress],
	});

	return {
		finalUserMessage,
		finalAiMessage: { ...finalAiMessage, answerMessageId },
	};
};

export const createNewConversation = async (
	sessionKey,
	ownerAddress,
	firstMessageContent,
	answerMessageId,
	onReasoningStep,
	onFinalAnswer,
	queryClient,
) => {
	console.log('[dataService] Creating new conversation.');
	const now = Date.now();
	const newConversation = {
		id: `conv_${now}`,
		ownerAddress,
		createdAt: now,
		title: firstMessageContent.substring(0, 40) + (firstMessageContent.length > 40 ? '...' : ''),
		isDeleted: false,
		lastUpdatedAt: now,
		lastMessageCreatedAt: now,
		lastMessagePreview: firstMessageContent,
	};
	const encryptedConv = await encryptData(sessionKey, newConversation);
	await db.conversations.put({
		ownerAddress,
		id: newConversation.id,
		encryptedData: encryptedConv,
	});
	console.log(`[dataService] New conversation "${newConversation.id}" saved to IndexedDB.`);

	const { finalUserMessage, finalAiMessage } = await addMessageToConversation(
		sessionKey,
		ownerAddress,
		newConversation.id,
		null,
		firstMessageContent,
		answerMessageId,
		onReasoningStep,
		onFinalAnswer,
		queryClient,
	);
	queryClient.invalidateQueries({
		queryKey: ['messages', newConversation.id, sessionKey, ownerAddress],
	});
	return { newConversation, finalUserMessage, finalAiMessage };
};

export const renameConversation = async (sessionKey, ownerAddress, { id, newTitle }) => {
	console.log(`%c[dataService] Attempting to rename conv "${id}" to "${newTitle}"`, 'color: blue');
	const record = await db.conversations.get([ownerAddress, id]);
	if (!record) throw new Error(`Conversation with ID "${id}" not found.`);
	const decrypted = await decryptData(sessionKey, record.encryptedData);
	decrypted.title = newTitle;
	decrypted.lastUpdatedAt = Date.now();
	const encrypted = await encryptData(sessionKey, decrypted);
	await db.conversations.put({ ownerAddress, id, encryptedData: encrypted });
	updateTitleInLiveIndex(decrypted);
	console.log(`[dataService] Successfully renamed conv "${id}".`);
	return decrypted;
};

export const deleteConversation = async (sessionKey, ownerAddress, conversationId) => {
	console.log(`%c[dataService] Attempting to delete conv "${conversationId}"`, 'color: red');
	const record = await db.conversations.get([ownerAddress, conversationId]);
	if (!record) throw new Error(`Conversation with ID "${conversationId}" not found.`);
	const decrypted = await decryptData(sessionKey, record.encryptedData);
	decrypted.isDeleted = true;
	decrypted.lastUpdatedAt = Date.now();
	const encrypted = await encryptData(sessionKey, decrypted);
	await db.conversations.put({ ownerAddress, id: conversationId, encryptedData: encrypted });
	await db.messageCache.delete([ownerAddress, conversationId]);
	removeConversationFromLiveIndex(conversationId);
	console.log(`[dataService] Successfully deleted conv "${conversationId}".`);
	return conversationId;
};

export const branchConversation = async (
	sessionKey,
	ownerAddress,
	originalConversationId,
	branchPointMessageId,
	queryClient,
) => {
	console.log(
		`[dataService] Branching conversation "${originalConversationId}" at message "${branchPointMessageId}".`,
	);
	const originalConvRecord = await db.conversations.get([ownerAddress, originalConversationId]);
	if (!originalConvRecord) throw new Error('Original conversation not found');
	const originalConversation = await decryptData(sessionKey, originalConvRecord.encryptedData);
	const allOriginalMessages = await getMessagesForConversation(
		sessionKey,
		ownerAddress,
		originalConversationId,
	);
	const messageMap = new Map(allOriginalMessages.map(m => [m.id, m]));
	const historyToBranch = [];
	let currentId = branchPointMessageId;
	while (currentId && messageMap.has(currentId)) {
		historyToBranch.unshift(messageMap.get(currentId));
		currentId = messageMap.get(currentId).parentId;
	}
	const now = Date.now();
	const newConversation = {
		id: `conv_${now}`,
		ownerAddress,
		createdAt: originalConversation.createdAt,
		title: `Branch · ${originalConversation.title.replace('Branch · ', '')}`,
		isDeleted: false,
		lastUpdatedAt: now,
		lastMessageCreatedAt: historyToBranch.at(-1)?.createdAt || now,
		lastMessagePreview: historyToBranch.at(-1)?.content || '',
		branchedFromConversationId: originalConversationId,
		branchedAtMessageId: branchPointMessageId,
	};
	const newMessages = historyToBranch.map(msg => ({ ...msg, conversationId: newConversation.id }));
	const encryptedNewConv = await encryptData(sessionKey, newConversation);
	await db.conversations.put({
		ownerAddress,
		id: newConversation.id,
		encryptedData: encryptedNewConv,
	});
	const encryptedNewMessages = await encryptData(sessionKey, newMessages);
	await db.messageCache.put({
		ownerAddress,
		conversationId: newConversation.id,
		encryptedData: encryptedNewMessages,
		lastAccessedAt: Date.now(),
	});
	await maintainMessageCache(ownerAddress);
	console.log(`[dataService] Created new branched conversation "${newConversation.id}".`);
	queryClient.invalidateQueries({ queryKey: ['conversations', sessionKey, ownerAddress] });
	queryClient.invalidateQueries({
		queryKey: ['messages', newConversation.id, sessionKey, ownerAddress],
	});
	return newConversation;
};

export const editUserMessage = (
	sessionKey,
	ownerAddress,
	conversationId,
	parentId,
	newContent,
	answerMessageId,
	onReasoningStep,
	onFinalAnswer,
	queryClient,
) =>
	addMessageToConversation(
		sessionKey,
		ownerAddress,
		conversationId,
		parentId,
		newContent,
		answerMessageId,
		onReasoningStep,
		onFinalAnswer,
		queryClient,
	);

export const regenerateAssistantResponse = async (
	sessionKey,
	ownerAddress,
	conversationId,
	parentId,
	originalUserQuery,
	regenerationMode,
	answerMessageId,
	onReasoningStep,
	onFinalAnswer,
	queryClient,
) => {
	console.log(`[dataService] Regenerating response for parent message "${parentId}".`);
	const now = Date.now();
	const finalAiMessage = {
		id: `msg_${now}`,
		conversationId,
		parentId,
		role: 'assistant',
		content: null,
		createdAt: now,
		reasoning: [],
	};

	const existingMessages = await getMessagesForConversation(
		sessionKey,
		ownerAddress,
		conversationId,
	);

	await createMessageWorkflow(
		sessionKey,
		ownerAddress,
		conversationId,
		existingMessages,
		null,
		finalAiMessage,
		originalUserQuery,
		answerMessageId,
		onReasoningStep,
		onFinalAnswer,
		regenerationMode,
		queryClient,
	);

	return {
		finalAiMessage: { ...finalAiMessage, answerMessageId },
	};
};
