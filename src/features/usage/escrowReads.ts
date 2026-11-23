import { type Chain, getContract, readContract } from 'thirdweb';

import { CONTRACTS } from '@/config/contracts';
import { client } from '@/config/thirdweb';

/**
 * The chain reads a plan change is judged by: the approval the wallet has given the escrow on
 * the fee token, whether a spending limit stands on the escrow, and how many of the wallet's
 * prompts the escrow holds pending. Each is read with a fixed signature, so none depends on
 * which token's ABI is synced. Each throws
 * when there is no account to read for or the answer is not what the signature declares, so
 * a caller never takes a failed read for "none".
 */

type ContractConfig = (typeof CONTRACTS)[number];
type ReadOptions = Parameters<typeof readContract>[0];

const ALLOWANCE_SIGNATURE =
	'function allowance(address owner, address spender) view returns (uint256)';

const PENDING_COUNT_SIGNATURE = 'function pendingEscrowCount(address) view returns (uint256)';

const SPENDING_LIMITS_SIGNATURE =
	'function spendingLimits(address user) view returns (uint256 allowance, uint256 spentAmount, uint256 expiresAt)';

/** The approval the wallet has given the escrow on the fee token. */
export async function readEscrowAllowance(
	chain: Chain,
	contracts: ContractConfig,
	owner: string | undefined,
): Promise<bigint> {
	if (!owner) throw new Error('No account to read the approval for');
	const token = getContract({ client, chain, address: contracts.token.address });
	const allowance = await readContract({
		contract: token,
		method: ALLOWANCE_SIGNATURE,
		params: [owner, contracts.escrow.address],
	} as unknown as ReadOptions);
	if (typeof allowance !== 'bigint') throw new Error('The approval read gave no number');
	return allowance;
}

/**
 * Whether a spending limit stands on the escrow for the wallet: its expiry is set. An expired
 * limit still stands (the dashboard shows it, and Revoke is how it is removed), as
 * `useUsagePlan` counts it.
 */
export async function readLimitStands(
	chain: Chain,
	contracts: ContractConfig,
	owner: string | undefined,
): Promise<boolean> {
	if (!owner) throw new Error('No account to read the spending limit for');
	const escrow = getContract({ client, chain, address: contracts.escrow.address });
	const limit: unknown = await readContract({
		contract: escrow,
		method: SPENDING_LIMITS_SIGNATURE,
		params: [owner],
	} as unknown as ReadOptions);
	const expiresAt = Array.isArray(limit) ? limit[2] : undefined;
	if (typeof expiresAt !== 'bigint') throw new Error('The spending limit read gave no expiry');
	return expiresAt !== 0n;
}

/**
 * How many of the wallet's prompts the escrow holds pending. While any is, the escrow refuses
 * a new spending limit and a revoke (`HasPendingPrompts`).
 */
export async function readPendingCount(
	chain: Chain,
	contracts: ContractConfig,
	owner: string | undefined,
): Promise<bigint> {
	if (!owner) throw new Error('No account to read the pending prompts for');
	const escrow = getContract({ client, chain, address: contracts.escrow.address });
	const count = await readContract({
		contract: escrow,
		method: PENDING_COUNT_SIGNATURE,
		params: [owner],
	} as unknown as ReadOptions);
	if (typeof count !== 'bigint') throw new Error('The pending count read gave no number');
	return count;
}
