/**
 * Pure logic for the two run-day resilience checks (testnet-resilience project): calldata for the
 * escrow calls they make, the chain-time and refund-window arithmetic, the skip gate, the
 * PaymentRefunded log match, and the evidence writer that refuses anything secret-shaped.
 *
 * Nothing here touches the network or a clock. Callers inject time and I/O, which is what lets
 * the unit tests prove the waits without waiting.
 */
import fs from 'node:fs';
import path from 'node:path';

import { encodeFunctionData, type Hex, isAddress, keccak256, pad, parseAbi, toHex } from 'viem';

/** Seconds ahead of the latest block the R-EXPIRY-01 limit expires. */
export const EXPIRY_TTL_S = 120n;

const ESCROW_RESILIENCE_ABI = parseAbi([
	'function setSpendingLimit(uint256 _allowance, uint256 _expiresAt)',
	'function processRefund(uint256 _answerMessageId)',
	'function pendingEscrowCount(address) view returns (uint256)',
	'function REFUND_TIMEOUT() view returns (uint256)',
]);

const ERC20_APPROVE_ABI = parseAbi(['function approve(address spender, uint256 amount)']);

const PAYMENT_REFUNDED_SIGNATURE = 'PaymentRefunded(uint256)';

function requireUint(value: bigint, label: string): void {
	if (value < 0n) throw new Error(`${label} must be a non-negative integer (got ${value})`);
}

/** setSpendingLimit(allowance, expiresAt): expiresAt is an ABSOLUTE unix timestamp. */
export function setSpendingLimitCalldata(allowance: bigint, expiresAt: bigint): Hex {
	requireUint(allowance, 'allowance');
	requireUint(expiresAt, 'expiresAt');
	return encodeFunctionData({
		abi: ESCROW_RESILIENCE_ABI,
		functionName: 'setSpendingLimit',
		args: [allowance, expiresAt],
	});
}

/** ERC-20 approve(spender, amount), the step the dApp takes before setSpendingLimit. */
export function approveCalldata(spender: string, amount: bigint): Hex {
	requireUint(amount, 'approve amount');
	if (!isAddress(spender)) throw new Error('approve spender is not an address');
	return encodeFunctionData({
		abi: ERC20_APPROVE_ABI,
		functionName: 'approve',
		args: [spender as Hex, amount],
	});
}

/** processRefund(answerMessageId): the user's own claim, sent by the Node-side fallback only. */
export function processRefundCalldata(answerMessageId: bigint): Hex {
	requireUint(answerMessageId, 'answerMessageId');
	return encodeFunctionData({
		abi: ESCROW_RESILIENCE_ABI,
		functionName: 'processRefund',
		args: [answerMessageId],
	});
}

/** pendingEscrowCount(user): how many of the user's escrows are still unsettled on chain. */
export function pendingEscrowCountCalldata(user: string): Hex {
	if (!isAddress(user)) throw new Error('pendingEscrowCount: the user argument is not an address');
	return encodeFunctionData({
		abi: ESCROW_RESILIENCE_ABI,
		functionName: 'pendingEscrowCount',
		args: [user as Hex],
	});
}

/** REFUND_TIMEOUT(): the window is read from the contract, never copied into a test. */
export function refundTimeoutCalldata(): Hex {
	return encodeFunctionData({ abi: ESCROW_RESILIENCE_ABI, functionName: 'REFUND_TIMEOUT' });
}

/** A uint256 eth_call result. An empty result means the call reached no contract. */
export function decodeUint256(result: string): bigint {
	if (result === '0x' || result === '') {
		throw new Error('eth_call returned an empty result — the address has no contract code');
	}
	return BigInt(result);
}

/** The absolute expiry for a limit `ttlS` seconds past the latest chain timestamp. */
export function expiryTarget(latestChainTimeS: bigint, ttlS: bigint): bigint {
	if (ttlS <= 0n) throw new Error(`time-to-live must be positive (got ${ttlS})`);
	return latestChainTimeS + ttlS;
}

export interface WaitForChainTimeOptions {
	/** The chain time (unix seconds) to wait for. */
	targetS: number;
	/** Reads the latest block timestamp, in seconds. */
	readChainTimeS: () => Promise<number>;
	sleep: (_ms: number) => Promise<void>;
	/** Wall clock in ms, injected so the deadline is testable. */
	now: () => number;
	pollMs: number;
	timeoutMs: number;
}

/**
 * Wait until CHAIN time reaches `targetS`. The wall clock only sets the deadline; the condition
 * is always the latest block timestamp, because the contract checks block time, not Date.now().
 */
export async function waitForChainTime({
	targetS,
	readChainTimeS,
	sleep,
	now,
	pollMs,
	timeoutMs,
}: WaitForChainTimeOptions): Promise<number> {
	const started = now();
	for (;;) {
		const chainTimeS = await readChainTimeS();
		if (chainTimeS >= targetS) return chainTimeS;
		if (now() - started >= timeoutMs) {
			throw new Error(
				`chain time ${chainTimeS} s did not reach target ${targetS} s within ${timeoutMs} ms`,
			);
		}
		await sleep(pollMs);
	}
}

export interface RefundReadinessInput {
	chainTimeS: number;
	createdAtS: number;
	/** REFUND_TIMEOUT read from the contract, in seconds. */
	refundTimeoutS: number;
	/** Wall clock in ms: the dApp's own gate compares Date.now() with the prompt's createdAt. */
	nowMs: number;
	/** The dApp's REFUND_TIMEOUT_MS. Must agree with refundTimeoutS, or the UI gate is wrong. */
	uiTimeoutMs: number;
}

