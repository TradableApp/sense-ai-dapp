import { describe, expect, it, vi } from 'vitest';

import { backoffDelayMs } from '@/lib/backoff';

import {
	fetchPayload,
	PAYLOAD_RETRY_ATTEMPTS,
	PAYLOAD_RETRY_BASE_MS,
	type PayloadFetchDeps,
	resolvePayloadSources,
} from './payloadStorage';

const AUTONOMYS_CID = `bafkr6i${'a'.repeat(52)}`;
const ARWEAVE_CID = 'A'.repeat(43);
const IPFS_CID = `bafy${'b'.repeat(40)}`;
const MIRROR = 'https://storage.googleapis.com/tradable-app-garrick-senseai-payloads/';
const AUTONOMYS_GATEWAY = `https://gateway.autonomys.xyz/file/${AUTONOMYS_CID}`;

function response(status: number, body = ''): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => body,
	} as unknown as Response;
}

type FetchImpl = (_url: string) => Promise<Response>;

function makeDeps(impl: FetchImpl) {
	const waits: number[] = [];
	const report = vi.fn<PayloadFetchDeps['report']>();
	const deps: PayloadFetchDeps = {
		fetch: vi.fn(impl) as unknown as PayloadFetchDeps['fetch'],
		report,
		wait: async (ms: number) => {
			waits.push(ms);
		},
		random: () => 0,
	};
	return {
		deps,
		waits,
		report,
		calls: () => (deps.fetch as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]),
	};
}

describe('resolvePayloadSources', () => {
	it('tries the mirror before the Autonomys gateway when a mirror is configured', () => {
		expect(resolvePayloadSources(AUTONOMYS_CID, { mirrorUrl: MIRROR })).toEqual([
			{ source: 'mirror', url: `${MIRROR}${AUTONOMYS_CID}` },
			{ source: 'gateway', url: AUTONOMYS_GATEWAY },
		]);
	});

	it('normalises a mirror base without a trailing slash', () => {
		const [mirror] = resolvePayloadSources(AUTONOMYS_CID, { mirrorUrl: MIRROR.slice(0, -1) });
		expect(mirror.url).toBe(`${MIRROR}${AUTONOMYS_CID}`);
	});

	it('uses the gateway alone when no mirror is configured', () => {
		expect(resolvePayloadSources(AUTONOMYS_CID, {})).toEqual([
			{ source: 'gateway', url: AUTONOMYS_GATEWAY },
		]);
	});

	it('sends legacy Arweave ids to the Irys gateway only — the mirror never holds them', () => {
		expect(resolvePayloadSources(ARWEAVE_CID, { mirrorUrl: MIRROR })).toEqual([
			{ source: 'gateway', url: `https://gateway.irys.xyz/${ARWEAVE_CID}` },
		]);
	});

	it('sends localnet IPFS ids to the local gateway only, never the mirror', () => {
		expect(
			resolvePayloadSources(IPFS_CID, {
				mirrorUrl: MIRROR,
				storageGatewayUrl: 'http://localhost:8080/ipfs/',
			}),
		).toEqual([{ source: 'gateway', url: `http://localhost:8080/ipfs/${IPFS_CID}` }]);
	});

	it('returns no sources for an unsupported id', () => {
		expect(resolvePayloadSources('not-a-cid', { mirrorUrl: MIRROR })).toEqual([]);
		expect(resolvePayloadSources(IPFS_CID, { mirrorUrl: MIRROR })).toEqual([]);
	});
});

