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
}

const LOCALNET: WaitBudgets = {
	ownMessageVisibleMs: 15_000,
	answerMs: 90_000,
	indexMs: 10_000,
	navigateAfterTxMs: 20_000,
};

const TESTNET: WaitBudgets = {
	ownMessageVisibleMs: 45_000,
	answerMs: 180_000,
	indexMs: 30_000,
	navigateAfterTxMs: 60_000,
};

export function budgetsFor(chain: ChainName): WaitBudgets {
	return chain === 'testnet' ? TESTNET : LOCALNET;
}

export const BUDGET: WaitBudgets = budgetsFor(CHAIN);
