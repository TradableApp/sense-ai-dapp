// @vitest-environment node
//
// The ephemeral-account tooling the run-day runner calls (fund / key / sweep) rests on a
// handful of pure decisions: which accounts a seed yields, what the accounts file may contain,
// whether the treasury can afford a run, and how much of an account can be swept back. Those
// are tested here without a chain. The transfers themselves are exercised on Base Sepolia.
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import {
	deriveAccounts,
	mergeAccountRecords,
	parseAccountsFile,
	planFunding,
	planSweep,
} from './accounts';

const SEED_A = '11'.repeat(32);
const SEED_B = '22'.repeat(32);

describe('deriveAccounts', () => {
	it('derives distinct, checksummed accounts whose keys match their addresses', () => {
		const accounts = deriveAccounts(SEED_A, 0, 4);
		expect(accounts.map(a => a.index)).toEqual([0, 1, 2, 3]);
		expect(new Set(accounts.map(a => a.address)).size).toBe(4);
		for (const a of accounts) {
			expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
			expect(a.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
			expect(privateKeyToAccount(a.privateKey).address).toBe(a.address);
		}
	});

	it('is deterministic for a seed and index — the sweep must find what the fund created', () => {
		expect(deriveAccounts(SEED_A, 0, 4)).toEqual(deriveAccounts(SEED_A, 0, 4));
		expect(deriveAccounts(SEED_A, 2, 1)[0]).toEqual(deriveAccounts(SEED_A, 0, 4)[2]);
	});

	it('yields different accounts for a different seed — a fresh seed means fresh users', () => {
		const a = deriveAccounts(SEED_A, 0, 2).map(x => x.address);
		const b = deriveAccounts(SEED_B, 0, 2).map(x => x.address);
		expect(a.some(addr => b.includes(addr))).toBe(false);
	});

	it('accepts the seed with or without a 0x prefix', () => {
		expect(deriveAccounts(`0x${SEED_A}`, 0, 1)).toEqual(deriveAccounts(SEED_A, 0, 1));
	});

	it('never derives from the well-known Hardhat accounts', () => {
		// Hardhat account #1 — if a seed ever collapsed onto the public mnemonic, sweeper
		// bots would drain the run in seconds.
		const hardhatAcct1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
		expect(deriveAccounts(SEED_A, 0, 20).map(a => a.address)).not.toContain(hardhatAcct1);
	});

	it('refuses a seed that is not 32 bytes of hex', () => {
		expect(() => deriveAccounts('abc', 0, 1)).toThrow(/seed/i);
		expect(() => deriveAccounts('zz'.repeat(32), 0, 1)).toThrow(/seed/i);
		expect(() => deriveAccounts('11'.repeat(31), 0, 1)).toThrow(/seed/i);
	});

	it('refuses a negative index or a non-positive count', () => {
		expect(() => deriveAccounts(SEED_A, -1, 1)).toThrow(/index/i);
		expect(() => deriveAccounts(SEED_A, 0, 0)).toThrow(/count/i);
	});
});

describe('accounts file', () => {
	it('parses the runner contract: a JSON array of {index, address}', () => {
		const text = '[{"index":0,"address":"0xaaaa000000000000000000000000000000000001"}]';
		expect(parseAccountsFile(text)).toEqual([
			{ index: 0, address: '0xaaaa000000000000000000000000000000000001' },
		]);
	});

	it('treats a missing or empty file as no accounts', () => {
		expect(parseAccountsFile('')).toEqual([]);
		expect(parseAccountsFile(undefined)).toEqual([]);
	});

	it('refuses a malformed file rather than sweeping a partial list', () => {
		expect(() => parseAccountsFile('{"index":0}')).toThrow(/accounts file/i);
		expect(() => parseAccountsFile('[{"index":"0","address":"0x1"}]')).toThrow(/accounts file/i);
	});

	it('merges by index, sorted, keeping ADDRESSES ONLY — a private key must never reach the file', () => {
		const existing = [
			{ index: 1, address: '0xaaaa000000000000000000000000000000000002' },
			{ index: 0, address: '0xaaaa000000000000000000000000000000000001' },
		];
		const added = [
			{
				index: 4,
				address: '0xaaaa000000000000000000000000000000000005',
				privateKey: `0x${'33'.repeat(32)}`,
			},
			{ index: 1, address: '0xaaaa000000000000000000000000000000000002' },
		];
		const merged = mergeAccountRecords(existing, added);
		expect(merged).toEqual([
			{ index: 0, address: '0xaaaa000000000000000000000000000000000001' },
			{ index: 1, address: '0xaaaa000000000000000000000000000000000002' },
			{ index: 4, address: '0xaaaa000000000000000000000000000000000005' },
		]);
		expect(JSON.stringify(merged)).not.toContain('privateKey');
		expect(JSON.stringify(merged)).not.toContain('33'.repeat(32));
	});

	it('refuses two different addresses for one index — that would mean two seeds in one run', () => {
		expect(() =>
			mergeAccountRecords(
				[{ index: 0, address: '0xaaaa000000000000000000000000000000000001' }],
				[{ index: 0, address: '0xbbbb000000000000000000000000000000000001' }],
			),
		).toThrow(/index 0/);
	});
});

describe('planFunding', () => {
	const ETH = 10n ** 18n;
	const base = {
		count: 4,
		ethPerAccountWei: ETH / 2000n, // 0.0005 ETH
		tokenPerAccountWei: 5n * ETH,
		gasReserveWei: ETH / 1000n, // the treasury's own gas for 8 transfers + the sweep
	};

	it('passes when the treasury covers every account plus its own gas', () => {
		expect(() =>
			planFunding({ ...base, treasuryEthWei: ETH / 10n, treasuryTokenWei: 500n * ETH }),
		).not.toThrow();
		const plan = planFunding({ ...base, treasuryEthWei: ETH / 10n, treasuryTokenWei: 500n * ETH });
		expect(plan.totalEthWei).toBe(4n * (ETH / 2000n) + ETH / 1000n);
		expect(plan.totalTokenWei).toBe(20n * ETH);
	});

	it('fails loudly when ETH is short, naming the asset and the shortfall', () => {
		expect(() =>
			planFunding({ ...base, treasuryEthWei: ETH / 1000n, treasuryTokenWei: 500n * ETH }),
		).toThrow(/ETH[\s\S]*short/i);
	});

	it('fails loudly when the token is short — the exact case a zero-balance treasury hits', () => {
		expect(() => planFunding({ ...base, treasuryEthWei: ETH / 10n, treasuryTokenWei: 0n })).toThrow(
			/ABLE|token[\s\S]*short/i,
		);
	});

	it('rejects a nonsensical plan (no accounts, or nothing per account) before it reaches the chain', () => {
		expect(() =>
			planFunding({ ...base, count: 0, treasuryEthWei: ETH, treasuryTokenWei: ETH }),
		).toThrow(/count/i);
		expect(() =>
			planFunding({ ...base, ethPerAccountWei: 0n, treasuryEthWei: ETH, treasuryTokenWei: ETH }),
		).toThrow(/ETH per account/i);
	});
});

describe('planSweep', () => {
	const GWEI = 10n ** 9n;
	const gasPriceWei = GWEI / 100n; // 0.01 gwei — Base Sepolia's order of magnitude
	const tokenTransferGas = 65_000n;
	const ethTransferGas = 21_000n;
	const params = { gasPriceWei, tokenTransferGas, ethTransferGas };

	it('sends the token first, then every wei of ETH the fees leave behind', () => {
		const ethBalanceWei = 10n ** 15n; // 0.001 ETH
		const plan = planSweep({ ...params, ethBalanceWei, tokenBalanceWei: 7n * 10n ** 18n });
		expect(plan.sendToken).toBe(true);
		expect(plan.sendEth).toBe(true);
		const tokenFee = tokenTransferGas * gasPriceWei;
		const ethFee = ethTransferGas * gasPriceWei;
		expect(plan.ethAmountWei).toBe(ethBalanceWei - tokenFee - ethFee);
		// What stays behind is at most the two fees, which is far under the runner's 1e12 dust ceiling.
		expect(ethBalanceWei - plan.ethAmountWei).toBeLessThanOrEqual(tokenFee + ethFee);
	});

	it('skips the token transfer when there is no token, and does not budget gas for it', () => {
		const ethBalanceWei = 10n ** 15n;
		const plan = planSweep({ ...params, ethBalanceWei, tokenBalanceWei: 0n });
		expect(plan.sendToken).toBe(false);
		expect(plan.ethAmountWei).toBe(ethBalanceWei - ethTransferGas * gasPriceWei);
	});

	it('does nothing for an account that was never funded', () => {
		const plan = planSweep({ ...params, ethBalanceWei: 0n, tokenBalanceWei: 0n });
		expect(plan).toEqual({ sendToken: false, sendEth: false, ethAmountWei: 0n });
	});

	it('refuses to strand the token: too little ETH to pay for its transfer is reported, not skipped', () => {
		const ethBalanceWei = tokenTransferGas * gasPriceWei - 1n;
		expect(() => planSweep({ ...params, ethBalanceWei, tokenBalanceWei: 10n ** 18n })).toThrow(
			/token/i,
		);
	});

	// Base is an OP-stack L2: every transaction also pays an L1 data fee the node adds to the
	// L2 gas cost. Observed on Base Sepolia 2026-10-28: a sweep planned to the wei failed with
	// "insufficient funds … have 499559231865333 want 499559240000000" — 8,134,667 wei of L1 fee.
	it('reserves the L1 data fee for EACH transaction on an OP-stack chain', () => {
		const ethBalanceWei = 10n ** 15n;
		const l1FeePerTxWei = 8_134_667n;
		const plan = planSweep({
			...params,
			ethBalanceWei,
			tokenBalanceWei: 7n * 10n ** 18n,
			l1FeePerTxWei,
		});
		const tokenCost = tokenTransferGas * gasPriceWei + l1FeePerTxWei;
		const ethCost = ethTransferGas * gasPriceWei + l1FeePerTxWei;
		expect(plan.ethAmountWei).toBe(ethBalanceWei - tokenCost - ethCost);
	});

	it('counts the L1 fee when deciding whether the token can be moved at all', () => {
		const l1FeePerTxWei = 8_134_667n;
		const ethBalanceWei = tokenTransferGas * gasPriceWei + l1FeePerTxWei - 1n;
		expect(() =>
			planSweep({ ...params, ethBalanceWei, tokenBalanceWei: 10n ** 18n, l1FeePerTxWei }),
		).toThrow(/token/i);
	});

	it('leaves ETH below one transfer fee alone — a transfer that cannot pay for itself is dust', () => {
		const plan = planSweep({
			...params,
			ethBalanceWei: ethTransferGas * gasPriceWei - 1n,
			tokenBalanceWei: 0n,
		});
		expect(plan.sendEth).toBe(false);
		expect(plan.ethAmountWei).toBe(0n);
	});
});
