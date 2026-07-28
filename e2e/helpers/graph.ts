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
// Default 60s: the documented rule ("any graph wait that follows a round-trip
// in a serial project needs 60s, not 30s") is now the default rather than a
// per-site option — indexing lag scales with suite position and chain age.
export async function waitForIndexing(targetBlock: number, timeoutMs = 60_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const current = await getIndexedBlockNumber();
		if (current >= targetBlock) return;
		await new Promise(r => setTimeout(r, 1_000));
	}
	throw new Error(`Graph did not index block ${targetBlock} within ${timeoutMs}ms`);
}

/** Fetches all conversations for a given owner address */
export async function getConversations(
	ownerAddress: string,
): Promise<Array<{ id: string; lastMessageCreatedAt: string; conversationCID: string }>> {
	const data = await graphQuery<{
		conversations: Array<{ id: string; lastMessageCreatedAt: string; conversationCID: string }>;
	}>(
		`query($owner: Bytes!) {
      conversations(where: { owner: $owner }, orderBy: lastMessageCreatedAt, orderDirection: desc) {
        id
        lastMessageCreatedAt
        conversationCID
      }
    }`,
		{ owner: ownerAddress.toLowerCase() },
	);
	return data.conversations;
}

/** Fetches pending payments (stuck requests) for a given user */
/** All payments for a user regardless of lifecycle status. A payment is PENDING
 *  only between prompt submission and the oracle's answer — with the fast mocked
 *  oracle it is usually SETTLED by the time a spec queries, so existence checks
 *  must not filter on PENDING (that made T-GRAPH-02 a race). */
export async function getPayments(
	userAddress: string,
): Promise<Array<{ id: string; amount: string; status: string }>> {
	const data = await graphQuery<{
		payments: Array<{ id: string; amount: string; status: string }>;
	}>(
		`query($user: Bytes!) {
      payments(where: { user: $user }) {
        id
        amount
        status
      }
    }`,
		{ user: userAddress.toLowerCase() },
	);
	return data.payments;
}

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
export async function getConversation(conversationId: string): Promise<IndexedConversation | null> {
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

/**
 * All conversations for an owner WITH their branch lineage, in a SINGLE query.
 * The list variant of getConversation: selecting `branchedFrom` inline avoids the
 * 1+N fan-out (and its TOCTOU window) of listing ids and then fetching each
 * conversation's detail separately — which matters when polled by waitForGraph.
 * Newest first.
 */
export async function getConversationsWithLineage(
	ownerAddress: string,
): Promise<IndexedConversation[]> {
	const data = await graphQuery<{ conversations: IndexedConversation[] }>(
		`query($owner: Bytes!) {
      conversations(where: { owner: $owner }, orderBy: lastMessageCreatedAt, orderDirection: desc) {
        id
        conversationCID
        conversationMetadataCID
        lastMessageCreatedAt
        isDeleted
        branchedFrom { id }
      }
    }`,
		{ owner: ownerAddress.toLowerCase() },
	);
	return data.conversations;
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
		// RegenerationRequest is an immutable event entity — it has `timestamp`/
		// `blockNumber`, not `createdAt` (unlike Message/PromptRequest) — so order by
		// timestamp for a deterministic result if a test ever chains regenerations.
		`query($user: Bytes!) {
      regenerationRequests(where: { user: $user }, orderBy: timestamp, orderDirection: asc) {
        id
        originalAnswerMessageId
        answerMessageId
      }
    }`,
		{ user: userAddress.toLowerCase() },
	);
	return data.regenerationRequests;
}

/** The protocol-wide fee config singleton (id "singleton"), written by the escrow's
 *  *FeeUpdated handlers. Fees are BigInt strings (wei-scale); null until first set. */
export interface IndexedFeeConfig {
	id: string;
	promptFee: string | null;
	branchFee: string | null;
	cancellationFee: string | null;
	metadataUpdateFee: string | null;
	updatedAt: string;
}

