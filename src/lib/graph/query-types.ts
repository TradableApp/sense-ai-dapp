import type {
	Activity,
	Conversation,
	Message,
	Payment,
	PromptRequest,
	SearchDelta,
} from './generated';

// --- GetUserUpdates ---

// The schema copy declares entities only; graph-node derives the filter inputs from them, so
// the parts of each filter the sync uses are written out here.

export type ConversationPageFilter = {
	owner: string;
	isDeleted: false;
	lastMessageCreatedAt_gte: string;
	lastMessageCreatedAt_lte?: string;
};

export type GetUserUpdatesQueryVariables = {
	where: ConversationPageFilter;
	first: number;
	skip: number;
	listFirst: number;
};

type SearchDeltaFields = Pick<SearchDelta, 'id' | 'searchDeltaCID'>;
export type MessageFields = Pick<Message, 'id' | 'messageCID' | 'createdAt'> & {
	searchDelta: SearchDeltaFields | null;
};
export type PromptRequestFields = Pick<
	PromptRequest,
	'id' | 'promptMessageId' | 'encryptedPayload' | 'isCancelled' | 'isRefunded' | 'createdAt'
>;
export type ConversationFields = Pick<
	Conversation,
	'id' | 'conversationCID' | 'conversationMetadataCID' | 'lastMessageCreatedAt'
> & {
	messages: MessageFields[];
	promptRequests: PromptRequestFields[];
};

export type GetUserUpdatesQuery = {
	conversations: ConversationFields[];
};

// --- GetConversationMessages / GetConversationPromptRequests ---

export type ConversationListPageVariables<Filter> = {
	where: Filter;
	first: number;
	skip: number;
};

export type GetConversationMessagesQueryVariables = ConversationListPageVariables<{
	conversation: string;
	createdAt_lte?: string;
}>;

export type GetConversationMessagesQuery = {
	messages: MessageFields[];
};

export type GetConversationPromptRequestsQueryVariables = ConversationListPageVariables<{
	conversation: string;
	isAnswered: false;
	createdAt_lte?: string;
}>;

export type GetConversationPromptRequestsQuery = {
	promptRequests: PromptRequestFields[];
};

// --- GetStuckPayments ---

export type GetStuckPaymentsQueryVariables = {
	user: string;
	first: number;
	skip: number;
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
