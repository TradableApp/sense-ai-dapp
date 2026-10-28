/**
 * Treasury operations for testnet mode — the network half of fund / key / sweep.
 *
 * One funded treasury (key from the runner's env, via Secret Manager) hands each ephemeral
 * account a small ETH float and a few ABLE just in time, and takes everything back when the
 * account is released. Amounts are deliberately small: a prompt costs 1 ABLE, a transaction a
 * few hundred thousand gas at ~0.005 gwei, so 0.0005 ETH + 5 ABLE covers any single spec with
 * room to spare, and the per-test sweep keeps the float outstanding to one account's worth.
 */
import { mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { encodeFunctionData, parseAbi } from 'viem';

import {
	type AccountRecord,
	deriveAccounts,
	type DerivedAccount,
	mergeAccountRecords,
	parseAccountsFile,
	planFunding,
	planSweep,
	type SweepPlan,
} from './accounts';
import { registerKey } from './keyring';
import { getChainConfig, rpc, sendFrom, type TestnetConfig } from '../helpers/chain';

export const ETH_PER_ACCOUNT_WEI = 5n * 10n ** 14n; // 0.0005 ETH
export const TOKEN_PER_ACCOUNT_WEI = 5n * 10n ** 18n; // 5 ABLE
/** ETH the treasury keeps back for its own transfers (funding now, nothing for the sweep —
 *  each account pays its own sweep gas). */
export const TREASURY_GAS_RESERVE_WEI = 10n ** 15n; // 0.001 ETH
const ETH_TRANSFER_GAS = 21_000n;
/** An ERC-20 transfer to a cold recipient is ~52k; the proxy adds a delegatecall. */
const TOKEN_TRANSFER_GAS = 80_000n;
/** Fee cap as a multiple of the current gas price, so the sweep plan's arithmetic is an upper
 *  bound on what the chain can actually charge. */
const FEE_HEADROOM = 2n;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 25;

const ERC20_ABI = parseAbi([
	'function transfer(address to, uint256 amount) returns (bool)',
	'function balanceOf(address account) view returns (uint256)',
]);

/** OP-stack predeploy. `getL1FeeUpperBound(size)` (Fjord+) is a conservative L1 data fee for
 *  a transaction of `size` bytes; a signed transfer is ~120 bytes, a token transfer ~190. */
const GAS_PRICE_ORACLE = '0x420000000000000000000000000000000000000F';
const GAS_PRICE_ORACLE_ABI = parseAbi([
	'function getL1FeeUpperBound(uint256 _unsignedTxSize) view returns (uint256)',
]);
const SWEEP_TX_SIZE_BYTES = 256n;

export function testnetConfig(): TestnetConfig {
	const cfg = getChainConfig();
	if (cfg.chain !== 'testnet') {
		throw new Error('treasury operations are testnet-only (E2E_TESTNET=1 or E2E_CHAIN=testnet)');
	}
	return cfg;
}

export async function ethBalance(address: string): Promise<bigint> {
	return BigInt((await rpc('eth_getBalance', [address, 'latest'])) as string);
}

export async function tokenBalance(address: string): Promise<bigint> {
	const data = encodeFunctionData({
		abi: ERC20_ABI,
		functionName: 'balanceOf',
		args: [address as `0x${string}`],
	});
	const result = (await rpc('eth_call', [
		{ to: testnetConfig().tokenAddress, data },
		'latest',
	])) as string;
	return BigInt(result);
}

export async function gasPrice(): Promise<bigint> {
	return BigInt((await rpc('eth_gasPrice')) as string);
}

/**
 * The L1 data fee one sweep transaction may be charged on an OP-stack chain, as an upper bound
 * from the chain's own oracle. A chain without the predeploy (a plain EVM) answers with an error
 * and pays no L1 fee, so that resolves to 0.
 */
export async function l1FeeUpperBoundWei(): Promise<bigint> {
	try {
		const data = encodeFunctionData({
			abi: GAS_PRICE_ORACLE_ABI,
			functionName: 'getL1FeeUpperBound',
			args: [SWEEP_TX_SIZE_BYTES],
		});
		const result = (await rpc('eth_call', [{ to: GAS_PRICE_ORACLE, data }, 'latest'])) as string;
		return result && result !== '0x' ? BigInt(result) : 0n;
	} catch {
		return 0n;
	}
}

/** Derive accounts from the run seed AND make them signable in this process. */
export function deriveAndRegister(fromIndex: number, count: number): DerivedAccount[] {
	const accounts = deriveAccounts(testnetConfig().seed, fromIndex, count);
	for (const a of accounts) registerKey(a.address, a.privateKey);
	return accounts;
}

/** The runner's `fund` stage preflight: can the treasury afford `count` accounts? Loud on no. */
export async function assertTreasuryCanFund(count: number): Promise<void> {
	const { treasuryAddress } = testnetConfig();
	planFunding({
		count,
		ethPerAccountWei: ETH_PER_ACCOUNT_WEI,
		tokenPerAccountWei: TOKEN_PER_ACCOUNT_WEI,
		gasReserveWei: TREASURY_GAS_RESERVE_WEI,
		treasuryEthWei: await ethBalance(treasuryAddress),
		treasuryTokenWei: await tokenBalance(treasuryAddress),
	});
}

function tokenTransferData(to: string, amount: bigint): `0x${string}` {
	return encodeFunctionData({
		abi: ERC20_ABI,
		functionName: 'transfer',
		args: [to as `0x${string}`, amount],
	});
}

/** ETH + ABLE from the treasury to one account. Two transactions, each waited for. */
export async function fundAccount(
	address: string,
	amounts: { ethWei?: bigint; tokenWei?: bigint } = {},
): Promise<void> {
	const { treasuryAddress, tokenAddress } = testnetConfig();
	const ethWei = amounts.ethWei ?? ETH_PER_ACCOUNT_WEI;
	const tokenWei = amounts.tokenWei ?? TOKEN_PER_ACCOUNT_WEI;
	if (ethWei > 0n) await sendFrom({ from: treasuryAddress, to: address, value: ethWei });
	if (tokenWei > 0n) {
		await sendFrom({
			from: treasuryAddress,
			to: tokenAddress,
			data: tokenTransferData(address, tokenWei),
		});
	}
}

/**
 * Return an account's ABLE and ETH to the treasury. The account pays its own gas, with fee
 * caps fixed up front so the plan's residue bound holds. Throws (does not skip) when the token
 * cannot be moved, because a stranded token balance is the failure the sweep exists to prevent.
 */
export async function sweepAccount(address: string): Promise<SweepPlan> {
	const { treasuryAddress, tokenAddress } = testnetConfig();
	const price = (await gasPrice()) * FEE_HEADROOM;
	const l1FeePerTxWei = await l1FeeUpperBoundWei();
	// Read once: the transfer moves exactly the balance the plan was built on, so the returned
	// plan's `sendToken` always describes a real transfer, never a 0-amount one.
	const tokenWei = await tokenBalance(address);
	const plan = planSweep({
		ethBalanceWei: await ethBalance(address),
		tokenBalanceWei: tokenWei,
		gasPriceWei: price,
		tokenTransferGas: TOKEN_TRANSFER_GAS,
		ethTransferGas: ETH_TRANSFER_GAS,
		l1FeePerTxWei,
	});
	const fees = { maxFeePerGas: price, maxPriorityFeePerGas: price };
	if (plan.sendToken) {
		await sendFrom({
			from: address,
			to: tokenAddress,
			data: tokenTransferData(treasuryAddress, tokenWei),
			gas: TOKEN_TRANSFER_GAS,
			...fees,
		});
	}
	if (plan.sendEth) {
		// Re-read: the token transfer's ACTUAL fee is at most the cap, so this is ≥ the planned amount.
		const left = await ethBalance(address);
		const value = left - ETH_TRANSFER_GAS * price - l1FeePerTxWei;
		if (value > 0n) {
			await sendFrom({ from: address, to: treasuryAddress, value, gas: ETH_TRANSFER_GAS, ...fees });
		}
	}
	return plan;
}

// ── Accounts file (runner contract: JSON [{index, address}], addresses only) ───────────────────

async function withFileLock<T>(file: string, fn: () => T): Promise<T> {
	const lockDir = `${file}.lock`;
	mkdirSync(path.dirname(file), { recursive: true });
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	for (;;) {
		try {
			mkdirSync(lockDir);
			break;
		} catch {
			if (Date.now() > deadline) {
				throw new Error(
					`accounts file: lock timeout (${lockDir}) — if no fund/sweep/Playwright process is ` +
						'running, a killed writer left the lock behind; remove that directory and retry',
				);
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
			rmdirSync(lockDir);
		} catch {
			// already released
		}
	}
}

export function readAccountsFile(file: string): AccountRecord[] {
	let text: string | undefined;
	try {
		text = readFileSync(file, 'utf8');
	} catch {
		text = undefined;
	}
	return parseAccountsFile(text);
}

/** Merge `records` into the file atomically (write-then-rename) under the lock. */
export async function appendAccountsFile(
	file: string,
	records: readonly (AccountRecord & Record<string, unknown>)[],
): Promise<AccountRecord[]> {
	return withFileLock(file, () => {
		const merged = mergeAccountRecords(readAccountsFile(file), records);
		const tmp = `${file}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(merged)}\n`, { encoding: 'utf8', mode: 0o600 });
		renameSync(tmp, file);
		return merged;
	});
}