describe('fetchPayload', () => {
	const config = { mirrorUrl: MIRROR };

	it('returns the mirror body without touching the gateway', async () => {
		const { deps, waits, report, calls } = makeDeps(async () => response(200, 'cipher'));

		await expect(fetchPayload(AUTONOMYS_CID, config, deps)).resolves.toEqual({
			ok: true,
			data: 'cipher',
			source: 'mirror',
		});
		expect(calls()).toEqual([`${MIRROR}${AUTONOMYS_CID}`]);
		expect(waits).toEqual([]);
		expect(report).not.toHaveBeenCalled();
	});

	it('falls through to the gateway on a mirror miss, without retrying the mirror', async () => {
		const { deps, waits, report, calls } = makeDeps(async url =>
			url.startsWith(MIRROR) ? response(404) : response(200, 'from-gateway'),
		);

		await expect(fetchPayload(AUTONOMYS_CID, config, deps)).resolves.toEqual({
			ok: true,
			data: 'from-gateway',
			source: 'gateway',
		});
		expect(calls()).toEqual([`${MIRROR}${AUTONOMYS_CID}`, AUTONOMYS_GATEWAY]);
		expect(waits).toEqual([]);
		expect(report).toHaveBeenCalledWith('payload fetch: mirror miss', { cid: AUTONOMYS_CID });
	});

	it('retries a gateway 5xx with the shared backoff and then succeeds', async () => {
		let gatewayCalls = 0;
		const { deps, waits, report } = makeDeps(async url => {
			if (url.startsWith(MIRROR)) return response(404);
			gatewayCalls += 1;
			return gatewayCalls === 1 ? response(503) : response(200, 'late');
		});

		const result = await fetchPayload(AUTONOMYS_CID, config, deps);

		expect(result).toEqual({ ok: true, data: 'late', source: 'gateway' });
		expect(waits).toEqual([backoffDelayMs(0, PAYLOAD_RETRY_BASE_MS, () => 0)]);
		expect(report).toHaveBeenCalledWith('payload fetch: retrying', {
			cid: AUTONOMYS_CID,
			source: 'gateway',
			status: 503,
			attempt: 1,
			delayMs: waits[0],
		});
	});

	it('gives up as unavailable after the retry budget, with growing delays', async () => {
		const { deps, waits, report, calls } = makeDeps(async url =>
			url.startsWith(MIRROR) ? response(404) : response(503),
		);

		await expect(fetchPayload(AUTONOMYS_CID, config, deps)).resolves.toEqual({
			ok: false,
			reason: 'unavailable',
		});
		// One mirror probe plus the full gateway budget.
		expect(calls()).toHaveLength(1 + PAYLOAD_RETRY_ATTEMPTS);
		expect(waits).toEqual(
			Array.from({ length: PAYLOAD_RETRY_ATTEMPTS - 1 }, (_, attempt) =>
				backoffDelayMs(attempt, PAYLOAD_RETRY_BASE_MS, () => 0),
			),
		);
		expect(report).toHaveBeenLastCalledWith('payload fetch: unavailable', {
			cid: AUTONOMYS_CID,
			sources: ['mirror', 'gateway'],
		});
	});

	it('treats a network failure and a 429 as retriable', async () => {
		let gatewayCalls = 0;
		const { deps, waits } = makeDeps(async url => {
			if (url.startsWith(MIRROR)) return response(404);
			gatewayCalls += 1;
			if (gatewayCalls === 1) throw new TypeError('Failed to fetch');
			if (gatewayCalls === 2) return response(429);
			return response(200, 'ok');
		});

		await expect(fetchPayload(AUTONOMYS_CID, config, deps)).resolves.toMatchObject({
			ok: true,
			data: 'ok',
		});
		expect(waits).toHaveLength(2);
	});

	it('reports not-found, with no retries, when every source returns 404', async () => {
		const { deps, waits, calls } = makeDeps(async () => response(404));

		await expect(fetchPayload(AUTONOMYS_CID, config, deps)).resolves.toEqual({
			ok: false,
			reason: 'not-found',
		});
		expect(calls()).toEqual([`${MIRROR}${AUTONOMYS_CID}`, AUTONOMYS_GATEWAY]);
		expect(waits).toEqual([]);
	});

	it('is unavailable, not not-found, when the gateway is down behind a mirror miss', async () => {
		const { deps } = makeDeps(async url =>
			url.startsWith(MIRROR) ? response(404) : response(502),
		);

		await expect(fetchPayload(AUTONOMYS_CID, config, deps)).resolves.toEqual({
			ok: false,
			reason: 'unavailable',
		});
	});

	it('is unavailable, not not-found, when the mirror is exhausted and the gateway then 404s', async () => {
		// The gateway's 404 is not authoritative while another source could not be asked
		// properly: fresh uploads reach the two sources at different times. Reporting
		// 'unavailable' holds the sync cursor so the payload is retried next pass.
		const { deps, calls } = makeDeps(async url =>
			url.startsWith(MIRROR) ? response(503) : response(404),
		);

		await expect(fetchPayload(AUTONOMYS_CID, config, deps)).resolves.toEqual({
			ok: false,
			reason: 'unavailable',
		});
		expect(calls()).toHaveLength(PAYLOAD_RETRY_ATTEMPTS + 1);
	});

	it('rejects an unsupported id without a network call', async () => {
		const { deps, calls } = makeDeps(async () => response(200, 'never'));

		await expect(fetchPayload('nope', config, deps)).resolves.toEqual({
			ok: false,
			reason: 'unsupported-cid',
		});
		expect(calls()).toEqual([]);
	});
});
