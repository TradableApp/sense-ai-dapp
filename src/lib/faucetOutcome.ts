/**
 * What a faucet request came to, read from its receipt, and what the user is told.
 *
 * A successful receipt is not proof that tokens arrived: the faucet sends whatever token
 * its own setting names, and a transfer the token refuses is still mined. Tokens are
 * announced only for a `Transfer` the configured fee token emitted to the user, and the
 * amount shown is the one in that log.
 */
import { decodeEventLog, erc20Abi, formatUnits } from 'viem';

export type FaucetOutcome =
	| { kind: 'received'; amount: string }
	| { kind: 'reverted' }
	| { kind: 'no-transfer' }
	| { kind: 'timeout' };

export interface FaucetNotice {
	tone: 'success' | 'error' | 'info';
	title: string;
	description: string;
}

interface ReceiptLog {
	address: string;
	topics: readonly string[];
	data: string;
}

export interface FaucetReceipt {
	status?: unknown;
	logs?: readonly ReceiptLog[] | null;
}

export interface FaucetExpectation {
	/** The fee token contract this build is configured with. */
	token: string;
	/** The wallet the tokens were asked for. */
	recipient: string;
	/** Decimal places of the fee token, from its profile. */
	decimals: number;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The value of a Transfer of the fee token to the recipient, or 0n for any other log. */
function valueReceived(log: ReceiptLog, expected: FaucetExpectation): bigint {
	if (!sameAddress(log.address, expected.token)) return 0n;
	try {
		const event = decodeEventLog({
			abi: erc20Abi,
			eventName: 'Transfer',
			topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
			data: log.data as `0x${string}`,
		});
		return sameAddress(event.args.to, expected.recipient) ? event.args.value : 0n;
	} catch {
		// Not a Transfer: the token emitted something else in the same transaction.
		return 0n;
	}
}

/** What the receipt (or the lack of one in time) says about the faucet request. */
export function faucetOutcome(
	receipt: FaucetReceipt | 'timeout',
	expected: FaucetExpectation,
): FaucetOutcome {
	if (receipt === 'timeout') return { kind: 'timeout' };
	if (receipt.status !== 'success') return { kind: 'reverted' };
	const total = (receipt.logs ?? []).reduce((sum, log) => sum + valueReceived(log, expected), 0n);
	if (total === 0n) return { kind: 'no-transfer' };
	return { kind: 'received', amount: formatUnits(total, expected.decimals) };
}

/** The notice for an outcome. Only `received` announces tokens. */
export function faucetNotice(outcome: FaucetOutcome, symbol: string): FaucetNotice {
	switch (outcome.kind) {
		case 'received':
			return {
				tone: 'success',
				title: 'Tokens Received',
				description: `${outcome.amount} ${symbol} added to your wallet.`,
			};
		case 'reverted':
			return {
				tone: 'error',
				title: 'Tokens Not Received',
				description: 'The faucet could not send the tokens. Nothing was added to your wallet.',
			};
		case 'no-transfer':
			return {
				tone: 'error',
				title: 'Tokens Not Received',
				description:
					'The faucet transaction went through, but no tokens arrived in your wallet. Please try again later or contact support.',
			};
		default:
			return {
				tone: 'info',
				title: 'Still Confirming',
				description:
					'The transfer has not been confirmed yet. Your balance will update when it is.',
			};
	}
}
