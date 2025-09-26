// src/lib/schema.js

/**
 * @file This file defines the canonical data structures for the application,
 * matching the schemas used in smart contracts, Arweave, and The Graph.
 */

/**
 * Represents the immutable core of a conversation.
 * Stored once on Arweave.
 * @typedef {object} ConversationFile
 * @property {string} id - The unique conversation ID (e.g., "conv_1678886400000").
 * @property {string} ownerAddress - The wallet address of the owner.
 * @property {number} createdAt - The Unix timestamp (milliseconds) of creation.
 * @property {string} [branchedFromConversationId] - The ID of the conversation this was branched from.
 * @property {string} [branchedAtMessageId] - The ID of the message where the branch occurred.
 */

/**
 * Represents the mutable metadata of a conversation.
 * A new version is stored on Arweave for each update.
 * @typedef {object} ConversationMetadataFile
 * @property {string} title - The user-defined title of the conversation.
 * @property {boolean} isDeleted - A flag indicating if the conversation is deleted.
 * @property {number} lastUpdatedAt - The Unix timestamp of when the metadata (title, isDeleted) was last changed.
 * @property {number} [lastMessageCreatedAt] - The Unix timestamp of the latest message in the conversation. Used for sorting and syncing.
 * @property {string} [lastMessagePreview] - A plain text snippet of the last message for UI previews.
 */

/**
 * Represents a single message within a conversation, from either the user or the AI.
 * Stored on Arweave.
 * @typedef {object} MessageFile
 * @property {string} id - The unique message ID (e.g., "msg_1678886400001").
 * @property {string} conversationId - The ID of the parent conversation.
 * @property {string|null} parentId - The ID of the parent message, for threading.
 * @property {number} createdAt - The Unix timestamp (milliseconds) of creation.
 * @property {'user' | 'assistant'} role - The role of the message author.
 * @property {string | null} content - The markdown content of the message. Null if the AI is still generating.
 * @property {ReasoningStep[]} reasoning - An array of reasoning steps taken by the AI.
 * @property {number | null} reasoningDuration - The duration in seconds for the AI to generate the response. Null for user messages.
 * @property {Source[]} [sources] - An array of sources cited by the AI.
 */

/**
 * Represents a single step in the AI's thought process.
 * Stored as part of the MessageFile or individually on Arweave.
 * @typedef {object} ReasoningStep
 * @property {string} title - The title of the reasoning step.
 * @property {string} description - The detailed thought or action taken.
 */

/**
 * Represents a source cited by the AI.
 * @typedef {object} Source
 * @property {string} title - The title of the source document or link.
 * @property {string} url - The URL of the source.
 */

/**
 * Represents a chunk of keywords for a single message.
 * Stored on Arweave and used to build the client-side search index.
 * @typedef {object} SearchIndexDeltaFile
 * @property {Object.<string, string>} - A map where the key is "conversationId-messageId" and the value is a string of keywords.
 * @example
 * { "conv_123-msg_456": "bitcoin market sentiment analysis keywords" }
 */
