// @vitest-environment node
//
// The subgraph endpoint is shared infrastructure with a quota. When it refuses (HTTP 429 with
// "Too many requests" as text/html) the suite must say so — on the 2026-11-09 run day the first
// symptom was `SyntaxError: Unexpected token 'T', "Too many r"... is not valid JSON` buried in a
// waitForGraph timeout, and the run burned 15 more minutes before anyone read it.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GraphUnavailableError, graphQuery, waitForGraph } from './graph';

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
		vi.stubGlobal('fetch', vi.fn(async () => tooManyRequests()));

		const err = await graphQuery('{ _meta { block { number } } }').catch(e => e);

		expect(err).toBeInstanceOf(GraphUnavailableError);
		expect(err.status).toBe(429);
		expect(err.message).toMatch(/HTTP 429/);
		expect(err.message).toMatch(/quota/i);
		expect(err.message).toMatch(/2026-11-10T20:14:27/);
	});

	it('names the status instead of a JSON parse error when a non-2xx answer is not JSON', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })));

		const err = await graphQuery('{ _meta { block { number } } }').catch(e => e);

		expect(err).toBeInstanceOf(GraphUnavailableError);
		expect(err.status).toBe(502);
		expect(err.message).not.toMatch(/SyntaxError|Unexpected token/);
	});

	it('still returns data on a healthy answer', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(META, { status: 200 })));
		await expect(graphQuery<{ _meta: unknown }>('{ _meta { block { number } } }')).resolves.toEqual({
			_meta: { block: { number: 1 } },
		});
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