/** Reads the FeeConfig singleton, or null if it hasn't been created yet. */
export async function getFeeConfig(): Promise<IndexedFeeConfig | null> {
	const data = await graphQuery<{ feeConfig: IndexedFeeConfig | null }>(
		`query {
      feeConfig(id: "singleton") {
        id
        promptFee
        branchFee
        cancellationFee
        metadataUpdateFee
        updatedAt
      }
    }`,
	);
	return data.feeConfig;
}

/** The protocol address config singleton (id "singleton"), written by the
 *  AgentEscrowUpdated / OracleUpdated / TreasuryUpdated handlers. Addresses are
 *  lowercase Bytes hex; null until the corresponding event first fires. */
export interface IndexedProtocolConfig {
	id: string;
	escrowAddress: string | null;
	oracleAddress: string | null;
	treasuryAddress: string | null;
	updatedAt: string;
}

/** Reads the ProtocolConfig singleton, or null if it hasn't been created yet. */
export async function getProtocolConfig(): Promise<IndexedProtocolConfig | null> {
	const data = await graphQuery<{ protocolConfig: IndexedProtocolConfig | null }>(
		`query {
      protocolConfig(id: "singleton") {
        id
        escrowAddress
        oracleAddress
        treasuryAddress
        updatedAt
      }
    }`,
	);
	return data.protocolConfig;
}

/** A row from the protocol-wide `Activity` log (immutable, id = txHash-logIndex), written by
 *  the escrow/agent handlers. `type` ∈ CONVERSATION/RENAME/DELETE/METADATA_UPDATE/BRANCH/CANCEL/
 *  REFUND/PLAN_UPDATE/PLAN_REVOKE; `amount` is wei-scale (0 for non-financial actions). */
export interface IndexedActivity {
	id: string;
	type: string;
	amount: string;
	timestamp: string;
	transactionHash: string;
}

/** Recent on-chain Activity rows for a user, newest-first — mirrors the dApp's GET_RECENT_ACTIVITY
 *  (the RecentActivityCard's source). Lets a test cross-check that an action (plan activation,
 *  prompt, refund) wrote the expected Activity that the dashboard then renders as a labelled row.
 *  `first` defaults to 20 to match RecentActivityCard's `useRecentActivity(20)` window — so the
 *  helper only confirms indexing of items the UI would actually show, and never operates on a
 *  silently graph-node-truncated list (the default page size is 100). */
export async function getActivities(userAddress: string, first = 20): Promise<IndexedActivity[]> {
	const data = await graphQuery<{ activities: IndexedActivity[] }>(
		`query($user: Bytes!, $first: Int!) {
      activities(where: { user: $user }, orderBy: timestamp, orderDirection: desc, first: $first) {
        id
        type
        amount
        timestamp
        transactionHash
      }
    }`,
		{ user: userAddress.toLowerCase(), first },
	);
	return data.activities;
}

/**
 * Polls `query()` until `predicate` is satisfied, returning the matching value.
 * The generic indexing-aware wait the assertion helpers above compose with —
 * the subgraph lags the chain by a block or two, so reads must be retried.
 */
export async function waitForGraph<T>(
	query: () => Promise<T>,
	predicate: (_value: T) => boolean,
	{ timeoutMs = 60_000, label = 'condition' }: { timeoutMs?: number; label?: string } = {},
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let last: T | undefined;
	let lastError: unknown;
	do {
		try {
			last = await query();
			if (predicate(last)) return last;
		} catch (err) {
			// A transient subgraph/network error (graph-node restarting, an HTTP 5xx, a cold
			// endpoint) must not fail the whole wait — keep polling until the deadline.
			lastError = err;
		}
		await new Promise(r => setTimeout(r, 1_000));
	} while (Date.now() < deadline);
	const tail = lastError ? ` (last error: ${String(lastError)})` : '';
	throw new Error(
		`waitForGraph: ${label} not met within ${timeoutMs}ms. Last value: ${JSON.stringify(
			last,
		)}${tail}`,
	);
}
