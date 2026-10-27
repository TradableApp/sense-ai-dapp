/**
 * @file payloadStorage.ts
 * @notice The single place the dApp fetches encrypted payload bytes by content id.
 * @dev Source order is "our mirror first, the public gateway second". The oracle writes
 *      every Autonomys CID through to a public-read GCS bucket (the mirror) at upload
 *      time, so under normal conditions reads never touch gateway.autonomys.xyz at all;
 *      the gateway is the fallback for payloads the mirror has not (yet) got, and the
 *      permanence layer behind both. A 404 moves straight on to the next source; 5xx,
 *      429 and network errors are retried a bounded number of times with the same
 *      jittered backoff the live poller uses. Callers get a typed result rather than
 *      `null`, so a transient outage (`unavailable`) is distinguishable from a payload
 *      that genuinely does not exist (`not-found`) and can be surfaced to the user.
 *
 *      `not-found` is only reported when EVERY source answered definitively: if any source
 *      was exhausted on retriable errors the result is `unavailable`, even when another
 *      source said 404, because that source may simply not have the payload yet (the
 *      gateway lags fresh uploads; the mirror lags the gateway). Holding the sync cursor
 *      for one more pass is cheaper than stranding a conversation.
 *
 *      Integrity: payloads are AES-GCM ciphertext, so a tampered or truncated body from
 *      any source fails authenticated decryption in the caller and is discarded.
 *
 *      The `e2e/__guards__/no-raw-storage-gateways` guard keeps the host names in here.
 */

import { backoffDelayMs } from '@/lib/backoff';

export type PayloadSource = 'mirror' | 'gateway';

export interface PayloadSourceUrl {
	source: PayloadSource;
	url: string;
}

export interface PayloadStorageConfig {
	/** Public base URL of the GCS mirror bucket (`VITE_PAYLOAD_MIRROR_URL`). Unset → no mirror. */
	mirrorUrl?: string;
	/**
	 * Localnet only (`VITE_STORAGE_GATEWAY_URL`): the e2e stack's IPFS gateway. When set,
	 * IPFS-style ids are served from it alone — localnet has no mirror.
	 */
	storageGatewayUrl?: string;
}

/** The slice of a `Response` the resolver reads; lets the caller wrap timeouts around the body too. */
export interface PayloadResponse {
	ok: boolean;
	status: number;
	text(): Promise<string>;
}

export interface PayloadFetchDeps {
	fetch: (_url: string) => Promise<PayloadResponse>;
	/** Observability sink (a Sentry breadcrumb in production). Never throws. */
	report: (_message: string, _data: Record<string, unknown>) => void;
	wait: (_ms: number) => Promise<void>;
	random: () => number;
}

export type PayloadFetchResult =
	| { ok: true; data: string; source: PayloadSource }
	| { ok: false; reason: 'not-found' | 'unavailable' | 'unsupported-cid' };

/** Attempts per source before moving on (first try included). */
export const PAYLOAD_RETRY_ATTEMPTS = 3;
/** First backoff step; doubles per attempt, capped and jittered by `backoffDelayMs`. */
export const PAYLOAD_RETRY_BASE_MS = 500;

// Autonomys Auto Drive — CIDv1 base32 with the 'bafkr6i' prefix. Checked first because
// it is a subset of the broad IPFS pattern below.
const AUTONOMYS_CID = /^bafkr6i[a-z2-7]{52}$/;
// Our localnet IPFS CIDs (Kubo, CIDv1 base32).
const IPFS_CID = /^baf[ky][a-z2-7]{20,}$/;
// Legacy Arweave/Irys ids: base64url, 43 chars (Irys occasionally 44).
const ARWEAVE_ID = /^[a-zA-Z0-9_-]{43,44}$/;

const withTrailingSlash = (base: string) => (base.endsWith('/') ? base : `${base}/`);

/**
 * @notice Resolves the ordered list of URLs to try for a content id.
 * @returns An empty list when the id is not one the dApp knows how to fetch — including an
 *          IPFS id when no local gateway is configured, which would otherwise be misread as
 *          an Arweave id and sent to Irys.
 */
