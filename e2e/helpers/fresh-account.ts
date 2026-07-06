import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { enableFreshAccount, FRESH_TEST_ACCOUNTS, type HardhatAccount } from './hardhat';

/**
 * Per-test fresh-account allocator.
 *
 * Each answer-flow test claims its own pristine Hardhat account (2..19) so it can
 * connect as a brand-new user with empty history and its own plan — faithful to a
 * real user's first session and free of cross-test on-chain collisions.
 *
 * The next-index counter is persisted to a FILE rather than a module variable
 * because Playwright recycles worker processes between tests: a module-level
 * counter resets on recycle and every test would re-claim account #2. The file is
 * reset once per run in global-setup, then monotonically advanced here. A mkdir
 * lock makes the read-increment-write atomic across the parallel project workers
 * that may allocate at the same time.
 */

// Lives under e2e/.auth/ which is already gitignored, so the counter never gets
// committed and is co-located with the other generated E2E run state.
const COUNTER_FILE = fileURLToPath(new URL('../.auth/fresh-account-counter', import.meta.url));
const LOCK_DIR = `${COUNTER_FILE}.lock`;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 20;

async function withCounterLock<T>(fn: () => T): Promise<T> {
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	for (;;) {
		try {
			fs.mkdirSync(LOCK_DIR); // atomic create — throws if another worker holds it
			break;
		} catch {
			if (Date.now() > deadline) {
				throw new Error(`fresh-account: timed out acquiring allocator lock (${LOCK_DIR})`);
			}
			await new Promise(resolve => {
				setTimeout(resolve, LOCK_RETRY_MS);
			});
		}
	}
	try {
		return fn();
	} finally {
		try {
			fs.rmdirSync(LOCK_DIR);
		} catch {
			// Lock already released — nothing to clean up.
		}
	}
}

const CHAIN_FILE = `${COUNTER_FILE}.chain`;

/**
 * Prepare the allocator for a run. Called ONCE per run (global-setup).
 *
 * "Fresh" means fresh ON THIS CHAIN, not fresh per run: accounts claimed by an
 * earlier run against the SAME localnet still own their on-chain conversations,
 * and re-issuing them breaks specs that assert exact per-account state (e.g.
 * T-BRANCH-06/07's conversation counts). So the counter resets to 0 only when
 * the chain's genesis hash changes (stack was restarted with a fresh chain);
 * on the same chain the counter continues where the previous run stopped and
 * simply consumes further into the 2..249 pool. A crashed run's stale lock is
 * always cleared.
 */
export async function resetFreshAccountAllocator(): Promise<void> {
	fs.mkdirSync(path.dirname(COUNTER_FILE), { recursive: true });
	let genesisHash = 'unknown';
	try {
		const res = await fetch('http://127.0.0.1:8545', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'eth_getBlockByNumber',
				params: ['0x0', false],
			}),
		});
		genesisHash = ((await res.json()) as { result?: { hash?: string } }).result?.hash ?? 'unknown';
	} catch {
		// Node unreachable (e.g. E2E_LOCAL_SERVICES unset) — treat as a new chain.
	}
	const priorChain = fs.existsSync(CHAIN_FILE) ? fs.readFileSync(CHAIN_FILE, 'utf8').trim() : '';
	if (genesisHash === 'unknown' || priorChain !== genesisHash || !fs.existsSync(COUNTER_FILE)) {
		fs.writeFileSync(COUNTER_FILE, '0', 'utf8');
	}
	fs.writeFileSync(CHAIN_FILE, genesisHash, 'utf8');
	try {
		fs.rmdirSync(LOCK_DIR);
	} catch {
		// No stale lock from a crashed run — nothing to clear.
	}
}

/**
 * Claim the next unused fresh Hardhat account. Atomic across parallel project
 * workers. Throws when the pool is exhausted rather than wrapping around, so two
 * tests can never silently share one account's on-chain state.
 */
export async function allocateFreshAccount(): Promise<HardhatAccount> {
	return withCounterLock(() => {
		let next = 0;
		try {
			next = parseInt(fs.readFileSync(COUNTER_FILE, 'utf8').trim() || '0', 10);
		} catch {
			// Counter file missing (global-setup skipped, e.g. running a single spec
			// without E2E_LOCAL_SERVICES) — start at the top of the pool.
			next = 0;
		}
		if (!Number.isInteger(next) || next < 0) next = 0;
		if (next >= FRESH_TEST_ACCOUNTS.length) {
			throw new Error(
				`fresh-account: exhausted the ${FRESH_TEST_ACCOUNTS.length}-account pool. ` +
					'Reduce the number of fresh-account tests or widen the Hardhat account range.',
			);
		}
		fs.writeFileSync(COUNTER_FILE, String(next + 1), 'utf8');
		return FRESH_TEST_ACCOUNTS[next];
	}).then(async account => {
		// Provision AT ALLOCATION (outside the sync counter lock) so no caller can
		// hold an unusable account: derived indices (≥ 20) have no ETH and are
		// unknown to the node — they need a balance and
		// hardhat_impersonateAccount before any transaction.
		await enableFreshAccount(account.address, 10_000n * 10n ** 18n);
		return account;
	});
}
