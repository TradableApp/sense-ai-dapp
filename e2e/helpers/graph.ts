/**
 * Local Graph node helpers for use in Playwright tests.
 */

const GRAPH_URL = 'http://localhost:8000/subgraphs/name/sense-ai';

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

/** Returns true if the local Graph node is reachable */
export async function isGraphRunning(): Promise<boolean> {
	try {
		await graphQuery('{ _meta { block { number } } }');
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
