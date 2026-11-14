/**
 * Local Graph node helpers for use in Playwright tests.
 */

import { BUDGET } from './budgets';
import { CHAIN, type ChainName, redactUrl } from './chain';

// Single source of truth for the subgraph endpoint, env-aware so the health
// check (global-setup) and the test queries always target the same URL.
/**
 * Which subgraph endpoint the Node-side helpers and the health check use.
 *
 * On testnet the runner exports `TESTNET_GRAPH_URL`, its own gateway key with no domain
 * restriction, and that wins: the dApp's `VITE_THE_GRAPH_API_URL` carries a key restricted to the
 * hosted site's domain, and Node sends no Origin, so the gateway refuses it ("auth error: domain
 * not authorized by user" — runs 20261110T030552Z and 031616Z). On localnet the dApp's variable
 * (or the local graph-node default) is the endpoint, and a stray `TESTNET_GRAPH_URL` in the shell
 * is ignored.
 */
export function resolveGraphUrl(env: Record<string, string | undefined>, chain: ChainName): string {
	if (chain === 'testnet' && env.TESTNET_GRAPH_URL) return env.TESTNET_GRAPH_URL;
	// The literal is the dApp variable's fallback only (the endpoint-consistency guard forbids a
	// bare localnet literal); sync-config.sh derives the real value from $PORT_GRAPH.
	return env.VITE_THE_GRAPH_API_URL || 'http://localhost:8000/subgraphs/name/sense-ai';
}

export const GRAPH_URL = resolveGraphUrl(process.env, CHAIN);

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
			`Invalid Graph endpoint "${redactUrl(
				GRAPH_URL,
			)}". Set VITE_THE_GRAPH_API_URL (or TESTNET_GRAPH_URL on testnet) to an absolute ` +
				`http(s) URL including the scheme, e.g. http://localhost:8000/subgraphs/name/sense-ai.`,
		);
	}
})();
const GRAPH_PROBE_TIMEOUT_MS = 5_000;
/** Longest pause between two reads while the endpoint is erroring. */
const GRAPH_BACKOFF_CAP_MS = 8_000;

/**
 * The subgraph endpoint refused or answered something other than JSON. Carries the HTTP status so
 * callers can tell a quota refusal (429, lasts until the reset) from a transient 5xx; the message is
 * what the run-day operator reads, so it names the status and, for 429, when the quota resets.
 */
export class GraphUnavailableError extends Error {
	readonly status: number;

	/**
	 * Seconds until the quota resets, from the `retry-after` header. Diagnostic only: a 429 ends
	 * the wait (no caller sleeps on this), it is here so the operator's message and any logged
	 * error carry the number.
	 */
	readonly retryAfterS: number | undefined;

	constructor(status: number, message: string, retryAfterS?: number) {
		super(message);
		this.name = 'GraphUnavailableError';
		this.status = status;
		this.retryAfterS = retryAfterS;
	}
}

function describeRefusal(res: Response, bodyHead: string): GraphUnavailableError {
	const retryAfter = Number(res.headers.get('retry-after') ?? '');
	const hasRetryAfter = Number.isFinite(retryAfter) && retryAfter > 0;
	if (res.status === 429) {
		const reset = Number(res.headers.get('x-ratelimit-reset') ?? '');
		const limit = res.headers.get('x-ratelimit-limit');
		const when =
			Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : 'unknown';
		const limitNote = limit ? ` (limit ${limit}/day)` : '';
		const retryNote = hasRetryAfter ? ` (retry-after ${retryAfter}s)` : '';
		return new GraphUnavailableError(
			429,
			`Graph HTTP 429: query quota exhausted${limitNote}, resets ${when}${retryNote} — the endpoint is a stack limit, not a test failure`,
			hasRetryAfter ? retryAfter : undefined,
		);
	}
	return new GraphUnavailableError(
		res.status,
		`Graph HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}: ${
			bodyHead || '(empty body)'
		}`,
		Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
	);
}

