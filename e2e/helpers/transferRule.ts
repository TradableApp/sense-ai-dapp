/**
 * Reads and owner writes for a fee token that moves only to or from listed addresses. A transfer
 * goes through when either end is listed; between two unlisted holders it is refused with
 * `TransferNotAllowed(from, to)`. Kept out of `hardhat.ts`, which is already past the size the
 * suite keeps a module to.
 */
import { decodeErrorResult, decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';

import { isRpcResponseError, rpc, type RpcResponseError, sendFrom } from './chain';
import { DEPLOYER_ADDRESS } from './hardhat';

const LISTING_ABI = parseAbi([
	'function isTransferExempt(address account) view returns (bool)',
	'function setTransferExempt(address account, bool exempt)',
	'function transfer(address to, uint256 value) returns (bool)',
]);

/** The token errors a refused transfer can carry, decoded by name. */
const TOKEN_ERRORS_ABI = parseAbi([
	'error TransferNotAllowed(address from, address to)',
	'error EnforcedPause()',
	'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
]);
const KNOWN_ERRORS = TOKEN_ERRORS_ABI.map(item => item.name);

export async function isTransferExempt(tokenAddress: string, account: string): Promise<boolean> {
	const data = encodeFunctionData({
		abi: LISTING_ABI,
		functionName: 'isTransferExempt',
		args: [account as `0x${string}`],
	});
	const result = (await rpc('eth_call', [{ to: tokenAddress, data }, 'latest'])) as `0x${string}`;
	return decodeFunctionResult({ abi: LISTING_ABI, functionName: 'isTransferExempt', data: result });
}

/**
 * Lists or unlists `account`, sent by the token's owner (the deployer on localnet). Owner-global
 * state: a spec that changes it puts it back itself, forward-only (no `evm_revert`; see
 * docs/E2E-ISOLATION-MODEL.md). On testnet the owner's key never enters the suite, so this
 * fails there by design.
 */
export async function setTransferExempt(
	tokenAddress: string,
	account: string,
	exempt: boolean,
	owner: string = DEPLOYER_ADDRESS,
): Promise<void> {
	const data = encodeFunctionData({
		abi: LISTING_ABI,
		functionName: 'setTransferExempt',
		args: [account as `0x${string}`, exempt],
	});
	await sendFrom({ from: owner, to: tokenAddress, data });
}

export type TransferOutcome =
	| { refused: false }
	| { refused: true; error: string | undefined; args: readonly unknown[]; message: string };

/**
 * The revert data a node put beside the error: a hex string, or one nested under `data` (a
 * parsed JSON answer, so it has no cycle and its depth is bounded by its size).
 */
function revertData(data: unknown): `0x${string}` | undefined {
	if (typeof data === 'string' && /^0x[0-9a-fA-F]*$/.test(data)) return data as `0x${string}`;
	if (data && typeof data === 'object' && 'data' in data) {
		return revertData((data as { data: unknown }).data);
	}
	return undefined;
}

function decodeRefusal(err: RpcResponseError): TransferOutcome {
	const data = revertData(err.data);
	if (data && data.length >= 10) {
		try {
			const decoded = decodeErrorResult({ abi: TOKEN_ERRORS_ABI, data });
			return {
				refused: true,
				error: decoded.errorName,
				args: decoded.args ?? [],
				message: err.message,
			};
		} catch {
			// Not one of the token errors this file knows; fall through to the message.
		}
	}
	// A local node names the error in its message even when it gives no data.
	const named = KNOWN_ERRORS.find(name => err.message.includes(name));
	return { refused: true, error: named, args: [], message: err.message };
}

/**
 * Whether `from` could send `amount` to `to` right now, asked with `eth_call`: nothing is sent and
 * no gas is spent, so it runs on a public chain too. A refusal carries the decoded token error.
 */
export async function tryTransfer(
	tokenAddress: string,
	from: string,
	to: string,
	amount: bigint,
): Promise<TransferOutcome> {
	const data = encodeFunctionData({
		abi: LISTING_ABI,
		functionName: 'transfer',
		args: [to as `0x${string}`, amount],
	});
	try {
		await rpc('eth_call', [{ from, to: tokenAddress, data }, 'latest']);
		return { refused: false };
	} catch (err) {
		if (isRpcResponseError(err)) return decodeRefusal(err);
		throw err;
	}
}
