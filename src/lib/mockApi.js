/* eslint-disable no-promise-executor-return */
import { mockAiResponseTemplates, mockReasoningPool, mockSourcesPool } from './mockData';

// This is our live, in-memory "database". It starts empty.
const liveConversations = [];
const liveMessages = [];

const MOCK_DELAY = 300;
// Delay for individual reasoning steps.
const MOCK_REASONING_STEP_DELAY = 900;

// --- Helper to dynamically update conversation metadata ---
const updateConversationMeta = conversationId => {
	const conversation = liveConversations.find(c => c.id === conversationId);
	if (!conversation) return;

	const lastMessage = liveMessages
		.filter(m => m.conversationId === conversationId)
		.sort((a, b) => b.timestamp - a.timestamp)[0];

	if (lastMessage) {
		// Use the user's prompt for the preview until the AI finishes.
		const preview =
			lastMessage.role === 'assistant' && !lastMessage.content
				? liveMessages.find(m => m.id === lastMessage.parentId)?.content
				: lastMessage.content;
		conversation.lastMessagePreview = preview;
		conversation.updatedAt = lastMessage.timestamp;
	}
};

/**
 * Simulates the Oracle's process: thinking, then writing.
 * This function runs in the background and mutates the message object in the live store.
 * @param {string} aiMessageId - The ID of the message to populate.
 * @param {string} conversationId - The ID of the conversation.
 * @param {string} userQuery - The original user query for context.
 */
const simulateOracleProcess = async (aiMessageId, conversationId, userQuery) => {
	const reasoningSteps = mockReasoningPool[Math.floor(Math.random() * mockReasoningPool.length)];

	// 1. Simulate "Thinking" by revealing one thought at a time.
	for (const step of reasoningSteps) {
		await new Promise(resolve => setTimeout(resolve, MOCK_REASONING_STEP_DELAY));
		const messageIndex = liveMessages.findIndex(m => m.id === aiMessageId);
		if (messageIndex !== -1) {
			liveMessages[messageIndex].reasoning.push(step);
		}
	}

	// 2. Simulate "Writing" the final answer after thinking is complete.
	await new Promise(resolve => setTimeout(resolve, MOCK_REASONING_STEP_DELAY));
	const messageIndex = liveMessages.findIndex(m => m.id === aiMessageId);
	if (messageIndex !== -1) {
		const template =
			mockAiResponseTemplates[Math.floor(Math.random() * mockAiResponseTemplates.length)];
		liveMessages[messageIndex].content = template.replace('{query}', userQuery.substring(0, 20));
		liveMessages[messageIndex].sources =
			mockSourcesPool[Math.floor(Math.random() * mockSourcesPool.length)];
		updateConversationMeta(conversationId);
	}
};

// --- READ OPERATIONS ---

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

	// --- FIX ---
	// Return a deep copy of the messages to ensure TanStack Query's change
	// detection is triggered correctly. Without this, the component will not
	// re-render as the underlying object references would not change.
	return JSON.parse(JSON.stringify(messages));
};

// --- WRITE OPERATIONS (MUTATIONS) ---

export const addMessageToConversation = async (conversationId, parentId, messageContent) => {
	await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
	const now = Date.now();

	// 1. Immediately add the user's message to the store.
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

	// 2. Immediately add the AI's placeholder response.
	const aiPlaceholder = {
		id: `msg_${now + 1}`,
		conversationId,
		parentId: userMessage.id,
		role: 'assistant',
		content: null, // Content is null until the Oracle "writes" it.
		reasoning: [], // Reasoning starts empty and will be populated.
		sources: null, // Sources are null until the Oracle "writes" them.
		timestamp: now + 1,
	};
	liveMessages.push(aiPlaceholder);
	updateConversationMeta(conversationId);

	// 3. Start the Oracle simulation in the background (do not await).
	simulateOracleProcess(aiPlaceholder.id, conversationId, messageContent);

	// 4. Return the placeholder immediately so the UI can show the "Thinking" state.
	return aiPlaceholder;
};

export const createNewConversation = async firstMessageContent => {
	await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
	const now = Date.now();
	const newConversation = {
		id: `conv_${now}`,
		ownerAddress: '0x123...', // This would be dynamic in a real app
		title: firstMessageContent.substring(0, 40) + (firstMessageContent.length > 40 ? '...' : ''),
		isDeleted: false,
		// lastMessagePreview and updatedAt will be set by addMessageToConversation
	};
	liveConversations.push(newConversation);

	// This now correctly calls the function, which will quickly add the user message
	// and AI placeholder, then start the background process.
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
