/**
 * Ephemeral-account arithmetic for testnet mode — the pure half of the fund / key / sweep
 * tooling. No network here; `treasury.ts` performs the transfers these functions plan.
 *
 * Test-account pattern (sense-ai-e2e docs/TESTNET_RUN.md): no well-known mnemonics on a public
 * chain, because sweeper bots drain them in seconds. One funded treasury; per-run accounts
 * derived from a fresh 32-byte seed that lives only in the runner's environment; funded just in
 * time; swept back at the end. The accounts FILE holds addresses only, so a leaked artifact
 * directory exposes nothing that can spend.
 */
import { hexToBytes, isAddress, toHex } from 'viem';
import { HDKey, hdKeyToAccount } from 'viem/accounts';

export interface DerivedAccount {
	index: number;
	address: string;
	privateKey: `0x${string}`;
}

/** What the accounts file carries — never a key. */
export interface AccountRecord {
	index: number;
	address: string;
}

const SEED_HEX = /^(0x)?[0-9a-fA-F]{64}$/;

/**
 * Derive `count` accounts starting at `fromIndex` along the standard Ethereum path
 * (m/44'/60'/0'/0/i) from a 32-byte hex seed. Deterministic: the sweep re-derives exactly what
 * the fund created, and `key -- <i>` hands the oracle smoke the same account the runner funded.
 */
export function deriveAccounts(
	seedHex: string,
	fromIndex: number,
	count: number,
): DerivedAccount[] {
	if (!SEED_HEX.test(seedHex)) {
		throw new Error('seed must be 32 bytes of hex (64 hex characters, optional 0x prefix)');
	}
	if (!Number.isInteger(fromIndex) || fromIndex < 0) {
		throw new Error(`fromIndex must be a non-negative integer (got ${fromIndex})`);
	}
	if (!Number.isInteger(count) || count <= 0) {
		throw new Error(`count must be a positive integer (got ${count})`);
	}
	const master = HDKey.fromMasterSeed(hexToBytes(`0x${seedHex.replace(/^0x/, '')}`));
	return Array.from({ length: count }, (_, i) => {
		const index = fromIndex + i;
		const account = hdKeyToAccount(master, { addressIndex: index });
		const key = account.getHdKey().privateKey;
		if (!key) throw new Error(`no private key derived for account index ${index}`);
		return { index, address: account.address, privateKey: toHex(key) };
	});
}

function isAccountRecord(value: unknown): value is AccountRecord {
	if (typeof value !== 'object' || value === null) return false;
	const rec = value as { index?: unknown; address?: unknown };
	return (
		typeof rec.index === 'number' &&
		Number.isInteger(rec.index) &&
		rec.index >= 0 &&
		typeof rec.address === 'string' &&
		isAddress(rec.address)
	);
}

/** Parse the runner-contract accounts file. Absent or empty means "nothing funded". */
export function parseAccountsFile(text: string | undefined): AccountRecord[] {
	if (text === undefined || text.trim() === '') return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error('accounts file is not valid JSON');
	}
	if (!Array.isArray(parsed) || !parsed.every(isAccountRecord)) {
		throw new Error('accounts file must be a JSON array of {index: integer, address: 0x…}');
	}
	return parsed.map(({ index, address }) => ({ index, address }));
}

/**
 * Union by index, sorted, ADDRESSES ONLY. Extra fields on `added` (a derived account's private
 * key, typically) are dropped here so the file can never carry one by accident.
 */
export function mergeAccountRecords(
	existing: readonly AccountRecord[],
	added: readonly (AccountRecord & Record<string, unknown>)[],
): AccountRecord[] {
	const byIndex = new Map<number, string>();
	for (const rec of [...existing, ...added]) {
		const seen = byIndex.get(rec.index);
		if (seen !== undefined && seen.toLowerCase() !== rec.address.toLowerCase()) {
			throw new Error(
				`accounts file conflict at index ${rec.index}: two different addresses — ` +
					'was a second seed used in this run?',
			);
		}
		byIndex.set(rec.index, seen ?? rec.address);
	}
	return [...byIndex.entries()]
		.sort(([a], [b]) => a - b)
		.map(([index, address]) => ({ index, address }));
}

