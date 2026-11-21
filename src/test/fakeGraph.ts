/**
 * A stand-in for the subgraph's query API, enough to test how the sync pages through it.
 *
 * It answers the sync's three queries from an in-memory list of conversations the way
 * graph-node does: rows filtered by `where`, sorted newest first on the ordering field with the
 * id breaking ties, then `skip` and `first` applied. A nested list without `first` returns
 * graph-node's default of 100 rows. Timestamps are BigInt strings in seconds, as served.
 */

export interface FakeMessage {
	id: string;
	messageCID: string;
	createdAt: string;
	searchDelta: null;
}

export interface FakePromptRequest {
	id: string;
	promptMessageId: string;
	encryptedPayload: string;
	isCancelled: boolean;
	isRefunded: boolean;
	createdAt: string;
}

export interface FakeConversation {
	id: string;
	conversationCID: string;
	conversationMetadataCID: string;
	lastMessageCreatedAt: string;
	messages: FakeMessage[];
	promptRequests: FakePromptRequest[];
}

/** graph-node's `first` when a list names none. */
const GRAPH_DEFAULT_FIRST = 100;

type Where = Record<string, unknown>;

const byNewest =
	<T extends { id: string }>(keyOf: (_row: T) => string) =>
	(a: T, b: T): number => {
		const difference = BigInt(keyOf(b)) - BigInt(keyOf(a));
		if (difference !== 0n) return difference > 0n ? 1 : -1;
		return a.id < b.id ? -1 : 1;
	};

/** Whether a row's BigInt key passes the `_gte` / `_lte` bounds in `where`. */
const withinBounds = (key: string, where: Where, field: string): boolean => {
	const atLeast = where[`${field}_gte`];
	const atMost = where[`${field}_lte`];
	if (atLeast !== undefined && BigInt(key) < BigInt(String(atLeast))) return false;
	if (atMost !== undefined && BigInt(key) > BigInt(String(atMost))) return false;
	return true;
};

function page<T extends { id: string }>(
	rows: readonly T[],
	keyOf: (_row: T) => string,
	first: number,
	skip: number,
): T[] {
	return [...rows].sort(byNewest(keyOf)).slice(skip, skip + first);
}

export interface FakeGraph {
	/** Pass as the GraphQL client's `request`. */
	request: (_document: string, _variables: Record<string, unknown>) => Promise<unknown>;
	/** The operation name of every request made, in order. */
	readonly requests: string[];
}

export function createFakeGraph(conversations: readonly FakeConversation[]): FakeGraph {
	const requests: string[] = [];

	const conversationPage = (variables: Record<string, unknown>) => {
		// The sync's earlier variables (`owner`, `lastSync`, `limit`, `offset`) are read too, so a
		// test runs the same against code that does not page.
		const where: Where = (variables.where as Where) ?? {
			lastMessageCreatedAt_gte: variables.lastSync,
		};
		const first = Number(variables.first ?? variables.limit);
		const skip = Number(variables.skip ?? variables.offset ?? 0);
		const listFirst = Number(variables.listFirst ?? GRAPH_DEFAULT_FIRST);
		const matching = conversations.filter(c =>
			withinBounds(c.lastMessageCreatedAt, where, 'lastMessageCreatedAt'),
		);
		return {
			conversations: page(matching, c => c.lastMessageCreatedAt, first, skip).map(c => ({
				...c,
				messages: page(c.messages, m => m.createdAt, listFirst, 0),
				promptRequests: page(c.promptRequests, r => r.createdAt, listFirst, 0),
			})),
		};
	};

	const nestedPage = <T extends { id: string; createdAt: string }>(
		pick: (_conversation: FakeConversation) => readonly T[],
		variables: Record<string, unknown>,
	): T[] => {
		const where = variables.where as Where;
		const owner = conversations.find(c => c.id === where.conversation);
		const rows = (owner ? pick(owner) : []).filter(r =>
			withinBounds(r.createdAt, where, 'createdAt'),
		);
		return page(rows, r => r.createdAt, Number(variables.first), Number(variables.skip ?? 0));
	};

	const request = async (document: string, variables: Record<string, unknown>) => {
		const operation = /query\s+(\w+)/.exec(document)?.[1] ?? 'unknown';
		requests.push(operation);
		if (operation === 'GetUserUpdates') return conversationPage(variables);
		if (operation === 'GetConversationMessages') {
			return { messages: nestedPage(c => c.messages, variables) };
		}
		if (operation === 'GetConversationPromptRequests') {
			return { promptRequests: nestedPage(c => c.promptRequests, variables) };
		}
		throw new Error(`The fake Graph does not answer ${operation}.`);
	};

	return { request, requests };
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** A CID the localnet IPFS route accepts (`baf[ky]` and base32 letters), unique for `n`. */
export function fakeCid(kind: string, n: number): string {
	let digits = '';
	let rest = n;
	do {
		digits = BASE32[rest % 32] + digits;
		rest = Math.floor(rest / 32);
	} while (rest > 0);
	return `bafy${kind}${digits.padStart(20, 'a')}`;
}
