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
