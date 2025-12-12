import { gql } from 'graphql-request';

/**
 * @notice Fetches all conversations for a user that have been updated
 *         since the last sync timestamp.
 * @dev This is the primary query for the `syncService`. It retrieves a list of
 *      conversations, ordered by the most recently active, along with all the
 *      CIDs for their messages and search deltas. This provides all the "pointers"
 *      needed to hydrate the full data from Arweave.
 *
 * @param {string} $owner - The user's wallet address (lowercase).
 * @param {number} $lastSync - The Unix timestamp (milliseconds) of the last successful sync.
 * @param {number} $limit - The maximum number of conversations to fetch.
 * @param {number} $offset - The number of conversations to skip (for pagination).
 */
// eslint-disable-next-line import/prefer-default-export
export const GET_USER_UPDATES_QUERY = gql`
	query GetUserUpdates($owner: Bytes!, $lastSync: BigInt!, $limit: Int!, $offset: Int!) {
		conversations(
			where: { owner: $owner, lastMessageCreatedAt_gte: $lastSync, isDeleted: false }
			orderBy: lastMessageCreatedAt
			orderDirection: desc
			first: $limit
			skip: $offset
		) {
			id
			conversationCID
			conversationMetadataCID
			lastMessageCreatedAt
			messages(orderBy: createdAt, orderDirection: desc) {
				id
				messageCID
				createdAt
				searchDelta {
					id
					searchDeltaCID
				}
			}
			# Fetch "incomplete" requests (Cancelled, Refunded, or Pending)
			# We only want those that are NOT answered, to avoid duplication with 'messages'
			promptRequests(where: { isAnswered: false }) {
				id # answerMessageId
				promptMessageId
				encryptedPayload
				isCancelled
				isRefunded
				createdAt
			}
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
