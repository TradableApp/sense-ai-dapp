import type { Activity, Conversation, Message, Payment, PromptRequest, SearchDelta } from './generated';

// --- GetUserUpdates ---

export type GetUserUpdatesQueryVariables = {
	owner: string;
	lastSync: string;
	limit: number;
	offset: number;
};

type SearchDeltaFields = Pick<SearchDelta, 'id' | 'searchDeltaCID'>;
type MessageFields = Pick<Message, 'id' | 'messageCID' | 'createdAt'> & {
	searchDelta: SearchDeltaFields | null;
};
type PromptRequestFields = Pick<PromptRequest, 'id' | 'promptMessageId' | 'encryptedPayload' | 'isCancelled' | 'isRefunded' | 'createdAt'>;
type ConversationFields = Pick<Conversation, 'id' | 'conversationCID' | 'conversationMetadataCID' | 'lastMessageCreatedAt'> & {
	messages: MessageFields[];
	promptRequests: PromptRequestFields[];
};

export type GetUserUpdatesQuery = {
	conversations: ConversationFields[];
};

// --- GetStuckPayments ---

export type GetStuckPaymentsQueryVariables = {
	user: string;
};

export type GetStuckPaymentsQuery = {
	payments: Pick<Payment, 'id' | 'amount' | 'createdAt'>[];
};

// --- GetRecentActivity ---

export type GetRecentActivityQueryVariables = {
	owner: string;
	limit: number;
};

export type GetRecentActivityQuery = {
	activities: Pick<Activity, 'id' | 'type' | 'amount' | 'timestamp' | 'transactionHash'>[];
};