/** One POST to the subgraph. Exported for the tests; the typed readers below are the callers. */
export async function graphQuery<T>(
	query: string,
	variables: Record<string, unknown> = {},
): Promise<T> {
	const res = await fetch(GRAPH_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	});
	const text = await res.text();
	if (!res.ok) throw describeRefusal(res, text.replace(/\s+/g, ' ').slice(0, 120));
	let json: { data?: T; errors?: Array<{ message: string }> };
	try {
		json = JSON.parse(text) as typeof json;
	} catch {
		throw new GraphUnavailableError(
			res.status,
			`Graph HTTP ${res.status} answered non-JSON: ${text.replace(/\s+/g, ' ').slice(0, 120)}`,
		);
	}
	if (json.errors?.length) throw new Error(`Graph error: ${json.errors[0].message}`);
	if (!json.data) throw new Error('Graph returned no data');
	return json.data;
}

export type SubgraphProbe = { ok: true } | { ok: false; detail: string };

/**
 * Makes probe text safe to print. The exact URL and its key segment are replaced first (so a key
 * cut by truncation cannot survive), then any remaining `/api/<hex>/` run of 8+ chars is hidden.
 */
function scrubberFor(url: string): (_text: string) => string {
	const key = /\/api\/([0-9a-f]{16,})\//i.exec(url)?.[1];
	return text => {
		let out = text.split(url).join(redactUrl(url));
		if (key) out = out.split(key).join('<redacted>');
		return out.replace(/(\/api\/)[0-9a-f]{8,}(\/|$)/gi, '$1<redacted>$2');
	};
}

/** Empty string on success; otherwise a short, printable reason. */
async function probeOnce(
	url: string,
	timeoutMs: number,
	scrub: (_text: string) => string,
): Promise<string> {
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query: '{ _meta { block { number } } }' }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const text = await res.text();
		// Scrub BEFORE truncating: a key cut in half would escape a length-anchored pattern.
		const head = scrub(text.replace(/\s+/g, ' ')).slice(0, 100);
		if (!res.ok) return `HTTP ${res.status}: ${head || '(empty body)'}`;
		let json: { data?: unknown; errors?: Array<{ message: string }> };
		try {
			json = JSON.parse(text) as typeof json;
		} catch {
			return `HTTP ${res.status} answered non-JSON: ${head}`;
		}
		if (json.errors?.length) return `GraphQL error: ${scrub(json.errors[0].message)}`;
		if (!json.data) return 'GraphQL answer carried no data';
		return '';
	} catch (err) {
		if (err instanceof Error && err.name === 'TimeoutError')
			return `timed out after ${timeoutMs} ms`;
		return `request failed: ${scrub(
			err instanceof Error ? `${err.name}: ${err.message}` : String(err),
		)}`;
	}
}

/**
 * One health probe of the subgraph endpoint: a `_meta` query that must answer 200 with no
 * GraphQL errors. A public gateway can answer 5xx or slowly while a new deployment is being
 * allocated, so testnet asks several times; localnet asks once. The returned detail is safe to
 * print: it carries the status and the first words of the body, never the keyed URL.
 */
