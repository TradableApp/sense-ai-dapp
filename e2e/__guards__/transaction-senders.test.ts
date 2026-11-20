// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, sourceFiles, stripComments } from './source-scan';

/**
 * A transaction is sent only from the files where the fee token check is asked first.
 *
 * The check stops a payment only where something asks it, and the fee-token-gate guard
 * pins each of those places. A new file that sent a transaction on its own would pay
 * through a token the chain disagrees about with no refusal and no banner, and every
 * other test would stay green. So the files that can send are listed here:
 * - `useChatMutations.tsx`: prompts, branches, renames and deletes (each asks the check),
 *   and cancel and refund (never refused, so money can always come back);
 * - `usePlanMutations.ts`: setting a plan (asks the check) and revoking one (never refused);
 * - `faucetService.ts`: the local faucet, an unlocked development account sending test
 *   tokens to the user. The user pays nothing, so there is nothing to refuse.
 */
const SRC = path.resolve(E2E_DIR, '..', 'src');
const SENDERS = [
	path.join('hooks', 'useChatMutations.tsx'),
	path.join('features', 'usage', 'usePlanMutations.ts'),
	path.join('lib', 'faucetService.ts'),
].sort();

// thirdweb's senders (the function and the React hook, single or batched, with or without
// waiting for the receipt), its ready-made transaction button, the wallet-call API, and
// the raw JSON-RPC methods.
const SENDS = new RegExp(
	[
		'\\b(?:use)?[Ss]end(?:AndConfirm)?(?:Batch)?Transaction\\b',
		'\\b(?:use)?[Ss]endCalls\\b',
		'\\bTransactionButton\\b',
		'\\beth_send(?:Raw)?Transaction\\b',
	].join('|'),
);

const code = sourceFiles(
	SRC,
	file => /\.(ts|tsx|js|jsx)$/.test(file) && !/\.test\.(ts|tsx|js|jsx)$/.test(file),
).map(file => ({ file, source: stripComments(readFileSync(path.join(SRC, file), 'utf8')) }));

describe('transactions are sent only where the fee token check is asked', () => {
	it('finds a sender only in the listed files', () => {
		const sending = code
			.filter(({ source }) => SENDS.test(source))
			.map(({ file }) => file)
			.sort();

		expect(sending).toEqual(SENDERS);
	});

	it('recognises each way of sending', () => {
		[
			"import { sendAndConfirmTransaction } from 'thirdweb';",
			'await sendTransaction({ transaction, account });',
			'const { mutateAsync } = useSendAndConfirmTransaction();',
			'const { mutate } = useSendTransaction();',
			'await sendBatchTransaction({ transactions, account });',
			'useSendBatchTransaction()',
			'await account.sendTransaction(tx);',
			'await sendCalls({ calls });',
			'useSendCalls()',
			'<TransactionButton transaction={() => tx}>Pay</TransactionButton>',
			"method: 'eth_sendTransaction',",
			"method: 'eth_sendRawTransaction',",
		].forEach(sample => expect(SENDS.test(sample), sample).toBe(true));
	});

	it('does not count building or reading a call as sending it', () => {
		[
			'prepareContractCall({ contract, method })',
			'readContract({ contract, method })',
			'eth_getTransactionReceipt(rpc, { hash })',
			'const sentTransactions = 0;',
		].forEach(sample => expect(SENDS.test(sample), sample).toBe(false));
	});
});
