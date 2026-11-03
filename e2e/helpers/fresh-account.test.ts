// @vitest-environment node
//
// The pool's release path, with the chain calls swapped for fakes. The real claim and release
// are exercised on localnet (every fixture run) and Base Sepolia (run day); this pins the
// behaviour around them: every claimed account is released once, and a release that fails is
// reported, not thrown — a throw from `test.afterEach` fails the test it is cleaning up after,
// and the runner's end-of-run sweep already recovers whatever a release left behind.
import { describe, expect, it, vi } from 'vitest';

import { freshAccountPool } from './fresh-account';
import type { HardhatAccount } from './hardhat';

const account = (n: number): HardhatAccount => ({
	address: `0x${n.toString(16).padStart(40, '0')}`,
	privateKey: `0x${n.toString(16).padStart(64, '0')}`,
});

describe('freshAccountPool', () => {
	it('releases every claimed account once and empties the pool', async () => {
		const claim = vi.fn(async () => account(claim.mock.calls.length));
		const release = vi.fn(async (_acct: HardhatAccount) => {});
		const pool = freshAccountPool({ claim, release, report: vi.fn() });

		const a = await pool.claim();
		const b = await pool.claim();
		await pool.releaseAll();
		await pool.releaseAll();

		expect(release.mock.calls.map(([acct]) => acct.address)).toEqual([a.address, b.address]);
	});

	it('reports a failed release instead of throwing, and still releases the others', async () => {
		const claim = vi.fn(async () => account(claim.mock.calls.length));
		const release = vi.fn(async (acct: HardhatAccount) => {
			if (acct.address === account(1).address) throw new Error('fetch failed');
		});
		const report = vi.fn();
		const pool = freshAccountPool({ claim, release, report });

		await pool.claim();
		await pool.claim();
		await expect(pool.releaseAll()).resolves.toBeUndefined();

		expect(release).toHaveBeenCalledTimes(2);
		expect(report).toHaveBeenCalledTimes(1);
		const [message] = report.mock.calls[0];
		expect(message).toContain(account(1).address);
		expect(message).toContain('fetch failed');
		expect(message).toContain('end-of-run sweep');
	});

	it('reports nothing when every release succeeds', async () => {
		const report = vi.fn();
		const pool = freshAccountPool({
			claim: async () => account(1),
			release: async () => {},
			report,
		});
		await pool.claim();
		await pool.releaseAll();
		expect(report).not.toHaveBeenCalled();
	});
});
