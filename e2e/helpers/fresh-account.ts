import fs from 'fs';
import { createHash } from 'node:crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import { CHAIN, getChainConfig } from './chain';
import { enableFreshAccount, FRESH_TEST_ACCOUNTS, type HardhatAccount, RPC_URL } from './hardhat';

/**
 * Per-test fresh-account allocator.
 *
 * Each answer-flow test claims its own pristine account so it can connect as a brand-new user
 * with empty history and its own plan — faithful to a real user's first session and free of
 * cross-test on-chain collisions.
 *
 * Localnet: the pool is Hardhat's derived accounts 2..249, provisioned with hardhat_setBalance +
 * hardhat_impersonateAccount. Testnet: accounts derive from the run's seed at indices beyond the
 * ones the runner pre-funded, and the treasury funds each one just in time (see testnet/treasury).
 *
 * The next-index counter is persisted to a FILE rather than a module variable because Playwright
 * recycles worker processes between tests: a module-level counter resets on recycle and every
 * test would re-claim the first account. The file is reset once per run in global-setup, then
 * monotonically advanced here. A mkdir lock makes the read-increment-write atomic across the
 * parallel project workers that may allocate at the same time.
 */

// Lives under e2e/.auth/ which is already gitignored, so the counter never gets
// committed and is co-located with the other generated E2E run state.
const COUNTER_FILE = fileURLToPath(new URL('../.auth/fresh-account-counter', import.meta.url));
const LOCK_DIR = `${COUNTER_FILE}.lock`;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 20;
/** Testnet has no natural pool end (HD indices are plentiful); this bounds a runaway loop. */
const TESTNET_POOL_SIZE = 10_000;

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
 * The identity of "this chain state" for the counter. Localnet: the genesis hash (a restarted
 * stack is a new chain). Testnet: a hash of the run seed — a new seed means a new account space,
 * and the seed itself must never be written anywhere.
 */
async function chainIdentity(): Promise<string | null> {
	const cfg = getChainConfig();
	if (cfg.chain === 'testnet') {
		return `seed:${createHash('sha256').update(cfg.seed).digest('hex')}`;
	}
	// Small retry: this runs early in global-setup and Hardhat may be up but not
	// yet accepting connections. A transient failure must NOT look like a new
	// chain — resetting the counter on a live, used chain re-issues accounts and
	// reintroduces the exact cross-test state collisions this allocator prevents.
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const res = await fetch(RPC_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_getBlockByNumber',
					params: ['0x0', false],
				}),
			});
			const hash = ((await res.json()) as { result?: { hash?: string } }).result?.hash;
			if (hash) return hash;
		} catch {
			await new Promise(r => {
				setTimeout(r, 1_000);
			});
		}
	}
	return null;
}

/**
 * Prepare the allocator for a run. Called ONCE per run (global-setup).
 *
 * "Fresh" means fresh ON THIS CHAIN, not fresh per run: accounts claimed by an
 * earlier run against the SAME localnet still own their on-chain conversations,
 * and re-issuing them breaks specs that assert exact per-account state (e.g.
 * T-BRANCH-06/07's conversation counts). So the counter resets to 0 only when
 * the chain identity changes (stack restarted with a fresh chain; new testnet
 * seed); otherwise the counter continues where the previous run stopped and
 * simply consumes further into the pool. A crashed run's stale lock is always
 * cleared.
 */
export async function resetFreshAccountAllocator(): Promise<void> {
	fs.mkdirSync(path.dirname(COUNTER_FILE), { recursive: true });
	const identity = await chainIdentity();
	if (identity === null) {
		// Node unreachable (E2E_LOCAL_SERVICES unset, or genuinely down — later
		// checks report that loudly). FAIL SAFE: keep the existing counter so a
		// transient outage can only waste pool depth, never reuse an account.
		if (!fs.existsSync(COUNTER_FILE)) fs.writeFileSync(COUNTER_FILE, '0', 'utf8');
	} else {
		const prior = fs.existsSync(CHAIN_FILE) ? fs.readFileSync(CHAIN_FILE, 'utf8').trim() : '';
		if (prior !== identity || !fs.existsSync(COUNTER_FILE)) {
			fs.writeFileSync(COUNTER_FILE, '0', 'utf8');
		}
		fs.writeFileSync(CHAIN_FILE, identity, 'utf8');
	}
	try {
		fs.rmdirSync(LOCK_DIR);
	} catch {
		// No stale lock from a crashed run — nothing to clear.
	}
}

function claimNextIndex(poolSize: number): number {
	let next = 0;
	try {
		next = parseInt(fs.readFileSync(COUNTER_FILE, 'utf8').trim() || '0', 10);
	} catch {
		// Counter file missing (global-setup skipped, e.g. running a single spec
		// without a stack) — start at the top of the pool.
		next = 0;
	}
	if (!Number.isInteger(next) || next < 0) next = 0;
	if (next >= poolSize) {
		throw new Error(
			`fresh-account: exhausted the ${poolSize}-account pool. ` +
				'Reduce the number of fresh-account tests or widen the account range.',
		);
	}
	fs.writeFileSync(COUNTER_FILE, String(next + 1), 'utf8');
	return next;
}

/**
 * Claim the next unused fresh account. Atomic across parallel project workers. Throws when the
 * pool is exhausted rather than wrapping around, so two tests can never silently share one
 * account's on-chain state. Provisioning happens AT ALLOCATION (outside the sync counter lock)
 * so no caller can hold an unusable account.
 */
export async function allocateFreshAccount(): Promise<HardhatAccount> {
	if (CHAIN === 'testnet') {
		const cfg = getChainConfig();
		if (cfg.chain !== 'testnet') throw new Error('unreachable');
		const slot = await withCounterLock(() => claimNextIndex(TESTNET_POOL_SIZE));
		// Indices below prefundedCount belong to the runner's `fund` stage (shared user, smoke).
		const index = cfg.prefundedCount + slot;
		const { appendAccountsFile, deriveAndRegister, fundAccount } = await import(
			'../testnet/treasury'
		);
		const [account] = deriveAndRegister(index, 1);
		// Recorded BEFORE funding, so an account the transfer only half-reached is still swept.
		await appendAccountsFile(cfg.accountsFile, [{ index, address: account.address }]);
		await fundAccount(account.address);
		return { address: account.address, privateKey: account.privateKey };
	}
	const account = await withCounterLock(
		() => FRESH_TEST_ACCOUNTS[claimNextIndex(FRESH_TEST_ACCOUNTS.length)],
	);
	// Derived indices (≥ 20) have no ETH and are unknown to the node — they need a
	// balance and hardhat_impersonateAccount before any transaction.
	await enableFreshAccount(account.address, 10_000n * 10n ** 18n);
	return account;
}

/**
 * Hand a fresh account back once its test is over. Testnet: sweep its ETH and ABLE to the
 * treasury so the float outstanding stays small (the runner's end-of-run sweep is the safety
 * net, not the mechanism). Localnet: nothing to return — the balance was conjured.
 */
export async function releaseFreshAccount(account: HardhatAccount): Promise<void> {
	if (CHAIN !== 'testnet') return;
	const { sweepAccount } = await import('../testnet/treasury');
	await sweepAccount(account.address);
}
