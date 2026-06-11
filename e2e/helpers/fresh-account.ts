import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { FRESH_TEST_ACCOUNTS, type HardhatAccount } from './hardhat';

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

/**
 * Reset the allocator to the start of the fresh-account pool. Call ONCE per run
 * (global-setup) so a stale counter from a previous run can't immediately exhaust
 * the pool or skip accounts.
 */
export function resetFreshAccountAllocator(): void {
	fs.mkdirSync(path.dirname(COUNTER_FILE), { recursive: true });
	fs.writeFileSync(COUNTER_FILE, '0', 'utf8');
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
	});
}
