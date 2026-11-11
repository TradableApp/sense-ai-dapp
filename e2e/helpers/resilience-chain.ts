/**
 * Chain and subgraph reads for the two resilience specs. Everything goes through the chain
 * adapter's `rpc()` (so the dev-node allow-list still applies) and the subgraph's `graphQuery()`.
 * The decisions themselves live in ./resilience.ts; this file only moves bytes.
 */
import { type Hex, toHex } from 'viem';

import { CHAIN, type ChainName, getChainConfig, rpc } from './chain';
import { graphQuery } from './graph';
import {
	decodeUint256,
	findPaymentRefundedLog,
	pendingEscrowCountCalldata,
	refundTimeoutCalldata,
} from './resilience';

async function ethCallUint(to: string, data: Hex): Promise<bigint> {
	return decodeUint256((await rpc('eth_call', [{ to, data }, 'latest'])) as string);
}

/** Unsettled escrows for `user` on the escrow contract, read from chain state. */
export function pendingEscrowCount(escrow: string, user: string): Promise<bigint> {
	return ethCallUint(escrow, pendingEscrowCountCalldata(user));
}

/** The escrow's REFUND_TIMEOUT in seconds, read from the contract. */
export function refundTimeoutSeconds(escrow: string): Promise<bigint> {
	return ethCallUint(escrow, refundTimeoutCalldata());
}

/** The latest block's timestamp: the clock the contract checks, not the wall clock. */
export async function latestChainTimeS(): Promise<number> {
	const block = (await rpc('eth_getBlockByNumber', ['latest', false])) as { timestamp: string };
	return Number(BigInt(block.timestamp));
}

/** A mined block's timestamp, in seconds. */
export async function blockTimestampS(blockNumber: bigint): Promise<number> {
	const block = (await rpc('eth_getBlockByNumber', [toHex(blockNumber), false])) as {
		timestamp: string;
	} | null;
	if (!block) throw new Error(`block ${blockNumber} is not known to the RPC`);
	return Number(BigInt(block.timestamp));
}

export interface MinedReceipt {
	blockNumber: bigint;
	status: 'success' | 'reverted';
}

/** The receipt of a mined transaction. Throws when the hash is not mined yet. */
export async function receiptOf(txHash: string): Promise<MinedReceipt> {
	const receipt = (await rpc('eth_getTransactionReceipt', [txHash])) as {
		blockNumber: string;
		status: string;
	} | null;
	if (!receipt) throw new Error('transaction receipt not found');
	return {
		blockNumber: BigInt(receipt.blockNumber),
		status: receipt.status === '0x1' ? 'success' : 'reverted',
	};
}

export const sleepMs = (ms: number): Promise<void> =>
	new Promise(resolve => {
		setTimeout(resolve, ms);
	});

/**
 * Poll the escrow until `user` has no pending escrow, or the budget ends. `timeoutMs: 0` reads
 * once. This is chain state, one `eth_call` per poll — never a block-range log query: an hour of
 * Base Sepolia is ~18,000 blocks and a provider's free tier caps a log query at 10.
 */
export async function waitForNoPendingEscrow({
	escrow,
	user,
	timeoutMs,
	pollMs,
}: {
	escrow: string;
	user: string;
	timeoutMs: number;
	pollMs: number;
}): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if ((await pendingEscrowCount(escrow, user)) === 0n) return true;
		if (Date.now() >= deadline) return false;
		await sleepMs(pollMs);
	}
}

export interface RefundProof {
	transactionHash: string;
	blockNumber: bigint;
}

/**
 * Proof that `txHash` is the refund of `escrowId`: its receipt succeeded and carries the
 * escrow's PaymentRefunded log for that id. Undefined when it is not mined or is not that refund.
 */
export async function refundProofFromReceipt(
	txHash: string,
	escrow: string,
	escrowId: bigint,
): Promise<RefundProof | undefined> {
	const receipt = (await rpc('eth_getTransactionReceipt', [txHash])) as {
		blockNumber: string;
		status: string;
		logs: Array<{ address: string; topics: string[] }>;
	} | null;
	if (!receipt || receipt.status !== '0x1') return undefined;
	if (!findPaymentRefundedLog(receipt.logs, escrow, escrowId)) return undefined;
	return { transactionHash: txHash, blockNumber: BigInt(receipt.blockNumber) };
}

/** Values the evidence file must never contain. Empty off testnet, where nothing is signed. */
export function registeredSecrets(chain: ChainName = CHAIN): string[] {
	if (chain !== 'testnet') return [];
	const cfg = getChainConfig();
	if (cfg.chain !== 'testnet') return [];
	return [cfg.rpcUrl, cfg.seed, cfg.treasuryPrivateKey].filter(v => v !== '');
}

export interface PaymentRecord {
	id: string;
	amount: string;
	status: string;
	createdAt: string;
	txHash: string;
}

/** Every escrow payment for `user`, oldest first. The id is the escrowId. */
export async function getPaymentRecords(userAddress: string): Promise<PaymentRecord[]> {
	const data = await graphQuery<{ payments: PaymentRecord[] }>(
		`query($user: Bytes!) {
      payments(where: { user: $user }, orderBy: createdAt, orderDirection: asc) {
        id
        amount
        status
        createdAt
        txHash
      }
    }`,
		{ user: userAddress.toLowerCase() },
	);
	return data.payments;
}

export interface SpendingLimitRecord {
	id: string;
	allowance: string;
	expiresAt: string;
	updatedAt: string;
}

/** The SpendingLimit entity for a user (id = user address), or null before the first set. */
export async function getSpendingLimitEntity(
	userAddress: string,
): Promise<SpendingLimitRecord | null> {
	const data = await graphQuery<{ spendingLimit: SpendingLimitRecord | null }>(
		`query($id: ID!) {
      spendingLimit(id: $id) {
        id
        allowance
        expiresAt
        updatedAt
      }
    }`,
		{ id: userAddress.toLowerCase() },
	);
	return data.spendingLimit;
}
