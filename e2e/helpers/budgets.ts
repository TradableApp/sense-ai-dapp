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
}

const LOCALNET: WaitBudgets = {
	ownMessageVisibleMs: 15_000,
	answerMs: 90_000,
	indexMs: 10_000,
	navigateAfterTxMs: 20_000,
	pageLoadMs: 30_000,
	graphPollMs: 1_000,
};

const TESTNET: WaitBudgets = {
	ownMessageVisibleMs: 45_000,
	answerMs: 180_000,
	indexMs: 30_000,
	navigateAfterTxMs: 60_000,
	pageLoadMs: 90_000,
	graphPollMs: 2_000,
};

// Exhaustive by type: adding a chain to ChainName without a budget here is a compile error.
const BUDGETS: Record<ChainName, WaitBudgets> = { localnet: LOCALNET, testnet: TESTNET };

export function budgetsFor(chain: ChainName): WaitBudgets {
	return BUDGETS[chain];
}

export const BUDGET: WaitBudgets = budgetsFor(CHAIN);
