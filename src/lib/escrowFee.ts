import { type Chain, getContract, readContract } from 'thirdweb';

import { client } from '@/config/thirdweb';

/**
 * The fee the escrow charges now, read just before a call that pays it. The call passes it as
 * the most it agrees to pay, so a fee the owner raises between the read and the transaction
 * being mined is refused by the escrow (`FeeAboveMaximum`) instead of being charged.
 *
 * A cancel reads the cancellation fee: the escrow charges that or the payment it holds,
 * whichever is lower, so the fee read is never below what is charged.
 */
export const ESCROW_FEE_GETTERS = {
	prompt: 'promptFee',
	branch: 'branchFee',
	metadata: 'metadataUpdateFee',
	cancellation: 'cancellationFee',
} as const;

export type EscrowFeeKind = keyof typeof ESCROW_FEE_GETTERS;

/**
 * The fee could not be read, so nothing may be sent: a call with no maximum of its own would
 * agree to any fee. It carries which fee and nothing of the original error, whose text can
 * hold the RPC URL.
 */
export class FeeNotReadError extends Error {
	readonly kind: EscrowFeeKind;

	constructor(kind: EscrowFeeKind) {
		super(`The ${kind} fee could not be read from the escrow`);
		this.name = 'FeeNotReadError';
		this.kind = kind;
	}
}

type ReadOptions = Parameters<typeof readContract>[0];

/** Reads one of the escrow's fees. Throws `FeeNotReadError` unless the answer is a number. */
export async function readEscrowFee(
	chain: Chain,
	escrowAddress: string,
	kind: EscrowFeeKind,
): Promise<bigint> {
	let fee: unknown;
	try {
		const escrow = getContract({ client, chain, address: escrowAddress });
		fee = await readContract({
			contract: escrow,
			method: `function ${ESCROW_FEE_GETTERS[kind]}() view returns (uint256)`,
			params: [],
		} as unknown as ReadOptions);
	} catch {
		throw new FeeNotReadError(kind);
	}
	if (typeof fee !== 'bigint') throw new FeeNotReadError(kind);
	return fee;
}
