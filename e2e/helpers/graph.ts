/**
 * Local Graph node helpers for use in Playwright tests.
 */

// Single source of truth for the subgraph endpoint, env-aware so the health
// check (global-setup) and the test queries always target the same URL.
export const GRAPH_URL =
	process.env.VITE_THE_GRAPH_API_URL || 'http://localhost:8000/subgraphs/name/sense-ai';

// Origin of the Graph node HTTP server (e.g. http://localhost:8000) — lets us
// probe that the node process itself is up, independently of whether the
// subgraph is deployed/indexed (which is what a `_meta` query verifies).
// Parsed once at load; a malformed VITE_THE_GRAPH_API_URL fails loudly with an
// actionable message instead of an opaque `Invalid URL` at import time.
export const GRAPH_NODE_ORIGIN = ((): string => {
	try {
		const url = new URL(GRAPH_URL);
		// A missing scheme (e.g. "localhost:8000") parses without throwing but
		// yields a useless origin of "null", so check the protocol explicitly.
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw new Error('protocol must be http(s)');
		}
		return url.origin;
	} catch {
		throw new Error(
			`Invalid Graph endpoint "${GRAPH_URL}". Set VITE_THE_GRAPH_API_URL to an absolute ` +
				`http(s) URL including the scheme, e.g. http://localhost:8000/subgraphs/name/sense-ai.`,
		);
	}
})();
const GRAPH_PROBE_TIMEOUT_MS = 5_000;

async function graphQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
	const res = await fetch(GRAPH_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	});
	const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
	if (json.errors?.length) throw new Error(`Graph error: ${json.errors[0].message}`);
	if (!json.data) throw new Error('Graph returned no data');
	return json.data;
}

/**
 * Returns true if the local Graph node HTTP server is reachable at its origin.
 * Deliberately independent of subgraph deployment: any HTTP response (even 4xx)
 * proves the server answered; only a connection/timeout error means it's down.
 * Subgraph deployment/indexing is checked separately via a `_meta` query.
 */
export async function isGraphRunning(): Promise<boolean> {
	try {
		await fetch(GRAPH_NODE_ORIGIN, { signal: AbortSignal.timeout(GRAPH_PROBE_TIMEOUT_MS) });
		return true;
	} catch {
		return false;
	}
}

/** Returns the latest indexed block number */
export async function getIndexedBlockNumber(): Promise<number> {
	const data = await graphQuery<{ _meta: { block: { number: number } } }>(
		'{ _meta { block { number } } }',
	);
	return data._meta.block.number;
}

/**
 * Polls the Graph node until it has indexed up to `targetBlock`.
 * Useful for waiting after a transaction is mined.
 */
export async function waitForIndexing(targetBlock: number, timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const current = await getIndexedBlockNumber();
		if (current >= targetBlock) return;
		await new Promise(r => setTimeout(r, 1_000));
	}
	throw new Error(`Graph did not index block ${targetBlock} within ${timeoutMs}ms`);
}

/** Fetches all conversations for a given owner address */
export async function getConversations(ownerAddress: string): Promise<Array<{ id: string }>> {
	const data = await graphQuery<{ conversations: Array<{ id: string }> }>(
		`query($owner: Bytes!) {
      conversations(where: { owner: $owner }, orderBy: lastMessageCreatedAt, orderDirection: desc) {
        id
      }
    }`,
		{ owner: ownerAddress.toLowerCase() },
	);
	return data.conversations;
}

/** Fetches pending payments (stuck requests) for a given user */
export async function getPendingPayments(
	userAddress: string,
): Promise<Array<{ id: string; amount: string }>> {
	const data = await graphQuery<{ payments: Array<{ id: string; amount: string }> }>(
		`query($user: Bytes!) {
      payments(where: { user: $user, status: "PENDING" }) {
        id
        amount
      }
    }`,
		{ user: userAddress.toLowerCase() },
	);
	return data.payments;
}

