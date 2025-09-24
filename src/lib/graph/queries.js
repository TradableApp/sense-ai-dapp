import { gql } from 'graphql-request'; // Or your GraphQL client's equivalent

/**
 * Fetches all conversations for a user that have been updated
 * since the last sync timestamp.
 *
 * It orders conversations by the timestamp of their last message, ensuring the
 * most recently active conversations appear first.
 *
 * Variables:
 * - $owner: The user's wallet address.
 * - $lastSync: The timestamp of the last successful sync (e.g., lastSyncedAt).
 * - $limit: The number of conversations to fetch (e.g., 250 for initial load).
 * - $offset: The number of conversations to skip (for pagination).
 */
const GET_USER_UPDATES_QUERY = gql`
	query GetUserUpdates($owner: Bytes!, $lastSync: BigInt!, $limit: Int!, $offset: Int!) {
		conversations(
			where: { owner: $owner, lastMessageCreatedAt_gt: $lastSync, isDeleted: false }
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
				searchDelta {
					id
					searchDeltaCID
				}
			}
		}
	}
`;

export default GET_USER_UPDATES_QUERY;