export interface RefundReadiness {
	chainReady: boolean;
	uiReady: boolean;
	ready: boolean;
	chainRemainingS: number;
	uiRemainingMs: number;
	refundableAtS: number;
}

/**
 * The two gates a refund needs open: the contract's (chain time) and the dApp's (wall clock).
 * Both are measured from the escrow's createdAt, so the arithmetic is shared.
 */
export function refundReadiness({
	chainTimeS,
	createdAtS,
	refundTimeoutS,
	nowMs,
	uiTimeoutMs,
}: RefundReadinessInput): RefundReadiness {
	if (uiTimeoutMs !== refundTimeoutS * 1000) {
		throw new Error(
			`UI refund window (${uiTimeoutMs} ms) disagrees with the contract window ` +
				`(${refundTimeoutS} s): the dApp's gate would not match the chain.`,
		);
	}
	const refundableAtS = createdAtS + refundTimeoutS;
	const refundableAtMs = refundableAtS * 1000;
	const chainReady = chainTimeS >= refundableAtS;
	const uiReady = nowMs > createdAtS * 1000 + uiTimeoutMs;
	return {
		chainReady,
		uiReady,
		ready: chainReady && uiReady,
		chainRemainingS: Math.max(0, refundableAtS - chainTimeS),
		uiRemainingMs: Math.max(0, refundableAtMs - nowMs),
		refundableAtS,
	};
}

/** Skip reason for the refund check unless the runner has declared the oracle DOWN. */
export function oracleDownSkipReason(
	env: Readonly<Record<string, string | undefined>>,
): string | undefined {
	if (env.E2E_RESILIENCE_ORACLE_DOWN === '1') return undefined;
	return (
		'Skipped: R-REFUND-01 needs the oracle DOWN so the prompt is never answered. ' +
		'The runner must export E2E_RESILIENCE_ORACLE_DOWN=1 once it has stopped the oracle.'
	);
}

/** Where the evidence JSON goes, or undefined when the runner did not ask for evidence. */
export function evidenceDirFrom(
	env: Readonly<Record<string, string | undefined>>,
): string | undefined {
	const dir = env.E2E_RESILIENCE_EVIDENCE_DIR;
	return dir || undefined;
}

/** Field names that name a secret. Matched case-insensitively against each key. */
const SECRET_NAME = /private|seed|secret|mnemonic|password|rpc|api[-_]?key/i;
const UNPREFIXED_32_BYTES = /[0-9a-fA-F]{64}/g;
const URL_WITH_PATH = /https?:\/\/[^\s"'<>]*\/[^\s"'<>]/;

/**
 * Throws on anything in the evidence that could be a credential. The error names the field PATH
 * (for example `treasury.privateKey`), never the value, so the message is safe in a stage log.
 * 0x-prefixed 32-byte values are allowed: they are transaction and block hashes.
 */
export function assertNoSecrets(value: unknown, secrets: readonly string[], at = 'evidence'): void {
	if (typeof value === 'string') {
		if (secrets.some(s => s !== '' && value.includes(s))) {
			throw new Error(`${at} contains a registered secret value — refusing to write evidence`);
		}
		if (URL_WITH_PATH.test(value)) {
			throw new Error(`${at} carries a URL with a path (provider URLs embed their key there)`);
		}
		for (const match of value.matchAll(UNPREFIXED_32_BYTES)) {
			const start = match.index ?? 0;
			if (value.slice(Math.max(0, start - 2), start) !== '0x') {
				throw new Error(`${at} is an unprefixed 32-byte hex value (looks like a seed or key)`);
			}
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((item, i) => assertNoSecrets(item, secrets, `${at}[${i}]`));
		return;
	}
	if (typeof value === 'object' && value !== null) {
		for (const [key, child] of Object.entries(value)) {
			const childPath = `${at}.${key}`;
			if (SECRET_NAME.test(key)) {
				throw new Error(`${childPath} is a secret-shaped field name — refusing to write evidence`);
			}
			assertNoSecrets(child, secrets, childPath);
		}
	}
}

export interface WriteEvidenceOptions {
	/** From evidenceDirFrom(). Undefined means the runner did not ask for evidence. */
	dir: string | undefined;
	name: string;
	evidence: Record<string, unknown>;
	/** Values that must never appear in the file (RPC URL, seed, treasury key). */
	secrets: readonly string[];
}

/** Writes `<dir>/<name>.json` after the secret check. Returns the path, or undefined when off. */
export function writeResilienceEvidence({
	dir,
	name,
	evidence,
	secrets,
}: WriteEvidenceOptions): string | undefined {
	if (dir === undefined) return undefined;
	assertNoSecrets(evidence, secrets);
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${name}.json`);
	const body = JSON.stringify(
		evidence,
		(_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
		2,
	);
	fs.writeFileSync(file, `${body}\n`, 'utf8');
	return file;
}

/** topic0 and topic1 of PaymentRefunded(escrowId) for one escrow. */
export function paymentRefundedTopics(escrowId: bigint): [Hex, Hex] {
	return [keccak256(toHex(PAYMENT_REFUNDED_SIGNATURE)), pad(toHex(escrowId), { size: 32 })];
}

/** True when a log is the PaymentRefunded event for exactly this escrow. */
export function isPaymentRefundedLog(
	log: { topics: readonly string[] },
	escrowId: bigint,
): boolean {
	const [topic0, topic1] = paymentRefundedTopics(escrowId);
	return log.topics[0]?.toLowerCase() === topic0 && log.topics[1]?.toLowerCase() === topic1;
}