export interface FundingParams {
	count: number;
	ethPerAccountWei: bigint;
	tokenPerAccountWei: bigint;
	/** ETH the treasury keeps for its own transfer gas (fund now, sweep later). */
	gasReserveWei: bigint;
	treasuryEthWei: bigint;
	treasuryTokenWei: bigint;
}

export interface FundingPlan {
	totalEthWei: bigint;
	totalTokenWei: bigint;
}

const formatEth = (wei: bigint): string => `${(Number(wei) / 1e18).toFixed(6)} ETH`;
const formatToken = (wei: bigint): string => `${(Number(wei) / 1e18).toFixed(2)} ABLE`;

/**
 * Can the treasury afford this run? Fails LOUDLY with the asset and the shortfall, before any
 * transfer, so a run never starts half-funded (which would look like a flaky suite later).
 */
export function planFunding(p: FundingParams): FundingPlan {
	if (!Number.isInteger(p.count) || p.count <= 0) {
		throw new Error(`funding plan: count must be a positive integer (got ${p.count})`);
	}
	if (p.ethPerAccountWei <= 0n) throw new Error('funding plan: ETH per account must be positive');
	if (p.tokenPerAccountWei < 0n)
		throw new Error('funding plan: token per account cannot be negative');
	const totalEthWei = BigInt(p.count) * p.ethPerAccountWei + p.gasReserveWei;
	const totalTokenWei = BigInt(p.count) * p.tokenPerAccountWei;
	const problems: string[] = [];
	if (p.treasuryEthWei < totalEthWei) {
		problems.push(
			`ETH short by ${formatEth(totalEthWei - p.treasuryEthWei)} ` +
				`(need ${formatEth(totalEthWei)}, treasury holds ${formatEth(p.treasuryEthWei)})`,
		);
	}
	if (p.treasuryTokenWei < totalTokenWei) {
		problems.push(
			`ABLE token short by ${formatToken(totalTokenWei - p.treasuryTokenWei)} ` +
				`(need ${formatToken(totalTokenWei)}, treasury holds ${formatToken(p.treasuryTokenWei)})`,
		);
	}
	if (problems.length > 0) {
		throw new Error(`treasury cannot fund this run — ${problems.join('; ')}. Top it up first.`);
	}
	return { totalEthWei, totalTokenWei };
}

export interface SweepParams {
	ethBalanceWei: bigint;
	tokenBalanceWei: bigint;
	gasPriceWei: bigint;
	tokenTransferGas: bigint;
	ethTransferGas: bigint;
	/** OP-stack L1 data fee charged per transaction on top of L2 gas (0 on a plain EVM chain). */
	l1FeePerTxWei?: bigint;
}

export interface SweepPlan {
	sendToken: boolean;
	sendEth: boolean;
	/** The ETH transfer's value: everything left after both fees. 0 when `sendEth` is false. */
	ethAmountWei: bigint;
}

/**
 * Token first (its gas comes out of the ETH), then every wei the two fees leave behind. ETH
 * that cannot pay for its own transfer is dust and stays (the runner's dust ceiling tolerates
 * it). Token that cannot be moved for lack of gas is an ERROR, not a skip — a stranded token
 * balance is exactly what the sweep exists to prevent.
 *
 * Each transaction's cost is L2 gas × price PLUS the L1 data fee: Base is an OP-stack chain and
 * its node rejects a transfer whose value + L2 fee leaves nothing for the L1 fee (observed as an
 * 8,134,667 wei shortfall on Base Sepolia).
 */
export function planSweep(p: SweepParams): SweepPlan {
	const l1Fee = p.l1FeePerTxWei ?? 0n;
	const sendToken = p.tokenBalanceWei > 0n;
	const tokenFee = sendToken ? p.tokenTransferGas * p.gasPriceWei + l1Fee : 0n;
	if (sendToken && p.ethBalanceWei < tokenFee) {
		throw new Error(
			`sweep: account holds token but not enough ETH to pay for the token transfer ` +
				`(${formatEth(p.ethBalanceWei)} < ${formatEth(tokenFee)}) — top it up, then sweep again`,
		);
	}
	const ethFee = p.ethTransferGas * p.gasPriceWei + l1Fee;
	const ethAmountWei = p.ethBalanceWei - tokenFee - ethFee;
	const sendEth = ethAmountWei > 0n;
	return { sendToken, sendEth, ethAmountWei: sendEth ? ethAmountWei : 0n };
}