export function resolvePayloadSources(
	cid: string,
	config: PayloadStorageConfig,
): PayloadSourceUrl[] {
	if (!cid) return [];

	const mirror: PayloadSourceUrl[] = config.mirrorUrl
		? [{ source: 'mirror', url: `${withTrailingSlash(config.mirrorUrl)}${cid}` }]
		: [];

	if (AUTONOMYS_CID.test(cid)) {
		return [...mirror, { source: 'gateway', url: `https://gateway.autonomys.xyz/file/${cid}` }];
	}

	if (IPFS_CID.test(cid)) {
		return config.storageGatewayUrl
			? [{ source: 'gateway', url: `${withTrailingSlash(config.storageGatewayUrl)}${cid}` }]
			: [];
	}

	// Legacy Arweave/Irys ids pre-date the mirror and the oracle never writes them to it
	// (the hook runs on Autonomys uploads only), so asking the mirror would be a guaranteed
	// miss and a wasted round-trip. Revisit if the mirror ever starts holding them.
	if (ARWEAVE_ID.test(cid)) {
		return [{ source: 'gateway', url: `https://gateway.irys.xyz/${cid}` }];
	}

	return [];
}

const isRetriableStatus = (status: number) => status === 429 || status >= 500;

type AttemptOutcome =
	| { kind: 'hit'; data: string }
	| { kind: 'miss' }
	| { kind: 'retriable'; status: number | 'network' };

async function attempt(url: string, fetchImpl: PayloadFetchDeps['fetch']): Promise<AttemptOutcome> {
	try {
		const response = await fetchImpl(url);
		// Reading the body is inside the try on purpose: a stream that drops mid-way is a
		// network failure like any other and must not escape as a rejection.
		if (response.ok) return { kind: 'hit', data: await response.text() };
		if (isRetriableStatus(response.status)) return { kind: 'retriable', status: response.status };
		// 404 and any other definitive client error: this source does not have it.
		return { kind: 'miss' };
	} catch {
		return { kind: 'retriable', status: 'network' };
	}
}

type SourceOutcome = { kind: 'hit'; data: string } | { kind: 'miss' } | { kind: 'exhausted' };

/** One source, retried with backoff until it answers definitively or the budget runs out. */
async function fetchFromSource(
	cid: string,
	{ source, url }: PayloadSourceUrl,
	deps: PayloadFetchDeps,
	attemptIndex = 0,
): Promise<SourceOutcome> {
	const outcome = await attempt(url, deps.fetch);

	if (outcome.kind === 'hit') return outcome;

	if (outcome.kind === 'miss') {
		if (source === 'mirror') deps.report('payload fetch: mirror miss', { cid });
		return outcome;
	}

	if (attemptIndex === PAYLOAD_RETRY_ATTEMPTS - 1) return { kind: 'exhausted' };

	const delayMs = backoffDelayMs(attemptIndex, PAYLOAD_RETRY_BASE_MS, deps.random);
	deps.report('payload fetch: retrying', {
		cid,
		source,
		status: outcome.status,
		attempt: attemptIndex + 1,
		delayMs,
	});
	await deps.wait(delayMs);
	return fetchFromSource(cid, { source, url }, deps, attemptIndex + 1);
}

/** Walks the sources in order; the first hit wins. */
async function fetchFromSources(
	cid: string,
	sources: PayloadSourceUrl[],
	deps: PayloadFetchDeps,
	index = 0,
	sawRetriableFailure = false,
): Promise<PayloadFetchResult> {
	if (index >= sources.length) {
		const tried = sources.map(s => s.source);
		if (sawRetriableFailure) {
			deps.report('payload fetch: unavailable', { cid, sources: tried });
			return { ok: false, reason: 'unavailable' };
		}
		deps.report('payload fetch: not found', { cid, sources: tried });
		return { ok: false, reason: 'not-found' };
	}

	const outcome = await fetchFromSource(cid, sources[index], deps);
	if (outcome.kind === 'hit')
		return { ok: true, data: outcome.data, source: sources[index].source };

	return fetchFromSources(
		cid,
		sources,
		deps,
		index + 1,
		sawRetriableFailure || outcome.kind === 'exhausted',
	);
}

/**
 * @notice Fetches a payload, trying each resolved source in order with bounded retries.
 * @dev Pure in its dependencies so the retry schedule is unit-testable without timers.
 */
export async function fetchPayload(
	cid: string,
	config: PayloadStorageConfig,
	deps: PayloadFetchDeps,
): Promise<PayloadFetchResult> {
	const sources = resolvePayloadSources(cid, config);
	if (sources.length === 0) return { ok: false, reason: 'unsupported-cid' };
	return fetchFromSources(cid, sources, deps);
}
