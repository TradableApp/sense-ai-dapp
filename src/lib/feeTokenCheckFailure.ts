/**
 * What is sent to the error tracker when the fee token check cannot read the chain.
 *
 * The original error is never sent. thirdweb's batch errors carry the RPC URL and the text
 * of every call in the batch, whose data can hold the wallet's address, and that text
 * changes from batch to batch, so the same failure would also be reported again each time.
 * The report carries a kind and the first line of the message, scrubbed.
 */

export type FailureKind =
	| 'invalid-reading'
	| 'zero-data'
	| 'rpc'
	| 'node'
	| 'no-contracts'
	| 'other';

export interface Failure {
	kind: FailureKind;
	/** The first line of the message, with URLs and long hex replaced. */
	line: string;
}

const MAX_LINE = 120;
const URL_PATTERN = /https?:\/\/\S+/gi;
const LONG_HEX = /0x[0-9a-fA-F]{8,}/g;

const NETWORK_ERROR_NAMES = ['AbortError', 'TimeoutError'];
const NETWORK_MESSAGE =
	/failed to fetch|fetch failed|networkerror|network request failed|timed out/i;

function messageOf(error: unknown): string {
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error) {
		const { message } = error as { message: unknown };
		if (typeof message === 'string') return message;
	}
	return '';
}

function nameOf(error: unknown): string {
	return error instanceof Error ? error.name : '';
}

/** A JSON-RPC error the node answered with: a plain object with a numeric code. */
function isRpcErrorObject(error: unknown): boolean {
	return (
		!!error &&
		typeof error === 'object' &&
		!(error instanceof Error) &&
		typeof (error as { code?: unknown }).code === 'number'
	);
}

function kindOf(error: unknown, message: string): FailureKind {
	if (nameOf(error) === 'FeeTokenCheckError') return 'invalid-reading';
	if (/no contracts for this chain/.test(message)) return 'no-contracts';
	if (/zero data|returned no data/.test(message)) return 'zero-data';
	if (isRpcErrorObject(error) || /^RPC (request failed|Error)/.test(message)) return 'rpc';
	if (NETWORK_ERROR_NAMES.includes(nameOf(error)) || NETWORK_MESSAGE.test(message)) return 'node';
	return 'other';
}

function scrub(message: string): string {
	const [first = ''] = message.split('\n');
	return first.replace(URL_PATTERN, '<url>').replace(LONG_HEX, '<hex>').slice(0, MAX_LINE);
}

/** Sorts a failed read and keeps only what is safe to send. */
export function describeFailure(error: unknown): Failure {
	const message = messageOf(error);
	return { kind: kindOf(error, message), line: scrub(message) };
}

/** A new error for the tracker, carrying only the kind and the scrubbed line. */
export function failureReport({ kind, line }: Failure): Error {
	const report = new Error(line ? `${kind}: ${line}` : kind);
	report.name = 'FeeTokenCheckFailure';
	return report;
}
