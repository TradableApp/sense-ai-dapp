// @vitest-environment node
//
// The subgraph endpoint is shared infrastructure with a quota. When it refuses (HTTP 429 with
// "Too many requests" as text/html) the suite must say so — on the 2026-11-09 run day the first
// symptom was `SyntaxError: Unexpected token 'T', "Too many r"... is not valid JSON` buried in a
// waitForGraph timeout, and the run burned 15 more minutes before anyone read it.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { graphQuery, GraphUnavailableError, probeSubgraph, waitForGraph } from './graph';

const META = JSON.stringify({ data: { _meta: { block: { number: 1 } } } });

function tooManyRequests(): Response {
	return new Response('Too many requests, please try again later.', {
		status: 429,
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'x-ratelimit-limit': '3000',
			'x-ratelimit-remaining': '0',
			'x-ratelimit-reset': '1794341667',
			'retry-after': '70876',
		},
	});
}

describe('graphQuery', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('turns an HTTP 429 into a GraphUnavailableError that names the status and the quota reset', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => tooManyRequests()),
		);

		const err = (await graphQuery('{ _meta { block { number } } }').catch(
			(e: unknown) => e,
		)) as GraphUnavailableError;

		expect(err).toBeInstanceOf(GraphUnavailableError);
		expect(err.status).toBe(429);
		expect(err.message).toMatch(/HTTP 429/);
		expect(err.message).toMatch(/quota/i);
		expect(err.message).toMatch(/2026-11-10T20:14:27/);
	});

	it('names the status instead of a JSON parse error when a non-2xx answer is not JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })),
		);

		const err = (await graphQuery('{ _meta { block { number } } }').catch(
			(e: unknown) => e,
		)) as GraphUnavailableError;

		expect(err).toBeInstanceOf(GraphUnavailableError);
		expect(err.status).toBe(502);
		expect(err.message).not.toMatch(/SyntaxError|Unexpected token/);
	});

	it('still returns data on a healthy answer', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(META, { status: 200 })),
		);
		await expect(graphQuery<{ _meta: unknown }>('{ _meta { block { number } } }')).resolves.toEqual(
			{
				_meta: { block: { number: 1 } },
			},
		);
	});
});

describe('waitForGraph', () => {
	it('fails at once on a quota refusal instead of polling the dead endpoint until the deadline', async () => {
		const sleep = vi.fn(async () => {});
		const query = vi.fn(async () => {
			throw new GraphUnavailableError(429, 'Graph HTTP 429: query quota exhausted');
		});

		await expect(
			waitForGraph(query, () => true, { timeoutMs: 60_000, label: 'x', sleep }),
		).rejects.toThrow(/HTTP 429/);
		expect(query).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('polls at the chain budget and backs off on transient errors, capped at 8 s', async () => {
		const delays: number[] = [];
		const sleep = vi.fn(async (ms: number) => {
			delays.push(ms);
		});
		let calls = 0;
		const query = vi.fn(async () => {
			calls += 1;
			if (calls <= 4) throw new GraphUnavailableError(502, 'Graph HTTP 502');
			return calls;
		});

		await expect(
			waitForGraph(query, v => v >= 6, { timeoutMs: 60_000, label: 'x', sleep, pollMs: 2_000 }),
		).resolves.toBe(6);
		// four errors: 2 s → 4 s → 8 s → 8 s (capped); then a success resets to the base poll
		expect(delays).toEqual([2_000, 4_000, 8_000, 8_000, 2_000]);
	});
});

describe('probeSubgraph', () => {
	const KEYED =
		'https://gateway.thegraph.com/api/0123456789abcdef0123456789abcdef/subgraphs/id/H4Xz';
	const healthy = () =>
		new Response(JSON.stringify({ data: { _meta: { block: { number: 1 } } } }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	const noIndexer = () => new Response('no indexers available for ' + KEYED, { status: 503 });

	it('is ok on a healthy endpoint with one request', async () => {
		const fetchMock = vi.fn(async () => healthy());
		vi.stubGlobal('fetch', fetchMock);

		const result = await probeSubgraph(KEYED, {
			attempts: 3,
			timeoutMs: 1_000,
			sleep: async () => {},
		});

		expect(result.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('retries a transient 5xx up to the attempt count and reports the last status without the key', async () => {
		const sleeps: number[] = [];
		const fetchMock = vi.fn(async () => noIndexer());
		vi.stubGlobal('fetch', fetchMock);

		const result = await probeSubgraph(KEYED, {
			attempts: 3,
			timeoutMs: 1_000,
			sleep: async ms => {
				sleeps.push(ms);
			},
		});

		expect(result.ok).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(sleeps).toHaveLength(2);
		if (!result.ok) {
			expect(result.detail).toMatch(/HTTP 503/);
			expect(result.detail).not.toMatch(/0123456789abcdef0123456789abcdef/);
		}
	});

	it('recovers when a later attempt succeeds', async () => {
		let n = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => (n++ === 0 ? noIndexer() : healthy())),
		);

		const result = await probeSubgraph(KEYED, {
			attempts: 2,
			timeoutMs: 1_000,
			sleep: async () => {},
		});

		expect(result.ok).toBe(true);
	});

	it('treats a GraphQL error body as unhealthy and names it', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ errors: [{ message: 'subgraph not found: Qm1' }] }), {
						status: 200,
						headers: { 'content-type': 'application/json' },
					}),
			),
		);

		const result = await probeSubgraph(KEYED, {
			attempts: 1,
			timeoutMs: 1_000,
			sleep: async () => {},
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.detail).toMatch(/subgraph not found/);
	});

	it('reports a timeout as such', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url: string, init?: { signal?: AbortSignal }) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () =>
							reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })),
						);
					}),
			),
		);

		const result = await probeSubgraph(KEYED, {
			attempts: 1,
			timeoutMs: 20,
			sleep: async () => {},
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.detail).toMatch(/timed out after 20 ms/);
	});
});
