/**
 * Live-update probe for the dashboard (sense-ai-dapp#77).
 *
 * The dApp used to watch eleven contract events with thirdweb's `useContractEvents`. On the
 * public Base endpoints that meant one `eth_getLogs` per event per block (plus a hidden
 * 2000-block backfill on every mount and window focus), which tripped the per-IP rate limit
 * and surfaced every 429 as an unhandled rejection. mainnet.base.org refuses `eth_getLogs`
 * entirely, so a log-based watcher cannot work there at all.
 *
 * The events were only ever invalidation triggers. The escrow contract already exposes a
 * per-user change signal that is cheaper and allowed everywhere: `pendingEscrowCount(user)`
 * moves on every paid action (up) and every fulfilment, cancel or refund (down), and the
 * `spendingLimits(user)` tuple moves on limit set/cancel and on fees. One batched read of
 * both per block replaces all the log queries; a change maps onto the same react-query
 * invalidations the events used to drive (`deriveInvalidations`).
 *
 * Industry pattern (viem `watchContractEvent` / wagmi): poll on the block cadence, retry
 * with exponential backoff and jitter, surface transport failures as telemetry rather than
 * exceptions, and stop polling while the tab is hidden. This module is the pure core;
 * `useLiveResponse` wires it to thirdweb and TanStack Query.
 */

/** Base block time on mainnet and Sepolia. One probe per block is "within one block". */
export const LIVE_POLL_INTERVAL_MS = 2_000;
/** Upper bound for the failure backoff. */
export const LIVE_POLL_MAX_BACKOFF_MS = 60_000;
/** Jitter added on top of a backoff delay, as a fraction of that delay. */
export const LIVE_POLL_JITTER_RATIO = 0.25;

/**
 * The two escrow views the poller reads, as thirdweb method signatures (typed returns, no
 * ABI lookup at runtime). Both are auto-generated public mapping getters on
 * EVMAIAgentEscrow; the test suite checks these literals against the synced ABI.
 */
export const ESCROW_PROBE_METHODS = {
	spendingLimits:
		'function spendingLimits(address) view returns (uint256 allowance, uint256 spentAmount, uint256 expiresAt)',
	pendingEscrowCount: 'function pendingEscrowCount(address) view returns (uint256)',
} as const;

export interface EscrowSnapshot {
	pendingEscrowCount: bigint;
	allowance: bigint;
	spentAmount: bigint;
	expiresAt: bigint;
}

export interface SnapshotChange {
	prev: EscrowSnapshot;
	next: EscrowSnapshot;
}

export interface StatePollerDeps {
	/** One batched read of the escrow state for the current user. May reject. */
	read: () => Promise<EscrowSnapshot>;
	onChange: (_change: SnapshotChange) => void;
	/** Telemetry sink (Sentry breadcrumb in production). */
	report: (_message: string, _data: Record<string, unknown>) => void;
	/** `true` while the tab is in the background; polling pauses. */
	isHidden: () => boolean;
	/** Uniform [0, 1) source for the jitter; injectable for determinism. */
	random: () => number;
	intervalMs?: number;
}

export interface StatePoller {
	start: () => void;
	stop: () => void;
	/** The tab became visible: probe now if a probe is due or was skipped while hidden. */
	wake: () => void;
}

export const serializeSnapshot = (s: EscrowSnapshot): string =>
	`${s.pendingEscrowCount}|${s.allowance}|${s.spentAmount}|${s.expiresAt}`;

const describeError = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Delay after `attempt` consecutive failures: doubles from the interval, capped, jittered. */
export const backoffDelayMs = (
	attempt: number,
	intervalMs: number,
	random: () => number,
): number => {
	const base = Math.min(intervalMs * 2 ** attempt, LIVE_POLL_MAX_BACKOFF_MS);
	return Math.round(base * (1 + LIVE_POLL_JITTER_RATIO * random()));
};