// ── Full-stack assertion helpers (CU-86d3bawhh) ──────────────────────────────
// The subgraph is the indexing layer's observable surface. These let a test
// cross-check that an action the dApp shows actually landed on-chain and indexed
// — e.g. a rendered answer ⇒ a role:"assistant" Message + PromptRequest.isAnswered,
// not just an optimistic bubble. Mirrors schema.graphql in sense-ai-subgraph.

export interface IndexedMessage {
	id: string;
	messageId: string;
	role: string;
	messageCID: string;
	createdAt: string;
	searchDelta: { id: string } | null;
}

/** All indexed messages for a conversation, oldest first (prompt + answer rows). */
export async function getMessages(conversationId: string): Promise<IndexedMessage[]> {
	const data = await graphQuery<{ messages: IndexedMessage[] }>(
		`query($conv: ID!) {
      messages(where: { conversation: $conv }, orderBy: createdAt, orderDirection: asc) {
        id
        messageId
        role
        messageCID
        createdAt
        searchDelta { id }
      }
    }`,
		{ conv: conversationId },
	);
	return data.messages;
}

export interface IndexedPromptRequest {
	id: string; // answerMessageId
	promptMessageId: string;
	isCancelled: boolean;
	isAnswered: boolean;
	isRefunded: boolean;
}

/** Prompt-request status rows for a user (answered/cancelled/refunded flags). */
export async function getPromptRequests(userAddress: string): Promise<IndexedPromptRequest[]> {
	const data = await graphQuery<{ promptRequests: IndexedPromptRequest[] }>(
		`query($user: Bytes!) {
      promptRequests(where: { user: $user }, orderBy: createdAt, orderDirection: asc) {
        id
        promptMessageId
        isCancelled
        isAnswered
        isRefunded
      }
    }`,
		{ user: userAddress.toLowerCase() },
	);
	return data.promptRequests;
}

export interface IndexedConversation {
	id: string;
	conversationCID: string;
	conversationMetadataCID: string;
	lastMessageCreatedAt: string;
	isDeleted: boolean;
	branchedFrom: { id: string } | null;
}

/** A single conversation's indexed metadata (CIDs, isDeleted, branch parent). */
export async function getConversation(
	conversationId: string,
): Promise<IndexedConversation | null> {
	const data = await graphQuery<{ conversation: IndexedConversation | null }>(
		`query($id: ID!) {
      conversation(id: $id) {
        id
        conversationCID
        conversationMetadataCID
        lastMessageCreatedAt
        isDeleted
        branchedFrom { id }
      }
    }`,
		{ id: conversationId },
	);
	return data.conversation;
}

export interface IndexedRegenerationRequest {
	id: string;
	originalAnswerMessageId: string;
	answerMessageId: string;
}

/** Regeneration requests for a user (links original answer → new answer id). */
export async function getRegenerationRequests(
	userAddress: string,
): Promise<IndexedRegenerationRequest[]> {
	const data = await graphQuery<{ regenerationRequests: IndexedRegenerationRequest[] }>(
		`query($user: Bytes!) {
      regenerationRequests(where: { user: $user }) {
        id
        originalAnswerMessageId
        answerMessageId
      }
    }`,
		{ user: userAddress.toLowerCase() },
	);
	return data.regenerationRequests;
}

/**
 * Polls `query()` until `predicate` is satisfied, returning the matching value.
 * The generic indexing-aware wait the assertion helpers above compose with —
 * the subgraph lags the chain by a block or two, so reads must be retried.
 */
export async function waitForGraph<T>(
	query: () => Promise<T>,
	predicate: (_value: T) => boolean,
	{ timeoutMs = 30_000, label = 'condition' }: { timeoutMs?: number; label?: string } = {},
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let last: T;
	do {
		last = await query();
		if (predicate(last)) return last;
		await new Promise(r => setTimeout(r, 1_000));
	} while (Date.now() < deadline);
	throw new Error(`waitForGraph: ${label} not met within ${timeoutMs}ms`);
}
