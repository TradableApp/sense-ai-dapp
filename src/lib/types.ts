import { Table } from 'dexie';

// Conversation types
export interface ConversationRecord {
	ownerAddress: string;
	id: string;
	encryptedData: string;
}

export interface Conversation {
	id: string;
	ownerAddress: string;
	createdAt: number;
	title: string;
	isDeleted: boolean;
	lastUpdatedAt: number;
	lastMessageCreatedAt: number;
	lastMessagePreview: string;
	branchedFromConversationId?: string;
	branchedAtMessageId?: string;
}

// Message types
export interface MessageRecord {
	ownerAddress: string;
	conversationId: string;
	encryptedData: string;
	lastAccessedAt: number;
}

export interface Message {
	id: string;
	conversationId: string;
	parentId?: string;
	role: 'user' | 'assistant';
	content: string | null;
	createdAt: number;
	reasoning?: Array<{ step: string }>;
	sources?: Array<{ title: string; url: string }>;
	reasoningDuration?: number;
}

// Search index types
export interface SearchIndexRecord {
	ownerAddress: string;
	id: string;
	encryptedData: string;
}

export interface SearchIndex {
	cid: string;
	c: string;
	t?: string;
	tm?: number;
}

// User metadata types
export interface UserMetadataRecord {
	ownerAddress: string;
	encryptedData: string;
}

export interface UserMetadata {
	userMetadata?: Record<string, unknown>;
}

// Database interface
export interface SenseAIDb {
	conversations: Table<ConversationRecord>;
	messageCache: Table<MessageRecord>;
	searchIndex: Table<SearchIndexRecord>;
	userMetadata: Table<UserMetadataRecord>;
}

// Faucet response types
export interface FaucetResponse {
	success: boolean;
	txHash?: string;
	message?: string;
}
