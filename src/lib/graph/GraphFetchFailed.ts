/** Which list a failed Graph request was reading. */
export type GraphList = 'conversations' | 'messages' | 'prompt-requests';

/**
 * Why it failed: the request itself (`request`), an answer without the list asked for
 * (`malformed`), a full page with nothing not already read, which means the endpoint is not
 * honouring the page bounds and asking again would never end (`no-progress`), or a build with
 * no Graph endpoint, which can never read the history (`not-configured`).
 */
export type GraphFailureReason = 'request' | 'malformed' | 'no-progress' | 'not-configured';

/**
 * A Graph request the sync could not use. It is thrown rather than read as "no updates", so
 * the sync stores nothing from the pass and leaves its cursor where it was.
 *
 * It carries only the list, the reason and the original error's name. The original is not kept
 * as `cause`: graphql-request's text holds the endpoint URL, the query and its variables, and
 * the variables hold the wallet address.
 */
export default class GraphFetchFailed extends Error {
	readonly list: GraphList;

	readonly reason: GraphFailureReason;

	readonly causeName: string | null;

	constructor(list: GraphList, reason: GraphFailureReason, cause?: unknown) {
		super(`The Graph could not be read (${list}, ${reason}).`);
		this.name = 'GraphFetchFailed';
		this.list = list;
		this.reason = reason;
		this.causeName = cause instanceof Error ? cause.name : null;
	}
}