export function createStatePoller(deps: StatePollerDeps): StatePoller {
	const intervalMs = deps.intervalMs ?? LIVE_POLL_INTERVAL_MS;

	let running = false;
	let inFlight = false;
	let pausedWhileHidden = false;
	let failures = 0;
	let baseline: EscrowSnapshot | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let generation = 0;

	const clearTimer = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	// Function declarations so `schedule` and `tick` can reference each other.
	function schedule(delayMs: number) {
		clearTimer();
		if (!running) return;
		timer = setTimeout(() => {
			timer = null;
			// eslint-disable-next-line no-use-before-define -- schedule/probe/tick are mutually recursive
			tick();
		}, delayMs);
	}

	async function probe() {
		const myGeneration = generation;
		inFlight = true;
		try {
			const next = await deps.read();
			if (!running || myGeneration !== generation) return;

			if (failures > 0) {
				deps.report('live poll: recovered', { failures });
				failures = 0;
			}
			if (baseline !== null && serializeSnapshot(baseline) !== serializeSnapshot(next)) {
				deps.onChange({ prev: baseline, next });
			}
			baseline = next;
			schedule(intervalMs);
		} catch (error) {
			if (!running || myGeneration !== generation) return;

			failures += 1;
			const nextDelayMs = backoffDelayMs(failures, intervalMs, deps.random);
			deps.report('live poll: read failed, backing off', {
				attempt: failures,
				nextDelayMs,
				reason: describeError(error),
			});
			schedule(nextDelayMs);
		} finally {
			if (myGeneration === generation) inFlight = false;
		}
	}

	/** Fire-and-forget: `probe` handles every rejection itself, so nothing escapes. */
	function tick() {
		if (!running || inFlight) return;
		if (deps.isHidden()) {
			// Nothing is listening while hidden; `wake` resumes with an immediate probe.
			pausedWhileHidden = true;
			return;
		}
		pausedWhileHidden = false;
		probe();
	}

	return {
		start: () => {
			if (running) return;
			running = true;
			tick();
		},
		stop: () => {
			running = false;
			generation += 1;
			inFlight = false;
			clearTimer();
		},
		wake: () => {
			// Only a probe that was skipped while hidden is owed; a wake while the regular
			// timer is still pending must not double-poll inside the current interval.
			if (!running || inFlight || deps.isHidden() || !pausedWhileHidden) return;
			clearTimer();
			tick();
		},
	};
}

export interface InvalidationContext {
	/** The thirdweb wallet-balance key for this chain/owner/token (see useTokenBalance). */
	tokenBalanceKey: unknown[];
	ownerAddress: string;
	activeConversationId: string | null;
}

/**
 * Map an escrow-state change onto the query keys the contract events used to invalidate.
 * The counter cannot name the conversation, so the active chat is refreshed on any
 * pending-count move; the existing sync queue dedupes and spaces the refetches.
 */
export function deriveInvalidations(
	prev: EscrowSnapshot,
	next: EscrowSnapshot,
	ctx: InvalidationContext,
): unknown[][] {
	if (serializeSnapshot(prev) === serializeSnapshot(next)) return [];

	const keys: unknown[][] = [['usagePlan'], ctx.tokenBalanceKey, ['recentActivity']];

	if (next.pendingEscrowCount === prev.pendingEscrowCount) {
		// Only the spending limit moved: set, cancelled, or a fee adjusted it.
		return keys;
	}

	keys.push(['conversations']);
	if (ctx.activeConversationId) {
		// Messages key deliberately omits sessionKey — see CLAUDE.md "Data Layer".
		keys.push(['messages', ctx.activeConversationId, ctx.ownerAddress]);
	}
	if (next.pendingEscrowCount < prev.pendingEscrowCount) {
		// Something resolved: an answer landed, or a prompt was cancelled/refunded.
		keys.push(['stuckRequests']);
	}
	return keys;
}
