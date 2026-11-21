import { gql } from 'graphql-request';

/** Conversations asked for per page of a sync. */
export const CONVERSATION_PAGE_SIZE = 100;

/**
 * Rows asked for in a conversation's nested messages and prompt requests, and per follow-up
 * page of either. 1000 is the most The Graph returns for one list; naming it also removes the
 * dependency on the endpoint's default for a nested list (100 on graph-node).
 */
export const NESTED_LIST_PAGE_SIZE = 1000;

const MESSAGE_FIELDS = `
	id
	messageCID
	createdAt
	searchDelta {
		id
		searchDeltaCID
	}
`;

const PROMPT_REQUEST_FIELDS = `
	id # answerMessageId
	promptMessageId
	encryptedPayload
	isCancelled
	isRefunded
	createdAt
`;

/**
 * One page of a user's conversations updated since the last sync, newest first, each with the
 * CIDs of its messages and its unanswered prompt requests.
 *
 * `$where` holds the owner, the sync cursor (`lastMessageCreatedAt_gte`, seconds), the page's
 * upper bound (`lastMessageCreatedAt_lte`, absent on the first page) and `isDeleted: false`
 * (a permanent no-op: the subgraph never sets it; deletion is handled by the dApp). The nested
 * lists are newest first and capped at `$listFirst`; one that comes back full is read on from
 * `GET_CONVERSATION_MESSAGES_QUERY` or `GET_CONVERSATION_PROMPT_REQUESTS_QUERY`.
 *
 * Only unanswered prompt requests (pending, cancelled or refunded) are asked for: an answered
 * one is already among the messages.
 */
export const GET_USER_UPDATES_QUERY = gql`
	query GetUserUpdates($where: Conversation_filter!, $first: Int!, $skip: Int!, $listFirst: Int!) {
		conversations(
			where: $where
			orderBy: lastMessageCreatedAt
			orderDirection: desc
			first: $first
			skip: $skip
		) {
			id
			conversationCID
			conversationMetadataCID
			lastMessageCreatedAt
			messages(first: $listFirst, orderBy: createdAt, orderDirection: desc) {
				${MESSAGE_FIELDS}
			}
			promptRequests(
				where: { isAnswered: false }
				first: $listFirst
				orderBy: createdAt
				orderDirection: desc
			) {
				${PROMPT_REQUEST_FIELDS}
			}
		}
	}
`;

/** A follow-up page of one conversation's messages (`$where`: `conversation`, `createdAt_lte`). */
export const GET_CONVERSATION_MESSAGES_QUERY = gql`
	query GetConversationMessages($where: Message_filter!, $first: Int!, $skip: Int!) {
		messages(where: $where, orderBy: createdAt, orderDirection: desc, first: $first, skip: $skip) {
			${MESSAGE_FIELDS}
		}
	}
`;

/**
 * A follow-up page of one conversation's unanswered prompt requests (`$where`: `conversation`,
 * `isAnswered: false`, `createdAt_lte`).
 */
export const GET_CONVERSATION_PROMPT_REQUESTS_QUERY = gql`
	query GetConversationPromptRequests($where: PromptRequest_filter!, $first: Int!, $skip: Int!) {
		promptRequests(
			where: $where
			orderBy: createdAt
			orderDirection: desc
			first: $first
			skip: $skip
		) {
			${PROMPT_REQUEST_FIELDS}
		}
	}
`;

export const GET_STUCK_PAYMENTS_QUERY = gql`
	query GetStuckPayments($user: Bytes!) {
		payments(where: { user: $user, status: "PENDING" }, orderBy: createdAt, orderDirection: desc) {
			id
			amount
			createdAt
		}
	}
`;

export const GET_RECENT_ACTIVITY_QUERY = gql`
	query GetRecentActivity($owner: Bytes!, $limit: Int!) {
		activities(where: { user: $owner }, orderBy: timestamp, orderDirection: desc, first: $limit) {
			id
			type
			amount
			timestamp
			transactionHash
		}
	}
`;