export async function probeSubgraph(
	url: string,
	{
		attempts = 1,
		timeoutMs,
		retryGapMs = 2_000,
		sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)),
	}: {
		attempts?: number;
		timeoutMs: number;
		retryGapMs?: number;
		sleep?: (_ms: number) => Promise<void>;
	},
): Promise<SubgraphProbe> {
	const scrub = scrubberFor(url);
	let detail = 'no attempt made';
	for (let attempt = 1; attempt <= attempts; attempt++) {
		detail = await probeOnce(url, timeoutMs, scrub);
		if (detail === '') return { ok: true };
		if (attempt < attempts) await sleep(retryGapMs);
	}
	const tries = `${attempts} attempt${attempts === 1 ? '' : 's'}`;
	return { ok: false, detail: scrub(`${detail} (${tries})`) };
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
	/** The conversation the regeneration was asked in (a branch's own id when asked in a branch). */
	conversationId: string;
	promptMessageId: string;
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
        conversationId
        promptMessageId
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

/** The protocol config singleton (id "singleton"), written by the AgentEscrowUpdated /
 *  TreasuryUpdated / OracleEncryptionKeyUpdated handlers. Values are lowercase Bytes hex; null
 *  until the corresponding event first fires. The encryption key is null again once the oracle
 *  that published it loses its role. The oracles are a set: see getOracles(). */
export interface IndexedProtocolConfig {
	id: string;
	escrowAddress: string | null;
	treasuryAddress: string | null;
	oracleEncryptionKey: string | null;
	updatedAt: string;
}

/** Reads the ProtocolConfig singleton, or null if it hasn't been created yet. */
export async function getProtocolConfig(): Promise<IndexedProtocolConfig | null> {
	const data = await graphQuery<{ protocolConfig: IndexedProtocolConfig | null }>(
		`query {
      protocolConfig(id: "singleton") {
        id
        escrowAddress
        treasuryAddress
        oracleEncryptionKey
        updatedAt
      }
    }`,
	);
	return data.protocolConfig;
}

/** One address that has held the oracle role (id = lowercase address). `active` is whether it
 *  holds the role now; `removedAt` is null while it does. */
export interface IndexedOracle {
	id: string;
	address: string;
	active: boolean;
	addedAt: string;
	removedAt: string | null;
}

/** Every address that has ever held the oracle role, active or not, oldest grant first. */
export async function getOracles(): Promise<IndexedOracle[]> {
	const data = await graphQuery<{ oracles: IndexedOracle[] }>(
		`query {
      oracles(first: 100, orderBy: addedAt, orderDirection: asc) {
        id
        address
        active
        addedAt
        removedAt
      }
    }`,
	);
	return data.oracles;
}

/** One immutable record per oracle added ("ADDED") or removed ("REMOVED"), oldest first.
 *  `caller` is the account that called the contract (the owner for add / remove). */
export interface IndexedOracleChange {
	id: string;
	kind: string;
	oracle: string | null;
	caller: string | null;
	blockNumber: string;
}

/** The add / remove history of one oracle address, oldest first. */
export async function getOracleChanges(oracle: string): Promise<IndexedOracleChange[]> {
	const data = await graphQuery<{ oracleChanges: IndexedOracleChange[] }>(
		`query($oracle: Bytes!) {
      oracleChanges(where: { oracle: $oracle }, orderBy: blockNumber, orderDirection: asc) {
        id
        kind
        oracle
        caller
        blockNumber
      }
    }`,
		{ oracle: oracle.toLowerCase() },
	);
	return data.oracleChanges;
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
	{
		timeoutMs = 60_000,
		label = 'condition',
		pollMs = BUDGET.graphPollMs,
		sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)),
	}: {
		timeoutMs?: number;
		label?: string;
		/** Base interval between reads; the chain budget by default. */
		pollMs?: number;
		/** Injectable for tests. */
		sleep?: (_ms: number) => Promise<void>;
	} = {},
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let last: T | undefined;
	let lastError: unknown;
	let delay = pollMs;
	do {
		let wait = pollMs;
		try {
			last = await query();
			if (predicate(last)) return last;
			delay = pollMs;
		} catch (err) {
			// A quota refusal lasts until the endpoint's reset — polling cannot outwait it inside a
			// test budget, and every further read is another query against a quota of zero. Fail now
			// with the endpoint's own message so the operator stops the run instead of reading
			// 60 s timeouts for the next two hours.
			if (err instanceof GraphUnavailableError && err.status === 429) throw err;
			// A transient subgraph/network error (graph-node restarting, an HTTP 5xx, a cold
			// endpoint) must not fail the whole wait — keep polling until the deadline, backing off
			// so a struggling endpoint is not hammered: base → 2× → 4× … capped at 8 s.
			lastError = err;
			wait = delay;
			delay = Math.min(delay * 2, GRAPH_BACKOFF_CAP_MS);
		}
		await sleep(wait);
	} while (Date.now() < deadline);

	// One final read after the deadline — the loop queries, sleeps, THEN tests the deadline, so
	// an entity indexed during that last sleep was never seen and the wait threw with data that
	// had already arrived. On a subgraph that lags the chain by a block or two this is a real
	// race on a healthy stack, and it presents as a FLAKY test rather than an honest failure,
	// which is the hardest kind to attribute. (Found via the copy of this helper in brain.ts;
	// the bug was here first and backs the indexing waits in activity/graph/history/refunds.)
	try {
		last = await query();
		if (predicate(last)) return last;
	} catch (err) {
		if (err instanceof GraphUnavailableError && err.status === 429) throw err;
		lastError = err;
	}

	const tail = lastError ? ` (last error: ${String(lastError)})` : '';
	throw new Error(
		`waitForGraph: ${label} not met within ${timeoutMs}ms. Last value: ${JSON.stringify(
			last,
		)}${tail}`,
	);
}
