import { CHAIN, type ChainName } from './chain';

/**
 * Wait budgets: what the dApp owes the user on each chain, in milliseconds.
 *
 * Localnet keeps the values the specs were written against (Hardhat auto-mines, the subgraph
 * indexes in under a second). Testnet states the acceptable experience on a public chain, sized
 * from the 2026-11-02 Base Sepolia run day: a submit → receipt took up to ~30 s, the oracle's
 * answer p50 was 49 s with one answer past 90 s, and the history list trails the chain by the
 * subgraph's indexing plus the dApp's IndexedDB sync. A breach of these budgets is a finding
 * about the stack, not something to hide behind a Playwright retry.
 */
export interface WaitBudgets {
	/** The user's own prompt rendered in the thread. It renders after the submit receipt. */
	ownMessageVisibleMs: number;
	/** A new assistant answer rendered: oracle round trip plus the live poller's catch-up. */
	answerMs: number;
	/** Indexed state visible in the UI (history list, conversation count). */
	indexMs: number;
	/** A navigation that waits on a confirmed transaction (connect → dashboard redirect). */
	navigateAfterTxMs: number;
	/**
	 * `page.goto` resolving on the browser's `load` event: every sub-resource fetched, including the
	 * ~3 MB main bundle and third-party scripts. Localnet serves from the Vite dev server; testnet
	 * from Firebase Hosting, where the 2026-11-09 run day saw that bundle alone take 21 s during a
	 * throughput dip. Wired into playwright.config.ts as `navigationTimeout`.
	 */
	pageLoadMs: number;
	/**
	 * Interval between two reads of the subgraph while a wait polls for an indexed entity. The
	 * endpoint is shared infrastructure with a quota: Subgraph Studio allows 3,000 queries a day and
	 * refused with HTTP 429 at 00:31Z on 2026-11-10, ending run 20261109T233416Z in dapp-2. Localnet
	 * owns its graph-node and can poll every second; testnet polls no faster than every 2 s.
	 */
	graphPollMs: number;
	/**
	 * Timeout for one health probe in global-setup. Localhost services answer in milliseconds; a
	 * public gateway behind Cloudflare with indexer selection took 16–20 s per query in the first
	 * minutes after `sense-ai-testnet` was published (2026-11-10 02:50Z) and failed a 5 s probe
	 * twice at 03:07Z, ending run 20261110T030552Z before a single test ran.
	 */
	healthCheckMs: number;
}

const LOCALNET: WaitBudgets = {
	ownMessageVisibleMs: 15_000,
	answerMs: 90_000,
	indexMs: 10_000,
	navigateAfterTxMs: 20_000,
	pageLoadMs: 30_000,
	graphPollMs: 1_000,
	healthCheckMs: 5_000,
};

const TESTNET: WaitBudgets = {
	ownMessageVisibleMs: 45_000,
	answerMs: 180_000,
	indexMs: 30_000,
	navigateAfterTxMs: 60_000,
	pageLoadMs: 90_000,
	graphPollMs: 2_000,
	healthCheckMs: 30_000,
};

// Exhaustive by type: adding a chain to ChainName without a budget here is a compile error.
const BUDGETS: Record<ChainName, WaitBudgets> = { localnet: LOCALNET, testnet: TESTNET };

export function budgetsFor(chain: ChainName): WaitBudgets {
	return BUDGETS[chain];
}

export const BUDGET: WaitBudgets = budgetsFor(CHAIN);

/**
 * Budgets for the two run-day resilience checks (testnet-resilience project only). Kept apart
 * from WaitBudgets because they describe a deliberate, hour-long run-day action, not the wait
 * the dApp owes on every interaction; the testnet-resilience project is the only consumer.
 */
export interface ResilienceBudgets {
	/** Interval between reads of chain time while waiting for a spending limit to expire. */
	chainTimePollMs: number;
	/** Gentle poll interval while waiting out the 1 h refund window. */
	refundPollMs: number;
	/** Seconds past `expiresAt` the prompt is sent, so the contract's own clock has moved on. */
	expiryMarginS: number;
	/** Test timeout for R-EXPIRY-01: a 120 s limit, funding, two transactions and a prompt. */
	expiryTestTimeoutMs: number;
	/** Test timeout for R-REFUND-01: the 1 h window, the prompt round-trip and indexing. */
	refundTestTimeoutMs: number;
	/** How long the dashboard's refund button may take to appear once both gates are open. */
	refundUiGraceMs: number;
	/** How long the stuck-request row may take to leave the panel after the refund click. */
	refundClickGraceMs: number;
	/** Indexed state (pending payment, refunded payment, REFUND activity) for the resilience checks. */
	indexWaitMs: number;
}

const LOCALNET_RESILIENCE: ResilienceBudgets = {
	chainTimePollMs: 1_000,
	refundPollMs: 1_000,
	expiryMarginS: 15,
	expiryTestTimeoutMs: 600_000,
	refundTestTimeoutMs: 4_500_000,
	refundUiGraceMs: 60_000,
	refundClickGraceMs: 45_000,
	indexWaitMs: 60_000,
};

const TESTNET_RESILIENCE: ResilienceBudgets = {
	chainTimePollMs: 5_000,
	refundPollMs: 30_000,
	expiryMarginS: 15,
	expiryTestTimeoutMs: 600_000,
	// 75 min: the 1 h refund window measured from the escrow's block, plus the prompt round-trip
	// before it and the refund click and indexing after it.
	refundTestTimeoutMs: 4_500_000,
	refundUiGraceMs: 180_000,
	refundClickGraceMs: 90_000,
	indexWaitMs: 90_000,
};

export const RESILIENCE_BUDGETS: Record<ChainName, ResilienceBudgets> = {
	localnet: LOCALNET_RESILIENCE,
	testnet: TESTNET_RESILIENCE,
};

export const RESILIENCE_BUDGET: ResilienceBudgets = RESILIENCE_BUDGETS[CHAIN];
