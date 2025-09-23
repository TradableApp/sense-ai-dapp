/* eslint-disable no-promise-executor-return */
import { mockAiResponseTemplates, mockReasoningPool, mockSourcesPool } from './mockData';

const liveConversations = [];
const liveMessages = [];
const MOCK_DELAY = 300;
const MOCK_REASONING_STEP_DELAY = 900;

const updateConversationMeta = conversationId => {
	const conversation = liveConversations.find(c => c.id === conversationId);
	if (!conversation) return;
	const lastMessage = liveMessages
		.filter(m => m.conversationId === conversationId)
		.sort((a, b) => b.timestamp - a.timestamp)[0];
	if (lastMessage) {
		const preview =
			lastMessage.role === 'assistant' && !lastMessage.content
				? liveMessages.find(m => m.id === lastMessage.parentId)?.content
				: lastMessage.content;
		conversation.lastMessagePreview = preview;
		conversation.updatedAt = lastMessage.timestamp;
	}
};

const simulateOracleProcess = async (aiMessageId, conversationId, userQuery) => {
	const thinkingStartTime = Date.now();
	const reasoningSteps = mockReasoningPool[Math.floor(Math.random() * mockReasoningPool.length)];

	// --- FIX: Replaced for...of loop with a promise-based reduce chain ---
	await reasoningSteps.reduce(async (promise, step) => {
		await promise;
		await new Promise(resolve => setTimeout(resolve, MOCK_REASONING_STEP_DELAY));
		const messageIndex = liveMessages.findIndex(m => m.id === aiMessageId);
		if (messageIndex !== -1) {
			liveMessages[messageIndex].reasoning.push(step);
		}
	}, Promise.resolve());

	await new Promise(resolve => setTimeout(resolve, MOCK_REASONING_STEP_DELAY));
	const messageIndex = liveMessages.findIndex(m => m.id === aiMessageId);
	if (messageIndex !== -1) {
		const template =
			mockAiResponseTemplates[Math.floor(Math.random() * mockAiResponseTemplates.length)];
		const durationInSeconds = Math.round((Date.now() - thinkingStartTime) / 1000);
		liveMessages[messageIndex].content = template.replace('{query}', userQuery.substring(0, 20));
		liveMessages[messageIndex].sources =
			mockSourcesPool[Math.floor(Math.random() * mockSourcesPool.length)];
		liveMessages[messageIndex].reasoningDuration = durationInSeconds;
		updateConversationMeta(conversationId);
	}
};

export const fetchConversations = async () => {
	await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
	return liveConversations
		.filter(c => !c.isDeleted)
		.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
};

export const fetchMessagesForConversation = async conversationId => {
	await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
	if (!conversationId) return [];
	const messages = liveMessages
		.filter(m => m.conversationId === conversationId)
		.sort((a, b) => a.timestamp - b.timestamp);
	return JSON.parse(JSON.stringify(messages));
};

export const addMessageToConversation = async (conversationId, parentId, messageContent) => {
	await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
	const now = Date.now();
	const userMessage = {
		id: `msg_${now}`,
		conversationId,
		parentId,
		role: 'user',
		content: messageContent,
		reasoning: null,
		sources: null,
		timestamp: now,
	};
	liveMessages.push(userMessage);
	const aiPlaceholder = {
		id: `msg_${now + 1}`,
		conversationId,
		parentId: userMessage.id,
		role: 'assistant',
		content: null,
		reasoning: [],
		sources: null,
		timestamp: now + 1,
	};
	liveMessages.push(aiPlaceholder);
	updateConversationMeta(conversationId);
	simulateOracleProcess(aiPlaceholder.id, conversationId, messageContent);
	return aiPlaceholder;
};

export const editUserMessage = async (conversationId, parentId, newContent) => {
	await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
	const now = Date.now();
	const editedUserMessage = {
		id: `msg_${now}`,
		conversationId,
		parentId,
		role: 'user',
		content: newContent,
		reasoning: null,
		sources: null,
		timestamp: now,
	};
	liveMessages.push(editedUserMessage);
	const aiPlaceholder = {
		id: `msg_${now + 1}`,
		conversationId,
		parentId: editedUserMessage.id,
		role: 'assistant',
		content: null,
		reasoning: [],
		sources: null,
		timestamp: now + 1,
	};
	liveMessages.push(aiPlaceholder);
	updateConversationMeta(conversationId);
	simulateOracleProcess(aiPlaceholder.id, conversationId, newContent);
	return editedUserMessage;
};

export const regenerateAssistantResponse = async (
	conversationId,
	parentId,
	originalUserQuery,
	regenerationMode = 'default',
) => {
	await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
	const now = Date.now();
	const aiPlaceholder = {
		id: `msg_${now + 1}`,
		conversationId,
		parentId,
		role: 'assistant',
		content: null,
		reasoning: [],
		sources: null,
		timestamp: now + 1,
	};
	liveMessages.push(aiPlaceholder);
	updateConversationMeta(conversationId);
	let finalQuery = originalUserQuery;
	if (regenerationMode === 'detailed') {
		finalQuery = `Provide a more detailed analysis for: ${originalUserQuery}`;
	} else if (regenerationMode === 'concise') {
		finalQuery = `Provide a more concise summary for: ${originalUserQuery}`;
	}
	simulateOracleProcess(aiPlaceholder.id, conversationId, finalQuery);
	return aiPlaceholder;
};

export const createNewConversation = async firstMessageContent => {
	await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
	const now = Date.now();
	const newConversation = {
		id: `conv_${now}`,
		ownerAddress: '0x123...',
		title: firstMessageContent.substring(0, 40) + (firstMessageContent.length > 40 ? '...' : ''),
		isDeleted: false,
	};
	liveConversations.push(newConversation);
	await addMessageToConversation(newConversation.id, null, firstMessageContent);
	return newConversation;
};

export const renameConversation = async ({ id, newTitle }) => {
	await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
	const conversation = liveConversations.find(c => c.id === id);
	if (conversation) {
		conversation.title = newTitle;
	}
	return conversation;
};

export const deleteConversation = async conversationId => {
	await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
	const conversation = liveConversations.find(c => c.id === conversationId);
	if (conversation) {
		conversation.isDeleted = true;
	}
	return conversationId;
};
