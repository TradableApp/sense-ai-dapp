import GraphFetchFailed, { type GraphList } from '@/lib/graph/GraphFetchFailed';
import { collectKeysetPages, type KeysetWindow } from '@/lib/graph/keysetPages';
import {
	CONVERSATION_PAGE_SIZE,
	GET_CONVERSATION_MESSAGES_QUERY,
	GET_CONVERSATION_PROMPT_REQUESTS_QUERY,
	GET_USER_UPDATES_QUERY,
	NESTED_LIST_PAGE_SIZE,
} from '@/lib/graph/queries';
import type {
	ConversationFields,
	GetConversationMessagesQuery,
	GetConversationMessagesQueryVariables,
	GetConversationPromptRequestsQuery,
	GetConversationPromptRequestsQueryVariables,
	GetUserUpdatesQuery,
	GetUserUpdatesQueryVariables,
	MessageFields,
	PromptRequestFields,
} from '@/lib/graph/query-types';

/** The GraphQL client's `request`, passed in so the paging can be tested without one. */
export type GraphRequest = <T>(
	_document: string,
	_variables: Record<string, unknown>,
) => Promise<T>;

/** `_lte` on `field` when the window has an upper bound; nothing on the first page. */
const upperBound = <Field extends string>(field: Field, window: KeysetWindow) =>
	(window.upTo === null ? {} : { [`${field}_lte`]: window.upTo }) as Partial<
		Record<`${Field}_lte`, string>
	>;

/**
 * Runs one request and returns the list named `key` from its answer. Any failure, and an answer
 * without that list, is a `GraphFetchFailed`; nothing from the original error is kept but its
 * name (see GraphFetchFailed).
 */
async function requestList<Answer, Row>(
	request: GraphRequest,
	list: GraphList,
	document: string,
	variables: Record<string, unknown>,
	pick: (_answer: Answer) => unknown,
): Promise<Row[]> {
	let answer: Answer;
	try {
		answer = await request<Answer>(document, variables);
	} catch (error) {
		throw new GraphFetchFailed(list, 'request', error);
	}
	const rows = answer ? pick(answer) : undefined;
	if (!Array.isArray(rows)) throw new GraphFetchFailed(list, 'malformed');
	return rows as Row[];
}

function hasCompleteLists(conversation: ConversationFields): boolean {
	return Array.isArray(conversation.messages) && Array.isArray(conversation.promptRequests);
}

async function allMessagesOf(
	request: GraphRequest,
	conversation: ConversationFields,
): Promise<MessageFields[]> {
	if (conversation.messages.length < NESTED_LIST_PAGE_SIZE) return conversation.messages;
	return collectKeysetPages<MessageFields>({
		list: 'messages',
		pageSize: NESTED_LIST_PAGE_SIZE,
		keyOf: message => String(message.createdAt),
		idOf: message => message.id,
		firstPage: conversation.messages,
		fetchPage: window => {
			const variables: GetConversationMessagesQueryVariables = {
				where: { conversation: conversation.id, ...upperBound('createdAt', window) },
				first: NESTED_LIST_PAGE_SIZE,
				skip: window.skip,
			};
			return requestList<GetConversationMessagesQuery, MessageFields>(
				request,
				'messages',
				GET_CONVERSATION_MESSAGES_QUERY,
				variables,
				answer => answer.messages,
			);
		},
	});
}

async function allPromptRequestsOf(
	request: GraphRequest,
	conversation: ConversationFields,
): Promise<PromptRequestFields[]> {
	if (conversation.promptRequests.length < NESTED_LIST_PAGE_SIZE) {
		return conversation.promptRequests;
	}
	return collectKeysetPages<PromptRequestFields>({
		list: 'prompt-requests',
		pageSize: NESTED_LIST_PAGE_SIZE,
		keyOf: promptRequest => String(promptRequest.createdAt),
		idOf: promptRequest => promptRequest.id,
		firstPage: conversation.promptRequests,
		fetchPage: window => {
			const variables: GetConversationPromptRequestsQueryVariables = {
				where: {
					conversation: conversation.id,
					isAnswered: false,
					...upperBound('createdAt', window),
				},
				first: NESTED_LIST_PAGE_SIZE,
				skip: window.skip,
			};
			return requestList<GetConversationPromptRequestsQuery, PromptRequestFields>(
				request,
				'prompt-requests',
				GET_CONVERSATION_PROMPT_REQUESTS_QUERY,
				variables,
				answer => answer.promptRequests,
			);
		},
	});
}

/**
 * Every conversation of `owner` updated at or after `sinceSeconds`, newest first, each with all
 * of its messages and unanswered prompt requests, as The Graph serves them (BigInt strings in
 * seconds).
 *
 * Conversations are read in pages of `CONVERSATION_PAGE_SIZE`; a conversation whose nested
 * messages or prompt requests fill `NESTED_LIST_PAGE_SIZE` is read on from its own query, one
 * conversation at a time so a large wallet does not send a burst of requests. A wallet under
 * both limits costs one request.
 *
 * Throws `GraphFetchFailed` if any request fails: a partial answer is never returned, so the
 * caller can neither store part of it nor move its cursor past what it did not read.
 */
export default async function fetchAllUserUpdates(
	request: GraphRequest,
	owner: string,
	sinceSeconds: number,
): Promise<ConversationFields[]> {
	const conversations = await collectKeysetPages<ConversationFields>({
		list: 'conversations',
		pageSize: CONVERSATION_PAGE_SIZE,
		keyOf: conversation => String(conversation.lastMessageCreatedAt),
		idOf: conversation => conversation.id,
		fetchPage: async window => {
			const variables: GetUserUpdatesQueryVariables = {
				where: {
					owner,
					isDeleted: false,
					lastMessageCreatedAt_gte: String(sinceSeconds),
					...upperBound('lastMessageCreatedAt', window),
				},
				first: CONVERSATION_PAGE_SIZE,
				skip: window.skip,
				listFirst: NESTED_LIST_PAGE_SIZE,
			};
			const page = await requestList<GetUserUpdatesQuery, ConversationFields>(
				request,
				'conversations',
				GET_USER_UPDATES_QUERY,
				variables,
				answer => answer.conversations,
			);
			if (!page.every(hasCompleteLists)) throw new GraphFetchFailed('conversations', 'malformed');
			return page;
		},
	});

	// One request at a time, in order (no burst, and nothing more is sent after a failure).
	const completed: ConversationFields[] = [];
	for (let index = 0; index < conversations.length; index += 1) {
		const conversation = conversations[index];
		// eslint-disable-next-line no-await-in-loop -- serial on purpose, see above
		const messages = await allMessagesOf(request, conversation);
		// eslint-disable-next-line no-await-in-loop -- serial on purpose, see above
		const promptRequests = await allPromptRequestsOf(request, conversation);
		completed.push({ ...conversation, messages, promptRequests });
	}
	return completed;
}
